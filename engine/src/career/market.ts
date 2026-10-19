// 이적시장 기본 동작: 계약·방출, 선수의 제안 고르기, AI 팀의 재계약·FA 영입·로스터 채우기.
// 사용자 제안(재계약·FA·이적료·트레이드)은 같은 함수에 offer를 넘겨 처리한다.
import type { Rng } from "../rng.ts";
import type { Position } from "../types.ts";
import { POSITIONS } from "../types.ts";
import { makeRookie, REGION_NATION, seedPool } from "./rookies.ts";
import type { PlayerState, TeamState, WorldState } from "./types.ts";
import { overall, payroll, playerValue, salaryDemand, transferFee } from "./value.ts";
import { mainRoster, MAX_MAIN_ROSTER } from "./world.ts";

export interface Offer {
  team: string;
  player: string;
  salary: number;
  years: number; // 1~3
  role: "starter" | "bench";
}

// 국적 → 선호 지역 (같은 지역 팀 제안을 더 좋게 본다)
const NATION_REGION: Record<string, string> = {
  "South Korea": "LCK",
  China: "LPL",
  Taiwan: "LCP",
  "Hong Kong": "LCP",
  Vietnam: "LCP",
  Japan: "LCP",
  Philippines: "LCP",
  Australia: "LCP",
  Brazil: "CBLOL",
  "United States": "LCS",
  Canada: "LCS",
};
export function homeRegion(p: PlayerState, world: WorldState): string {
  if (p.nationality && NATION_REGION[p.nationality]) return NATION_REGION[p.nationality];
  if (p.nationality && Object.values(REGION_NATION).includes(p.nationality)) return Object.entries(REGION_NATION).find(([, n]) => n === p.nationality)![0];
  const team = p.contract?.team ?? p.team;
  return world.teams[team]?.league ?? (p.nationality ? "LEC" : "LCK"); // 유럽 각국 국적은 LEC로 본다
}

// 제안 효용: 요구 대비 연봉 + 팀 명성 + 주전 약속 + 같은 지역 + 원소속 우대
export function offerUtility(world: WorldState, p: PlayerState, o: Offer): number {
  const t = world.teams[o.team];
  const demand = Math.max(0.3, salaryDemand(p));
  return (
    Math.min(1.6, o.salary / demand) +
    0.5 * (t?.prestige ?? 0.5) +
    (o.role === "starter" ? 0.25 : 0) +
    (homeRegion(p, world) === t?.league ? 0.3 : 0) +
    (p.contract?.team === o.team || p.team === o.team ? 0.15 : 0)
  );
}
export const ACCEPT = 1.45; // 이 이상이면 바로 수락 (요구 연봉 그대로 + 보통 팀 + 같은 지역이면 넘음)
export const ACCEPT_LAST = 1.0; // 마지막 라운드엔 이 정도면 수락

const round1 = (x: number) => Math.round(x * 10) / 10;

function setTeam(world: WorldState, id: string, t: TeamState): WorldState {
  return { ...world, teams: { ...world.teams, [id]: t } };
}
function setPlayer(world: WorldState, p: PlayerState): WorldState {
  return { ...world, players: { ...world.players, [p.id]: p } };
}

// 팀에서 빼서 FA로 (주전 자리는 비운다)
export function release(world: WorldState, id: string): WorldState {
  const p = world.players[id];
  const teamId = p.contract?.team;
  let w = world;
  if (teamId && w.teams[teamId]) {
    const t = w.teams[teamId];
    const starters = { ...t.starters };
    for (const pos of POSITIONS) if (starters[pos] === id) starters[pos] = "";
    w = setTeam(w, teamId, {
      ...t,
      starters,
      bench: t.bench.filter((x) => x !== id),
      academy: t.academy.filter((x) => x !== id),
      focus: t.focus.filter((x) => x !== id),
    });
  }
  w = setPlayer(w, { ...p, contract: null, academy: false, starter: false });
  return { ...w, freeAgents: w.freeAgents.includes(id) ? w.freeAgents : [...w.freeAgents, id] };
}

