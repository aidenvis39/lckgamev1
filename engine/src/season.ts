// 정규시즌: 10팀 더블 라운드로빈(팀당 18시리즈), 전부 BO3.
import { lineupOf } from "./lineup.ts";
import type { Params } from "./params.ts";
import type { Rng } from "./rng.ts";
import { playSeries, type DraftProvider, type SeriesResult } from "./series.ts";
import type { Universe } from "./types.ts";

export interface Standing {
  team: string;
  seriesWins: number;
  seriesLosses: number;
  gameWins: number;
  gameLosses: number;
}

export interface SeasonResult {
  standings: Standing[]; // 순위순
  series: SeriesResult[];
}

export interface SeasonOptions {
  fearless?: boolean;
  log?: boolean;
  draft?: DraftProvider;
}

export function playSeason(u: Universe, p: Params, rng: Rng, opts: SeasonOptions = {}): SeasonResult {
  const teams = [...u.teams.keys()];
  const table = new Map<string, Standing>(
    teams.map((t) => [t, { team: t, seriesWins: 0, seriesLosses: 0, gameWins: 0, gameLosses: 0 }]),
  );
  const series: SeriesResult[] = [];
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const [home, away] = round === 0 ? [teams[i], teams[j]] : [teams[j], teams[i]];
        const s = playSeries(u, lineupOf(u, home), lineupOf(u, away), p, rng.fork(`${round}:${home}:${away}`), {
          bestOf: 3,
          fearless: opts.fearless,
          log: opts.log,
          draft: opts.draft,
        });
        series.push(s);
        const [h, a] = [table.get(home)!, table.get(away)!];
        const homeWon = s.winner === home;
        (homeWon ? h : a).seriesWins++;
        (homeWon ? a : h).seriesLosses++;
        h.gameWins += s.score[0];
        h.gameLosses += s.score[1];
        a.gameWins += s.score[1];
        a.gameLosses += s.score[0];
      }
    }
  }
  const standings = [...table.values()].sort(
    (x, y) => y.seriesWins - x.seriesWins || y.gameWins - y.gameLosses - (x.gameWins - x.gameLosses),
  );
  return { standings, series };
}
