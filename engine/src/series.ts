// BO1/BO3/BO5 시리즈. 1세트는 첫 번째 팀이 블루, 이후엔 진 팀이 진영을 고른다(블루 선택).
// 피어리스(기본값): 이전 세트에 나온 챔피언은 양 팀 모두 다시 못 쓴다.
import { runDraft } from "./draft.ts";
import { simulateGame } from "./match.ts";
import type { Params } from "./params.ts";
import type { Rng } from "./rng.ts";
import type { DraftResult, GameResult, Lineup, Side, Universe } from "./types.ts";
import { POSITIONS } from "./types.ts";

export interface SeriesGame {
  blue: string;
  red: string;
  draft: DraftResult;
  result: GameResult;
}

export interface SeriesResult {
  teams: [string, string];
  bestOf: number;
  score: [number, number];
  winner: string;
  games: SeriesGame[];
}

// 튜너가 재사용하는 드래프트를 끼워 넣을 수 있게 분리. 제공 함수는 받은 금지 목록(unavailable)을 꼭 지켜야 한다
export type DraftProvider = (
  gameIndex: number,
  lineups: Record<Side, Lineup>,
  unavailable: ReadonlySet<string>,
  rng: Rng,
) => DraftResult;

export interface SeriesOptions {
  bestOf?: 1 | 3 | 5;
  fearless?: boolean;
  log?: boolean;
  draft?: DraftProvider;
}

export function playSeries(u: Universe, a: Lineup, b: Lineup, p: Params, rng: Rng, opts: SeriesOptions = {}): SeriesResult {
  const bestOf = opts.bestOf ?? 3;
  const need = Math.ceil(bestOf / 2);
  const fearless = opts.fearless ?? true;
  const draftFor: DraftProvider = opts.draft ?? ((_, lineups, unavailable, r) => runDraft(u, lineups, p, r, { unavailable }));
  const score: [number, number] = [0, 0];
  const games: SeriesGame[] = [];
  const used = new Set<string>();
  let blue = a;
  let red = b;

  for (let g = 0; score[0] < need && score[1] < need; g++) {
    const lineups = { blue, red };
    const gameRng = rng.fork(`game${g}`);
    const draft = draftFor(g, lineups, fearless ? used : new Set(), gameRng);
    const result = simulateGame(u, lineups, draft, p, gameRng.fork("sim"), { log: opts.log });
    if (fearless) for (const side of ["blue", "red"] as Side[]) for (const pos of POSITIONS) used.add(draft.picks[side][pos]);
    games.push({ blue: blue.team.id, red: red.team.id, draft, result });
    const winnerId = lineups[result.winner].team.id;
    score[winnerId === a.team.id ? 0 : 1]++;
    // 진 팀이 다음 세트 블루
    const loser = winnerId === blue.team.id ? red : blue;
    const winnerLineup = loser === blue ? red : blue;
    blue = loser;
    red = winnerLineup;
  }
  return {
    teams: [a.team.id, b.team.id],
    bestOf,
    score,
    winner: score[0] > score[1] ? a.team.id : b.team.id,
    games,
  };
}
