// 해외 리그와 국제전 맞추기.
//  1) 해외 팀워크: 리그마다 더블 라운드로빈을 돌려 팀별 시뮬 승률을 실제 2026 승률에 맞춘다 (리그 안 평균 0).
//     리그 보정(leagueOffset)은 같은 리그 선수 모두에게 똑같이 더해져서 리그 안 경기엔 영향이 없다.
//  2) 리그 보정: 리그 대표(월즈 출전권 수만큼 상위 팀)끼리 맞붙인 승률을 국제전 리그 강도(브래들리-테리) 승률에 맞춘다. LCK = 0.
import { runDraft } from "./draft.ts";
import { lineupOf } from "./lineup.ts";
import { simulateGame } from "./match.ts";
import type { Params } from "./params.ts";
import { createRng, hashSeed } from "./rng.ts";
import { playSeason, type SeasonResult } from "./season.ts";
import type { Targets, WorldTargets } from "./targets.ts";
import { buildDraftPool } from "./tune.ts";
import type { DraftResult, Universe } from "./types.ts";
import { applyLeagueOffsets, leagueUniverse } from "./universe.ts";
import { OVERSEAS } from "./competition/year.ts";

const clampLogit = (x: number) => {
  const v = Math.min(0.98, Math.max(0.02, x));
  return Math.log(v / (1 - v));
};

export function teamGameWinrates(seasons: SeasonResult[]): Record<string, number> {
  const tally = new Map<string, [number, number]>();
  for (const s of seasons)
    for (const x of s.series)
      for (const g of x.games) {
        for (const side of ["blue", "red"] as const) {
          const id = side === "blue" ? g.blue : g.red;
          const t = tally.get(id) ?? [0, 0];
          t[0] += g.result.winner === side ? 1 : 0;
          t[1] += 1;
          tally.set(id, t);
        }
      }
  return Object.fromEntries([...tally].map(([id, [w, n]]) => [id, w / n]));
}

export function simulateLeague(world: Universe, league: string, p: Params, seasons: number, seed: number, draft = buildDraftPool(leagueUniverse(world, league), p, seed)) {
  const lu = leagueUniverse(world, league);
  const runs = Array.from({ length: seasons }, (_, i) => playSeason(lu, p, createRng(hashSeed(seed, league, i)), { format: "double-rr", draft }));
  return teamGameWinrates(runs);
}

export function fitOverseasTeamwork(world: Universe, wt: WorldTargets, start: Params, seasons: number, seed: number, rounds = 12, log?: (msg: string) => void): Params {
  let p = start;
  for (const league of OVERSEAS) {
    const lu = leagueUniverse(world, league);
    const draft = buildDraftPool(lu, p, seed);
    const real = wt.teamWinrate[league];
    const ids = [...lu.teams.keys()];
    for (let r = 0; r < rounds; r++) {
      const sim = simulateLeague(world, league, p, seasons, seed, draft);
      const tw = { ...p.teamwork };
      for (const id of ids) tw[id] = (tw[id] ?? 0) + (0.25 * (clampLogit(real[id]) - clampLogit(sim[id]))) / Math.max(0.2, p.fightSkill);
      const avg = ids.reduce((a, id) => a + tw[id], 0) / ids.length;
      for (const id of ids) tw[id] -= avg;
      p = { ...p, teamwork: tw };
    }
    const sim = simulateLeague(world, league, p, seasons, seed, draft);
    const rmse = Math.sqrt(ids.reduce((a, id) => a + (sim[id] - real[id]) ** 2, 0) / ids.length);
    log?.(`${league} 팀워크 맞춤: 팀별 승률 오차 ${(rmse * 100).toFixed(1)}%p`);
  }
  return p;
}

// 리그 대표: 실제 승률 상위 (월즈 출전권 수만큼. 2026 실제 배분: LCK·LPL이 MSI로 1장씩 더 받음)
const REPRESENTATIVES: Record<string, number> = { LCK: 4, LPL: 4, LEC: 3, LCS: 3, LCP: 3, CBLOL: 2 };
export function representatives(world: Universe, targets: Targets, wt: WorldTargets): Record<string, string[]> {
  const real: Record<string, Record<string, number>> = { LCK: targets.team_regular_winrate, ...wt.teamWinrate };
  return Object.fromEntries(
    Object.entries(REPRESENTATIVES).map(([lg, n]) => [
      lg,
      [...world.teams.values()]
        .filter((t) => t.league === lg)
        .map((t) => t.id)
        .sort((a, b) => (real[lg][b] ?? 0) - (real[lg][a] ?? 0))
        .slice(0, n),
    ]),
  );
}

