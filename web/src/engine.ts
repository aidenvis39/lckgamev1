// 엔진 데이터를 번들에 넣고 브라우저에서 Universe를 만든다. LCK + 해외 5개 리그 56팀이 한 세계에 있다.
import champions from "../../engine/data/champions.json";
import matchups from "../../engine/data/matchups.json";
import tuned from "../../engine/data/params.json";
import players from "../../engine/data/players.json";
import targets from "../../engine/data/targets.json";
import teams from "../../engine/data/teams.json";
import { DEFAULT_PARAMS, type Params } from "../../engine/src/params.ts";
import type { Universe } from "../../engine/src/types.ts";
import { applyLeagueOffsets, createUniverse, leagueUniverse, type RawData } from "../../engine/src/universe.ts";

export const params: Params = { ...DEFAULT_PARAMS, ...(tuned as unknown as Partial<Params>) };
// 리그 보정을 더해 모든 선수 능력치를 LCK 기준 하나로 맞춘 세계
export const baseUniverse: Universe = applyLeagueOffsets(createUniverse({ players, champions, teams, matchups } as unknown as RawData), params.leagueOffset);
export const lckUniverse: Universe = leagueUniverse(baseUniverse, "LCK");

// 2026 실제 정규시즌 세트 승률 (팀 선택 화면 참고용)
export const realWinrate2026: Record<string, number> = (targets as { "2026": { team_regular_winrate: Record<string, number> } })[
  "2026"
].team_regular_winrate;

export { DRAFT_ORDER, aiChoice, applyChoice, currentTurn, newDraft, pickValue, rankOptions, runDraft, toResult } from "../../engine/src/draft.ts";
export type { DraftContext, DraftOption, DraftState } from "../../engine/src/draft.ts";
export { lineupOf, swapPlayers } from "../../engine/src/lineup.ts";
export { simulateGame } from "../../engine/src/match.ts";
export { createRng, hashSeed } from "../../engine/src/rng.ts";
export type { Rng } from "../../engine/src/rng.ts";
export { playSeries } from "../../engine/src/series.ts";
export type { SeriesResult } from "../../engine/src/series.ts";
export { simulateMatch } from "../../engine/src/competition/play.ts";
export {
  bracketDefOf,
  bracketView,
  champion,
  choose,
  createYear,
  endDay,
  lckGroupStandings,
  lckSpringStandings,
  leagueStandings,
  LEAGUES,
  OVERSEAS,
  pendingChoice,
  PHASES,
  phaseName,
  recordResult,
  RULES,
  swissTable,
  teamsByLeague,
  todayMatches,
} from "../../engine/src/competition/year.ts";
export type { PhaseId, YearState } from "../../engine/src/competition/year.ts";
export { resolveSlot } from "../../engine/src/competition/bracket.ts";
export type { BracketDef, BracketView, Slot } from "../../engine/src/competition/bracket.ts";
export type { Standing } from "../../engine/src/competition/standings.ts";
export type { Entrant, Match, Outcome } from "../../engine/src/competition/types.ts";
export { mastery } from "../../engine/src/strength.ts";
export { POSITIONS, SIDES, other } from "../../engine/src/types.ts";
export type {
  Champion,
  DraftResult,
  DraftStep,
  GameResult,
  Lineup,
  Player,
  Position,
  Side,
  TeamInfo,
  TimelineEntry,
  Universe,
} from "../../engine/src/types.ts";