// 계약하고 팀에 넣는다. 주전 약속이면 그 포지션 주전으로 (기존 주전은 후보로)
export function sign(world: WorldState, o: Offer): WorldState {
  let w = world;
  const p0 = w.players[o.player];
  if (p0.contract && p0.contract.team !== o.team) w = release(w, o.player);
  const t0 = w.teams[o.team];
  const p = w.players[o.player];
  let starters = { ...t0.starters };
  let bench = t0.bench.filter((x) => x !== p.id);
  const academy = t0.academy.filter((x) => x !== p.id);
  const pos = p.position;
  const current = starters[pos];
  if (current === p.id) {
    // 이미 주전 (재계약)
  } else if (o.role === "starter" || !current) {
    if (current) bench = [...bench, current];
    starters = { ...starters, [pos]: p.id };
  } else bench = [...bench, p.id];
  w = setTeam(w, o.team, { ...t0, starters, bench, academy });
  w = setPlayer(w, {
    ...p,
    team: o.team,
    academy: false,
    faSeasons: 0,
    contract: { team: o.team, endSeason: w.season + o.years, salary: round1(o.salary), role: o.role, generated: false },
  });
  return { ...w, freeAgents: w.freeAgents.filter((x) => x !== o.player) };
}

// 같은 팀 재계약: 로스터 자리는 그대로 두고 계약만 늘린다
export function extend(world: WorldState, id: string, salary: number, years: number): WorldState {
  const p = world.players[id];
  return setPlayer(world, { ...p, faSeasons: 0, contract: { ...p.contract!, endSeason: world.season + years, salary: round1(salary), generated: false } });
}

export const capRoom = (world: WorldState, teamId: string, without: string[] = []) => {
  const t = world.teams[teamId];
  return round1(t.cap - payroll(world.players, mainRoster(t).filter((id) => !without.includes(id))));
};

// 나이에 따른 계약 기간
export const contractYears = (age: number) => (age <= 22 ? 3 : age <= 26 ? 2 : 1);

// ── AI 재계약 ─────────────────────────────────────────
// 계약이 끝나는 선수: 주전이거나 쓸 만한 후보면 요구 연봉으로 재계약. 상한을 넘으면 가치 낮은 순으로 포기
export function aiResign(world: WorldState, teamId: string, expiring: string[], rng: Rng): WorldState {
  let w = world;
  const t = w.teams[teamId];
  const starterIds = new Set(POSITIONS.map((pos) => t.starters[pos]));
  const ranked = [...expiring].sort((a, b) => playerValue(w.players[b]) - playerValue(w.players[a]));
  for (const id of ranked) {
    const p = w.players[id];
    const age = p.age ?? 22;
    const keep = (starterIds.has(id) || playerValue(p) >= 1.5 || (p.academy && age <= 21)) && age <= 30;
    const salary = p.academy ? 0.3 : salaryDemand(p);
    const room = capRoom(w, teamId, [id]);
    const fits = p.academy || salary <= room;
    // 잘하는 선수 일부는 시장을 보려고 재계약을 거절한다 (명성이 낮은 팀일수록)
    const tests = !p.academy && overall(p.ratings) >= 85 && rng.next() < 0.35 * (1 - w.teams[teamId].prestige);
    if (keep && fits && !tests) w = extend(w, id, salary, contractYears(age));
    else w = release(w, id);
  }
  return w;
}

