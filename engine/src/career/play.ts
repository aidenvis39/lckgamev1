// 다년 커리어를 AI끼리 돌린다 (CLI 검증, 웹의 '모든 팀 AI' 진행과 같은 순서).
import { simulateMatch } from "../competition/play.ts";
import { createYear, endDay, recordResult, teamsByLeague, todayMatches, type YearState } from "../competition/year.ts";
import type { Params } from "../params.ts";
import { createRng, hashSeed } from "../rng.ts";
import type { Universe } from "../types.ts";
import { crossedCheckpoints, developAt } from "./develop.ts";
import { beginOpening } from "./opening.ts";
import { beginOffseason, closeSeason, finishOffseason, runAiMarket } from "./rollover.ts";
import { recordSeries } from "./stats.ts";
import { emptyStats, type SeasonStats, type WorldState } from "./types.ts";
import { toUniverse, worldParams } from "./world.ts";

export const yearSeed = (world: WorldState) => hashSeed(world.seed, world.season, "year");

export function newYearFor(world: WorldState, userTeam: string | null = null): YearState {
  return createYear(teamsByLeague(Object.values(world.teams)), yearSeed(world), userTeam, world.season);
}

// 하루 진행: 남은 경기 시뮬 → 기록 → 다음 날 → 지나간 성장 시점 적용
export function playDay(world: WorldState, y: YearState, stats: SeasonStats, base: Universe, p: Params, u = toUniverse(world, base, stats)): { world: WorldState; year: YearState; universe: Universe; grew: boolean } {
  const wp = worldParams(world, p);
  let year = y;
  for (const m of todayMatches(year)) {
    if (year.results[m.id]) continue;
    const r = simulateMatch(u, wp, year.seed, m);
    year = recordResult(year, m.id, r.outcome);
    recordSeries(stats, u, r.series);
  }
  const next = endDay(year);
  let w = world;
  const cps = crossedCheckpoints(year, next);
  for (const cp of cps) w = developAt(w, cp, stats, next);
  return { world: w, year: next, universe: cps.length ? toUniverse(w, base, stats) : u, grew: cps.length > 0 };
}

export function playCareerSeason(world: WorldState, base: Universe, p: Params): { world: WorldState; year: YearState; stats: SeasonStats } {
  const stats = emptyStats();
  let w = world;
  let y = newYearFor(w);
  let u = toUniverse(w, base, stats);
  while (y.phase !== "DONE") {
    const r = playDay(w, y, stats, base, p, u);
    w = r.world;
    y = r.year;
    u = r.universe;
  }
  return { world: w, year: y, stats };
}

export function aiOffseason(world: WorldState, y: YearState, stats: SeasonStats, base: Universe): WorldState {
  let w = closeSeason(world, y);
  const begun = beginOffseason(w, stats, base.champions);
  const market = runAiMarket(begun.world, begun.expiring, 4, null, createRng(hashSeed(w.seed, w.season, "market")));
  w = finishOffseason(market.world, stats, base.champions);
  return w;
}

// 첫 스토브리그(2025 → 2026)를 AI만으로: 실제 은퇴 → 계약 끝난 선수 FA → 사전 합의대로 실제 2026 팀에 → 2026 시즌 시작
export function aiOpening(world: WorldState, base: Universe): WorldState {
  const begun = beginOpening(world);
  const market = runAiMarket(begun.world, begun.expiring, 4, null, createRng(hashSeed(world.seed, world.season, "market")));
  return finishOffseason(market.world, emptyStats(), base.champions);
}