export interface PairResult {
  a: string;
  b: string;
  weight: number;
  sim: number;
  target: number;
  raw: number | null;
}

// 리그 쌍마다 대표 팀끼리 진영을 바꿔가며 games판씩. 밴픽은 리그 보정과 무관해서 한 번 만들어 재사용한다
export function makeInternationalProbe(world: Universe, targets: Targets, wt: WorldTargets, p: Params, gamesPerPair: number, seed: number) {
  const reps = representatives(world, targets, wt);
  const drafts = new Map<string, DraftResult[]>();
  const draftsFor = (blue: string, red: string) => {
    const key = `${blue}|${red}`;
    if (!drafts.has(key)) {
      const lineups = { blue: lineupOf(world, blue), red: lineupOf(world, red) };
      drafts.set(key, Array.from({ length: gamesPerPair }, (_, g) => runDraft(world, lineups, p, createRng(hashSeed(seed, "intl-draft", key, g)))));
    }
    return drafts.get(key)!;
  };
  return (params: Params): PairResult[] => {
    const u = applyLeagueOffsets(world, params.leagueOffset);
    return wt.international.pairs.map(([a, b, weight, target, raw]) => {
      let wins = 0;
      let n = 0;
      for (const ta of reps[a])
        for (const tb of reps[b])
          for (const [blue, red] of [[ta, tb], [tb, ta]]) {
            const lineups = { blue: lineupOf(u, blue), red: lineupOf(u, red) };
            draftsFor(blue, red).forEach((d, g) => {
              const r = simulateGame(u, lineups, d, params, createRng(hashSeed(seed, "intl", blue, red, g)));
              wins += (r.winner === "blue") === (blue === ta) ? 1 : 0;
              n++;
            });
          }
      return { a, b, weight, sim: wins / n, target, raw };
    });
  };
}

export function fitLeagueOffsets(world: Universe, targets: Targets, wt: WorldTargets, start: Params, gamesPerPair: number, seed: number, rounds = 10, log?: (msg: string) => void): Params {
  const probe = makeInternationalProbe(world, targets, wt, start, gamesPerPair, seed);
  const leagues = Object.keys(REPRESENTATIVES).filter((lg) => lg !== "LCK");
  let p: Params = { ...start, leagueOffset: { LCK: 0, ...start.leagueOffset } as Record<string, number> };
  // 능력치 1점이 국제전 로짓을 얼마나 바꾸는지: 해외 전체를 +4점 올렸을 때 LCK 상대 로짓 변화
  const lckLogit = (q: Params) => {
    const rows = probe(q).filter((r) => r.a === "LCK");
    return rows.reduce((s, r) => s + r.weight * clampLogit(r.sim), 0) / rows.reduce((s, r) => s + r.weight, 0);
  };
  const bump = 4;
  const up = { ...p, leagueOffset: { ...p.leagueOffset, ...Object.fromEntries(leagues.map((lg) => [lg, (p.leagueOffset[lg] ?? 0) + bump])) } };
  const slope = Math.max(0.02, (lckLogit(p) - lckLogit(up)) / bump);
  log?.(`능력치 1점 = 국제전 로짓 ${slope.toFixed(3)}`);
  for (let r = 0; r < rounds; r++) {
    const rows = probe(p);
    const off = { ...p.leagueOffset };
    for (const lg of leagues) {
      let num = 0;
      let den = 0;
      for (const row of rows) {
        if (row.a !== lg && row.b !== lg) continue;
        const sign = row.a === lg ? 1 : -1; // lg 기준 로짓
        const w = row.weight + 5;
        num += w * sign * (clampLogit(row.target) - clampLogit(row.sim));
        den += w;
      }
      off[lg] = (off[lg] ?? 0) + (0.8 * num) / den / slope;
    }
    p = { ...p, leagueOffset: Object.fromEntries(Object.entries(off).map(([k, v]) => [k, Math.round(v * 100) / 100])) };
    const err = rows.reduce((s, x) => s + x.weight * (x.sim - x.target) ** 2, 0) / rows.reduce((s, x) => s + x.weight, 0);
    log?.(`리그 보정 ${r + 1}회: 가중 오차 ${(Math.sqrt(err) * 100).toFixed(1)}%p  ${leagues.map((lg) => `${lg} ${p.leagueOffset[lg].toFixed(1)}`).join("  ")}`);
  }
  return p;
}

