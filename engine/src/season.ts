// 정규시즌 (LCK 2026 방식). 전부 BO3.
//   1~2라운드: 10팀 더블 라운드로빈 (90시리즈)
//   3~4라운드: 1~2라운드 1~5위(레전드)와 6~10위(라이즈)로 나눠 그룹 안에서 더블 라운드로빈 (40시리즈)
// 최종 순위는 전체 성적 합산. format: "double-rr" 이면 1~2라운드만 한다.
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
  groups: { legend: string[]; rise: string[] } | null;
}

export interface SeasonOptions {
  format?: "lck2026" | "double-rr";
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

  const play = (stage: string, home: string, away: string) => {
    const s = playSeries(u, lineupOf(u, home), lineupOf(u, away), p, rng.fork(`${stage}:${home}:${away}`), {
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
  };
  const doubleRoundRobin = (stage: string, group: string[]) => {
    for (let round = 0; round < 2; round++)
      for (let i = 0; i < group.length; i++)
        for (let j = i + 1; j < group.length; j++)
          round === 0 ? play(`${stage}r${round}`, group[i], group[j]) : play(`${stage}r${round}`, group[j], group[i]);
  };
  const ranked = () =>
    [...table.values()].sort(
      (x, y) => y.seriesWins - x.seriesWins || y.gameWins - y.gameLosses - (x.gameWins - x.gameLosses),
    );

  doubleRoundRobin("R12", teams);
  let groups: SeasonResult["groups"] = null;
  if ((opts.format ?? "lck2026") === "lck2026") {
    const order = ranked().map((s) => s.team);
    groups = { legend: order.slice(0, 5), rise: order.slice(5) };
    doubleRoundRobin("R34L", groups.legend);
    doubleRoundRobin("R34R", groups.rise);
  }
  return { standings: ranked(), series, groups };
}
