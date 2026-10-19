// 시즌 기록 쌓기: 시리즈마다 선수별 출전 세트와 챔피언을 센다 (성장 출전 비율, 다음 시즌 챔피언 풀).
import type { SeriesResult } from "../series.ts";
import type { Universe } from "../types.ts";
import { POSITIONS } from "../types.ts";
import type { SeasonStats } from "./types.ts";

// stats를 직접 바꾼다 (하루치 시뮬 안에서 여러 번 부르므로 복사하지 않음). 부르는 쪽이 필요하면 미리 복사한다
export function recordSeries(stats: SeasonStats, u: Universe, series: SeriesResult): void {
  for (const g of series.games) {
    for (const side of ["blue", "red"] as const) {
      const team = side === "blue" ? g.blue : g.red;
      const t = u.teams.get(team);
      if (!t) continue;
      stats.teamGames[team] = (stats.teamGames[team] ?? 0) + 1;
      for (const pos of POSITIONS) {
        const id = t.starters[pos];
        const champ = g.draft.picks[side][pos];
        stats.games[id] = (stats.games[id] ?? 0) + 1;
        const picks = (stats.picks[id] ??= {});
        picks[champ] = (picks[champ] ?? 0) + 1;
      }
    }
  }
}

export const cloneStats = (s: SeasonStats): SeasonStats => ({
  games: { ...s.games },
  picks: Object.fromEntries(Object.entries(s.picks).map(([k, v]) => [k, { ...v }])),
  teamGames: { ...s.teamGames },
});
