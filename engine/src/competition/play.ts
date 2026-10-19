// 한 해를 AI끼리 끝까지 돌린다 (CLI 검증, 웹의 AI 경기).
import { lineupOf } from "../lineup.ts";
import type { Params } from "../params.ts";
import { createRng, hashSeed } from "../rng.ts";
import { playSeries, type DraftProvider, type SeriesResult } from "../series.ts";
import type { Universe } from "../types.ts";
import type { Match, Outcome } from "./types.ts";
import { createYear, endDay, recordResult, teamsByLeague, todayMatches, type YearState } from "./year.ts";

// 경기별 난수는 (해 시드, 경기 id)로 정해진다. 언제 시뮬해도 같은 결과
export function simulateMatch(u: Universe, p: Params, seed: number, m: Match, draft?: DraftProvider): { outcome: Outcome; series: SeriesResult } {
  const series = playSeries(u, lineupOf(u, m.home), lineupOf(u, m.away), p, createRng(hashSeed(seed, m.id)), {
    bestOf: m.bestOf,
    draft,
  });
  return { outcome: { winner: series.winner, score: series.score }, series };
}

export function simulateDay(st: YearState, u: Universe, p: Params, skip: (m: Match) => boolean = () => false, draft?: DraftProvider): YearState {
  let s = st;
  for (const m of todayMatches(s)) {
    if (s.results[m.id] || skip(m)) continue;
    s = recordResult(s, m.id, simulateMatch(u, p, s.seed, m, draft).outcome);
  }
  return s;
}

export function playYear(u: Universe, p: Params, seed: number, draft?: DraftProvider): YearState {
  let st = createYear(teamsByLeague(u.teams.values()), seed);
  while (st.phase !== "DONE") st = endDay(simulateDay(st, u, p, undefined, draft));
  return st;
}