// ── AI 영입 ───────────────────────────────────────────
interface Need {
  pos: Position;
  role: "starter" | "bench";
  weight: number;
}
export function needsOf(world: WorldState, teamId: string): Need[] {
  const t = world.teams[teamId];
  const out: Need[] = [];
  for (const pos of POSITIONS) {
    if (!t.starters[pos]) out.push({ pos, role: "starter", weight: 3 });
    else {
      const backups = t.bench.filter((id) => world.players[id]?.position === pos).length;
      if (!backups && mainRoster(t).length < 7) out.push({ pos, role: "bench", weight: 1 });
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
}

// 팀 하나의 이번 라운드 제안 (최대 2개): 공백 포지션 → 주전 업그레이드 → 후보 보강
export function aiOffers(world: WorldState, teamId: string, rng: Rng): Offer[] {
  const t = world.teams[teamId];
  const offers: Offer[] = [];
  let room = capRoom(world, teamId);
  const pool = world.freeAgents.map((id) => world.players[id]).filter((p) => p && !p.retired);
  const want = (pos: Position, role: "starter" | "bench", minOvr: number) => {
    const cands = pool
      .filter((p) => p.position === pos && overall(p.ratings) >= minOvr && !offers.some((o) => o.player === p.id))
      .map((p) => ({ p, demand: salaryDemand(p) }))
      .filter((x) => x.demand <= room + 0.05)
      .sort((a, b) => overall(b.p.ratings) - overall(a.p.ratings) + 0.5 * (rng.next() - 0.5));
    const pick = cands[0];
    if (!pick) return;
    offers.push({ team: teamId, player: pick.p.id, salary: pick.demand, years: contractYears(pick.p.age ?? 22), role });
    room -= pick.demand;
  };
  for (const need of needsOf(world, teamId)) {
    if (offers.length >= 2) break;
    want(need.pos, need.role, 0);
  }
  if (offers.length < 2 && mainRoster(t).length < MAX_MAIN_ROSTER) {
    // 주전보다 4점 이상 좋은 FA가 있고 연봉이 되면 업그레이드
    const weakest = POSITIONS.filter((pos) => t.starters[pos]).sort((a, b) => overall(world.players[t.starters[a]].ratings) - overall(world.players[t.starters[b]].ratings))[0];
    if (weakest) want(weakest, "starter", overall(world.players[t.starters[weakest]].ratings) + 4);
  }
  return offers;
}

// 한 라운드: 모든 제안을 모아 선수마다 효용이 가장 큰 제안을 고른다. last면 기준을 낮춰 웬만하면 계약
export function resolveOffers(world: WorldState, offers: Offer[], last: boolean): { world: WorldState; signed: Offer[] } {
  let w = world;
  const byPlayer = new Map<string, Offer[]>();
  for (const o of offers) byPlayer.set(o.player, [...(byPlayer.get(o.player) ?? []), o]);
  const signed: Offer[] = [];
  // 몸값 높은 선수부터 결정 (상한 경쟁 순서가 결과에 영향을 덜 주게)
  const order = [...byPlayer.keys()].sort((a, b) => playerValue(w.players[b]) - playerValue(w.players[a]));
  for (const id of order) {
    const p = w.players[id];
    if (!w.freeAgents.includes(id) && !p.contract) continue;
    const valid = byPlayer
      .get(id)!
      .filter((o) => o.salary <= capRoom(w, o.team, [id]) + 0.05 && mainRoster(w.teams[o.team]).filter((x) => x !== id).length < MAX_MAIN_ROSTER);
    if (!valid.length) continue;
    const best = valid.map((o) => ({ o, u: offerUtility(w, p, o) })).sort((a, b) => b.u - a.u)[0];
    if (best.u < (last ? ACCEPT_LAST : ACCEPT)) continue;
    w = sign(w, best.o);
    signed.push(best.o);
  }
  return { world: w, signed };
}

// ── 로스터 채우기 ─────────────────────────────────────
// 주전 공백: 후보 → 2군 → 싼 FA → 신인 순으로 메운다. 1군이 넘치면 가치 낮은 후보부터 방출
export function fillRosters(world: WorldState, rng: Rng, positionTop: Record<Position, string[]>): WorldState {
  let w = world;
  for (const teamId of Object.keys(w.teams)) {
    for (const pos of POSITIONS) {
      let t = w.teams[teamId];
      if (t.starters[pos]) continue;
      const bench = t.bench.filter((id) => w.players[id].position === pos).sort((a, b) => overall(w.players[b].ratings) - overall(w.players[a].ratings))[0];
      if (bench) {
        w = setTeam(w, teamId, { ...t, starters: { ...t.starters, [pos]: bench }, bench: t.bench.filter((x) => x !== bench) });
        continue;
      }
      const acad = t.academy.filter((id) => w.players[id].position === pos).sort((a, b) => overall(w.players[b].ratings) - overall(w.players[a].ratings))[0];
      if (acad) {
        const p = w.players[acad];
        w = setTeam(w, teamId, { ...t, starters: { ...t.starters, [pos]: acad }, academy: t.academy.filter((x) => x !== acad) });
        w = setPlayer(w, { ...p, academy: false, contract: { ...p.contract!, salary: Math.max(p.contract!.salary, Math.min(0.6, capRoom(w, teamId))), role: "starter" } });
        continue;
      }
      const room = capRoom(w, teamId);
      const fa = w.freeAgents
        .map((id) => w.players[id])
        .filter((p) => p.position === pos && salaryDemand(p) * 0.8 <= room)
        .sort((a, b) => overall(b.ratings) - overall(a.ratings))[0];
      if (fa) {
        w = sign(w, { team: teamId, player: fa.id, salary: Math.min(salaryDemand(fa), Math.max(0.6, room)), years: 1, role: "starter" });
        continue;
      }
      t = w.teams[teamId];
      const salary = Math.max(0.1, Math.min(0.6, capRoom(w, teamId)));
      const rookie = seedPool(makeRookie(w, t.league, pos, teamId, false, rng, { replacement: true, salary }), positionTop[pos], rng);
      w = { ...setPlayer(w, rookie), nextRookie: w.nextRookie + 1 };
      w = setTeam(w, teamId, { ...t, starters: { ...t.starters, [pos]: rookie.id } });
    }
    // 1군 인원 상한
    let t = w.teams[teamId];
    while (mainRoster(t).length > MAX_MAIN_ROSTER) {
      const cut = [...t.bench].sort((a, b) => playerValue(w.players[a]) - playerValue(w.players[b]))[0];
      w = release(w, cut);
      t = w.teams[teamId];
    }
  }
  return w;
}

// AI 팀 라인업 정리 (스토브리그 끝): 포지션마다 1군·2군 중 가장 잘하는 선수를 주전으로.
// 기존 주전은 2점 넘게 밀려야 바뀐다. 2군 선수가 주전이 되면 1군으로 올리고, 1군이 넘치면 가치 낮은 후보를 2군(LCK) 또는 방출
export function aiSetLineups(world: WorldState, skipTeam: string | null): WorldState {
  let w = world;
  for (const teamId of Object.keys(w.teams)) {
    if (teamId === skipTeam) continue;
    for (const pos of POSITIONS) {
      const t = w.teams[teamId];
      const cur = t.starters[pos];
      const curOvr = cur ? overall(w.players[cur].ratings) + 2 : -1;
      const cands = [...t.bench, ...t.academy].filter((id) => w.players[id].position === pos);
      const best = cands.sort((a, b) => overall(w.players[b].ratings) - overall(w.players[a].ratings))[0];
      if (!best || overall(w.players[best].ratings) <= curOvr) continue;
      const fromAcademy = t.academy.includes(best);
      const bench = [...t.bench.filter((x) => x !== best), ...(cur ? [cur] : [])];
      w = setTeam(w, teamId, { ...t, starters: { ...t.starters, [pos]: best }, bench, academy: t.academy.filter((x) => x !== best) });
      const p = w.players[best];
      if (fromAcademy) {
        const salary = Math.max(p.contract!.salary, Math.min(0.6, capRoom(w, teamId)));
        w = setPlayer(w, { ...p, academy: false, contract: { ...p.contract!, salary, role: "starter" } });
      }
    }
    // 1군 인원이 넘치면: LCK는 어린 후보를 2군으로, 아니면 가치 낮은 후보 방출
    let t = w.teams[teamId];
    while (mainRoster(t).length > MAX_MAIN_ROSTER) {
      const cut = [...t.bench].sort((a, b) => playerValue(w.players[a]) - playerValue(w.players[b]))[0];
      if (t.league === "LCK" && (w.players[cut].age ?? 30) <= 21) {
        w = setTeam(w, teamId, { ...t, bench: t.bench.filter((x) => x !== cut), academy: [...t.academy, cut] });
        w = setPlayer(w, { ...w.players[cut], academy: true });
      } else w = release(w, cut);
      t = w.teams[teamId];
    }
  }
  return w;
}

// ── 이적료 영입 ───────────────────────────────────────
export interface Bid {
  team: string; // 사는 팀
  player: string;
  fee: number;
  salary: number;
  years: number;
  role: "starter" | "bench";
}

// 파는 팀 판단: 이적료가 몸값 이상이면 판다. 주전을 팔 땐 같은 포지션 대체(후보·2군)가 있거나 이적료가 몸값의 1.3배 이상이어야
export function sellerVerdict(world: WorldState, bid: Bid): { ok: boolean; reason: string } {
  const p = world.players[bid.player];
  const seller = p.contract?.team;
  if (!seller) return { ok: true, reason: "" };
  const t = world.teams[seller];
  const fee = transferFee(p, world.season);
  const isStarter = t.starters[p.position] === p.id;
  const cover = [...t.bench, ...t.academy].some((id) => id !== p.id && world.players[id].position === p.position);
  if (bid.fee < fee) return { ok: false, reason: `이적료 부족 (몸값 ${fee}C)` };
  if (isStarter && !cover && bid.fee < fee * 1.3) return { ok: false, reason: `주전 ${p.position} 대체 선수 없음 (몸값의 1.3배 ${Math.round(fee * 13) / 10}C면 수락)` };
  return { ok: true, reason: "" };
}

// 선수 판단: 새 계약이 지금 계약보다 나아야 옮긴다 (연봉·명성·주전·지역)
export function playerAcceptsMove(world: WorldState, bid: Bid): boolean {
  const p = world.players[bid.player];
  const now = p.contract ? offerUtility(world, p, { team: p.contract.team, player: p.id, salary: p.contract.salary, years: 1, role: p.contract.role }) : 0;
  return offerUtility(world, p, bid) >= now + 0.05;
}

export function canAfford(world: WorldState, bid: Bid): { ok: boolean; reason: string } {
  const t = world.teams[bid.team];
  if (bid.fee > t.transferBudget + 0.05) return { ok: false, reason: `이적 예산 부족 (남은 ${t.transferBudget}C)` };
  if (bid.salary > capRoom(world, bid.team) + 0.05) return { ok: false, reason: `연봉 상한 초과 (여유 ${capRoom(world, bid.team)}C)` };
  if (mainRoster(t).length >= MAX_MAIN_ROSTER) return { ok: false, reason: "1군 인원 초과" };
  return { ok: true, reason: "" };
}

// 이적 확정: 이적료 주고받기 + 새 계약
export function completeBid(world: WorldState, bid: Bid): WorldState {
  const seller = world.players[bid.player].contract?.team;
  let w = world;
  if (seller) w = setTeam(w, seller, { ...w.teams[seller], transferBudget: round1(w.teams[seller].transferBudget + bid.fee) });
  w = setTeam(w, bid.team, { ...w.teams[bid.team], transferBudget: round1(w.teams[bid.team].transferBudget - bid.fee) });
  return sign(w, { team: bid.team, player: bid.player, salary: bid.salary, years: bid.years, role: bid.role });
}

// AI 이적료 영입: 명성 높은 팀부터, 가장 약한 주전 포지션에 4점 이상 나은 선수를 산다 (팀당 1명)
export function aiBuyouts(world: WorldState, rng: Rng, skipTeam: string | null): { world: WorldState; done: Bid[] } {
  let w = world;
  const done: Bid[] = [];
  const order = Object.values(w.teams).filter((t) => t.id !== skipTeam).sort((a, b) => b.prestige - a.prestige + 0.1 * (rng.next() - 0.5));
  for (const buyer of order) {
    const t = w.teams[buyer.id];
    const weakest = POSITIONS.filter((pos) => t.starters[pos]).sort((a, b) => overall(w.players[t.starters[a]].ratings) - overall(w.players[t.starters[b]].ratings))[0];
    if (!weakest) continue;
    const curOvr = overall(w.players[t.starters[weakest]].ratings);
    const targets = Object.values(w.players)
      .filter((p) => !p.retired && p.contract && p.contract.team !== buyer.id && p.position === weakest && !p.academy && p.contract.team !== skipTeam)
      .filter((p) => overall(p.ratings) >= curOvr + 4)
      .sort((a, b) => overall(b.ratings) - overall(a.ratings));
    for (const p of targets.slice(0, 5)) {
      const bid: Bid = { team: buyer.id, player: p.id, fee: transferFee(p, w.season), salary: salaryDemand(p), years: contractYears(p.age ?? 22), role: "starter" };
      if (!canAfford(w, bid).ok || !sellerVerdict(w, bid).ok || !playerAcceptsMove(w, bid)) continue;
      w = completeBid(w, bid);
      done.push(bid);
      break;
    }
  }
  return { world: w, done };
}
