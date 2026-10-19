// 엔진 데이터를 번들에 넣고 브라우저에서 Universe를 만든다. LCK + 해외 5개 리그 56팀이 한 세계에 있다.
import academy from "../../engine/data/academy.json";
import careerParams_ from "../../engine/data/careerParams.json";
import champions from "../../engine/data/champions.json";
import worldTargets from "../../engine/data/world.json";
import matchups from "../../engine/data/matchups.json";
import tuned from "../../engine/data/params.json";
import players from "../../engine/data/players.json";
import start2025 from "../../engine/data/start2025.json";
import targets from "../../engine/data/targets.json";
import teams from "../../engine/data/teams.json";
import { DEFAULT_PARAMS, type Params } from "../../engine/src/params.ts";
import type { Champion, Player, TeamInfo, Universe } from "../../engine/src/types.ts";
import type { Targets, WorldTargets } from "../../engine/src/targets.ts";
import { withDefaults, type CareerParams } from "../../engine/src/career/params.ts";
import type { Start2025 } from "../../engine/src/career/types.ts";
import { initWorld } from "../../engine/src/career/world.ts";
import { applyLeagueOffsets, createUniverse, leagueUniverse, type RawData } from "../../engine/src/universe.ts";

export type { Params };
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
  worldsSlotsOf,
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

// ── 다년 커리어 ───────────────────────────────────────
// 커리어 조절값 (성장·노쇠·신인·은퇴). 저장을 불러올 때도 이 최신 값으로 바꾼다
export const careerParams: CareerParams = withDefaults(careerParams_ as Partial<Record<keyof CareerParams, object>>);
export function newWorld(seed: number) {
  return initWorld({
    players: players as unknown as Player[],
    academy: academy as unknown as Player[],
    teams: teams as unknown as TeamInfo[],
    champions: champions as unknown as Champion[],
    params,
    world: worldTargets as unknown as WorldTargets,
    start: startData,
    seed,
    cp: careerParams,
  });
}
export { mainRoster, toUniverse, validateWorld, worldParams, MAX_MAIN_ROSTER, OPENING_SEASON, FIRST_SEASON } from "../../engine/src/career/world.ts";
export { CHECKPOINTS, crossedCheckpoints, developAt } from "../../engine/src/career/develop.ts";
export { aiOpening, newYearFor } from "../../engine/src/career/play.ts";
export { beginOpening } from "../../engine/src/career/opening.ts";
export { upgradeWorld } from "../../engine/src/career/migrate.ts";
export const startData = start2025 as unknown as Start2025;
export { beginOffseason, closeSeason, finishOffseason, positionTop } from "../../engine/src/career/rollover.ts";
export { makeRookie, seedPool } from "../../engine/src/career/rookies.ts";
export { goalsFor } from "../../engine/src/career/owner.ts";
export type { Goal } from "../../engine/src/career/owner.ts";
export { recordSeries, cloneStats } from "../../engine/src/career/stats.ts";
export { ABILITIES, emptyStats } from "../../engine/src/career/types.ts";
export type { GrowthReport, PlayerState, PreAgreement, SeasonStats, Start2025, TeamState, WorldState, Ability } from "../../engine/src/career/types.ts";
export { headroom, overall, payroll, playerValue, potentialStars, salaryDemand, transferFee } from "../../engine/src/career/value.ts";
export { ACCEPT, capRoom, isPreAgreed, offerUtility, preOffers } from "../../engine/src/career/market.ts";
export type { Bid, Offer } from "../../engine/src/career/market.ts";
export {
  acceptance,
  applyTrade,
  bidFor,
  checkOffer,
  demote,
  evaluateTrade,
  fillStarters,
  marketRound,
  openMarket,
  promote,
  registrationIssues,
  releaseMine,
  resignMine,
  salaryNeeded,
  setStarter,
  signNow,
  toggleFocus,
} from "../../engine/src/career/userMarket.ts";
export type { Result, TradeProposal } from "../../engine/src/career/userMarket.ts";
