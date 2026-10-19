// 시즌 전환. 월즈가 끝난 뒤:
//   1) closeSeason: 우승 기록·칭호, 팀 명성·연봉 상한 갱신, 구단주 평가
//   2) beginOffseason: 남은 성장·나이·노쇠, 은퇴, 2군 신인, 계약 끝나는 선수 목록
//   3) (재계약·FA 라운드·이적은 market.ts. CLI는 runAiMarket으로 AI만)
//   4) finishOffseason: 로스터 채우기, 챔피언 풀 갱신, 팀워크 변화, 메타 변화, 다음 시즌
import { champion, LEAGUES, type YearState } from "../competition/year.ts";
import { createRng, hashSeed, type Rng } from "../rng.ts";
import type { Champion, Position } from "../types.ts";
import { POSITIONS } from "../types.ts";
import { seasonEndDevelop } from "./develop.ts";
import { aiBuyouts, aiOffers, aiResign, aiSetLineups, fillRosters, release, resolveOffers, type Offer } from "./market.ts";
import { expiringOf, finishOpening } from "./opening.ts";
import { evaluateGoals, type Goal } from "./owner.ts";
import type { CareerParams } from "./params.ts";
import { makeRookie, seedPool } from "./rookies.ts";
import type { SeasonStats, TeamState, WorldState } from "./types.ts";
import { overall } from "./value.ts";
import { mainRoster, retuneReplacement } from "./world.ts";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// 한 시즌 성과 점수 (0~1): 자국 순위 + 국제대회
function resultScore(y: YearState, t: TeamState): number {
  const n = y.leagues[t.league]?.length ?? 10;
  const place = y.finals[t.league]?.find(([, x]) => x === t.id)?.[0] ?? n;
  let s = 0.6 * (1 - (place - 1) / Math.max(1, n - 1));
  const w = y.finals.WORLDS?.find(([, x]) => x === t.id)?.[0];
  if (w) s += w === 1 ? 0.4 : w === 2 ? 0.3 : w <= 3 ? 0.2 : w <= 5 ? 0.12 : 0.05;
  if (y.finals.MSI?.find(([, x]) => x === t.id)?.[0] === 1) s += 0.1;
  return clamp(s, 0, 1);
}

export function closeSeason(world: WorldState, y: YearState, user?: { team: string; goals: Goal[] }): WorldState {
  const champs = Object.fromEntries(["LCK", "MSI", "WORLDS"].map((ev) => [ev, champion(y, ev) ?? ""]));
  const places: Record<string, Record<string, number>> = {};
  for (const [ev, list] of Object.entries(y.finals)) for (const [p, t] of list) (places[t] ??= {})[ev] = p;
  const players = { ...world.players };
  const label: Record<string, string> = { LCK: "LCK", MSI: "MSI", WORLDS: "월즈" };
  for (const [ev, team] of Object.entries(champs)) {
    if (!team || !world.teams[team]) continue;
    for (const id of mainRoster(world.teams[team])) players[id] = { ...players[id], careerTitles: [...players[id].careerTitles, `${world.season} ${label[ev]}`] };
  }
  const teams = Object.fromEntries(
    Object.values(world.teams).map((t) => {
      const score = resultScore(y, t);
      const cap = Math.round(clamp(t.cap * (0.92 + 0.2 * score), t.cap * 0.85, t.cap * 1.15));
      return [t.id, { ...t, prestige: Math.round((0.6 * t.prestige + 0.4 * score) * 100) / 100, cap: Math.max(cap, 8) }];
    }),
  );
  const w = { ...world, players, teams };
  const owner = user ? { team: user.team, ...evaluateGoals(w, y, user.team, user.goals) } : undefined;
  return { ...w, history: [...w.history, { season: world.season, champions: champs, places, owner, moves: [] }] };
}

// 은퇴: 26세부터, 실력이 낮을수록 잘 은퇴. 30세 이상은 더.
// 정상급 선수와 계약이 남은 선수는 잘 은퇴하지 않는다 (2026 Faker 30세, 2029년까지 계약). 계수는 CareerParams.retire
function retireChance(cp: CareerParams, age: number, ovr: number, contracted: boolean): number {
  const r = cp.retire;
  if (age < r.startAge) return 0;
  const elite = ovr >= r.eliteHi ? r.eliteHiMult : ovr >= r.eliteLo ? r.eliteLoMult : 1;
  return clamp((r.perYear * (age - r.startAge + 1) + Math.max(0, (r.lowOvr - ovr) * r.lowRate) + (age >= r.oldAge ? r.oldBonus : 0)) * elite * (contracted ? r.contracted : 1), 0, 0.9);
}

export function positionTop(champions: Map<string, Champion>, meta: Record<string, number>): Record<Position, string[]> {
  return Object.fromEntries(
    POSITIONS.map((pos) => [
      pos,
      [...champions.values()]
        .filter((c) => (c.positions[pos] ?? 0) >= 0.3)
        .sort((a, b) => (meta[b.id] ?? b.meta) - (meta[a.id] ?? a.meta))
        .map((c) => c.id),
    ]),
  ) as Record<Position, string[]>;
}

