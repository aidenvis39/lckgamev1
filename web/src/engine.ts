// 엔진 데이터를 번들에 넣고 브라우저에서 Universe를 만든다.
import champions from "../../engine/data/champions.json";
import matchups from "../../engine/data/matchups.json";
import tuned from "../../engine/data/params.json";
import players from "../../engine/data/players.json";
import targets from "../../engine/data/targets.json";
import teams from "../../engine/data/teams.json";
import { DEFAULT_PARAMS, type Params } from "../../engine/src/params.ts";
import type { Universe } from "../../engine/src/types.ts";
import { createUniverse, type RawData } from "../../engine/src/universe.ts";

export const baseUniverse: Universe = createUniverse({ players, champions, teams, matchups } as unknown as RawData);
export const params: Params = { ...DEFAULT_PARAMS, ...(tuned as unknown as Partial<Params>) };

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