export function beginOffseason(world: WorldState, stats: SeasonStats, champions: Map<string, Champion>): { world: WorldState; expiring: Record<string, string[]> } {
  const rng = createRng(hashSeed(world.seed, world.season, "offseason"));
  let w = retuneReplacement(seasonEndDevelop(world, stats));
  // 은퇴 (팀 소속이면 방출 후 은퇴 처리)
  for (const p of Object.values(w.players)) {
    if (p.retired) continue;
    const longFa = !p.contract && p.faSeasons >= w.cp.retire.faSeasons;
    const contracted = (p.contract?.endSeason ?? 0) > world.season;
    if (longFa || rng.next() < retireChance(w.cp, p.age ?? 22, overall(p.ratings), contracted)) {
      if (p.contract) w = release(w, p.id);
      w = { ...w, players: { ...w.players, [p.id]: { ...w.players[p.id], retired: true, contract: null } }, freeAgents: w.freeAgents.filter((x) => x !== p.id) };
    }
  }
  // 2군 신인: LCK 팀마다 2군 5명 이상 유지 + 해마다 1명
  const top = positionTop(champions, w.champMeta);
  for (const t of Object.values(w.teams).filter((x) => x.league === "LCK")) {
    const missing = Math.max(1, 5 - w.teams[t.id].academy.length);
    for (let i = 0; i < missing; i++) {
      const pos = POSITIONS[rng.int(5)];
      const r = seedPool(makeRookie(w, "LCK", pos, t.id, true, rng), top[pos], rng);
      const tt = w.teams[t.id];
      w = { ...w, players: { ...w.players, [r.id]: r }, teams: { ...w.teams, [t.id]: { ...tt, academy: [...tt.academy, r.id] } }, nextRookie: w.nextRookie + 1 };
    }
  }
  // 시장에 나오는 하부 리그 선수: 해외는 리그별 6명(대체 선수 수준), LCK는 2군 신인이 대신함
  for (const lg of LEAGUES.filter((x) => x !== "LCK")) {
    for (let i = 0; i < 6; i++) {
      const pos = POSITIONS[i % 5];
      const r = seedPool(makeRookie(w, lg, pos, null, false, rng, { replacement: true }), top[pos], rng);
      w = { ...w, players: { ...w.players, [r.id]: r }, freeAgents: [...w.freeAgents, r.id], nextRookie: w.nextRookie + 1 };
    }
  }
  return { world: w, expiring: expiringOf(w) };
}

// AI만 시장 진행 (CLI·사용자가 맡기지 않은 팀): 재계약 → FA 라운드
export function runAiMarket(world: WorldState, expiring: Record<string, string[]>, rounds: number, skipTeam: string | null, rng: Rng, extra: (round: number) => Offer[] = () => []): { world: WorldState; signed: Offer[] } {
  let w = world;
  for (const teamId of Object.keys(w.teams)) if (teamId !== skipTeam) w = aiResign(w, teamId, expiring[teamId] ?? [], rng);
  w = aiBuyouts(w, rng, skipTeam).world;
  const signed: Offer[] = [];
  for (let r = 0; r < rounds; r++) {
    const offers = [...Object.keys(w.teams).filter((id) => id !== skipTeam).flatMap((id) => aiOffers(w, id, rng)), ...extra(r)];
    const res = resolveOffers(w, offers, r === rounds - 1);
    w = res.world;
    signed.push(...res.signed);
  }
  return { world: w, signed };
}

export function finishOffseason(world: WorldState, stats: SeasonStats, champions: Map<string, Champion>, userTeam: string | null = null): WorldState {
  if (world.opening) return finishOpening(world, stats, champions, userTeam, positionTop);
  const rng = createRng(hashSeed(world.seed, world.season, "finish-offseason"));
  let w = fillRosters(world, rng, positionTop(champions, world.champMeta));
  w = aiSetLineups(w, userTeam);
  // 챔피언 풀: 지난 기록 절반 + 이번 시즌 출전
  const players = { ...w.players };
  for (const p of Object.values(players)) {
    if (p.retired) continue;
    const pool: Record<string, number> = {};
    for (const [c, n] of Object.entries(p.champions)) pool[c] = n * 0.5;
    for (const [c, n] of Object.entries(stats.picks[p.id] ?? {})) pool[c] = (pool[c] ?? 0) + n;
    const kept = Object.fromEntries(Object.entries(pool).filter(([, n]) => n >= 0.3).sort((a, b) => b[1] - a[1]).map(([c, n]) => [c, Math.round(n * 10) / 10]));
    players[p.id] = { ...p, champions: kept, faSeasons: p.contract ? 0 : p.faSeasons + 1, starter: false };
  }
  // 팀워크: 주전을 많이 지킬수록 유지되고 조금씩 쌓인다. 다 바꾸면 사라진다
  const teams = Object.fromEntries(
    Object.values(w.teams).map((t) => {
      const now = POSITIONS.map((pos) => t.starters[pos]);
      const kept = now.filter((id) => t.seasonStarters.includes(id)).length / 5;
      const teamwork = Math.round(clamp(t.teamwork * (0.4 + 0.5 * kept) + 0.05 * kept, -0.6, 0.9) * 1000) / 1000;
      for (const id of now) players[id] = { ...players[id], starter: true };
      return [t.id, { ...t, teamwork, seasonStarters: now, focus: [], transferBudget: Math.round(t.cap * 0.3 + t.transferBudget * 0.5) }];
    }),
  );
  // 챔피언 메타: 원래 값으로 조금 돌아가며 흔들림
  const champMeta = Object.fromEntries(
    Object.entries(w.champMeta).map(([c, m]) => [c, Math.round(clamp(m + 0.3 * ((w.baseMeta[c] ?? m) - m) + 0.06 * rng.normal(), 0.02, 0.99) * 1000) / 1000]),
  );
  w = { ...w, players, teams, champMeta, season: w.season + 1, lastGrowth: w.lastGrowth };
  return w;
}

export { release };
