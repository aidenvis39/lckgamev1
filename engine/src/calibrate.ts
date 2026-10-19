// 시뮬 결과를 실제 LCK 통계(targets.json)와 같은 방식으로 집계해서 비교한다.
import type { Targets } from "./data.ts";
import type { SeasonResult } from "./season.ts";
import type { GameResult, Position, Side } from "./types.ts";
import { POSITIONS } from "./types.ts";

const POS_KO: Record<Position, string> = { top: "탑", jng: "정글", mid: "미드", bot: "원딜", sup: "서폿" };

export interface Metrics {
  games: number;
  lengthMean: number;
  lengthStd: number;
  lengthP10: number;
  lengthP90: number;
  killsMean: number;
  killsStd: number;
  dragonsMean: number;
  baronsMean: number;
  towersMean: number;
  blueWinrate: number;
  gd15Std: number;
  gd15Coef: number;
  comeback3k: number;
  firstBlood: number;
  firstDragon: number;
  firstTower: number;
  firstBaron: number;
  laneWeight: Record<Position, number>;
  teamWinrateStd: number;
  bo3Game1Conversion: number;
  bo3Sweep: number;
  upset: Array<[string, number, number]>; // [승률 차이 구간, 경기 수, 강팀 승률]
}

export function measure(seasons: SeasonResult[]): Metrics {
  const games: GameResult[] = seasons.flatMap((s) => s.series.flatMap((x) => x.games.map((g) => g.result)));
  const len = games.map((g) => g.duration);
  const kills = games.map((g) => g.kills.blue + g.kills.red);
  const winOf = (g: GameResult, s: Side) => (g.winner === s ? 1 : 0);

  // 15분 골드차: 팀 관점 2행씩 (실제 데이터와 같은 방식)
  const gdX: number[][] = [];
  const gdY: number[] = [];
  const laneX: number[][] = [];
  for (const g of games) {
    for (const s of ["blue", "red"] as Side[]) {
      const sign = s === "blue" ? 1 : -1;
      gdX.push([(sign * g.gd15) / 1000]);
      gdY.push(winOf(g, s));
      laneX.push(POSITIONS.map((pos) => sign * g.laneGd15[pos]));
    }
  }
  const ahead3k = gdX.map((x, i) => [x[0], gdY[i]]).filter(([x]) => x >= 3);
  const laneStd = POSITIONS.map((_, j) => std(laneX.map((r) => r[j])));
  const laneCoef = logisticFit(laneX.map((r) => r.map((v, j) => v / laneStd[j])), gdY).slice(1);
  const coefSum = laneCoef.reduce((a, b) => a + b, 0);

  const firstRate = (key: "blood" | "dragon" | "tower" | "baron") => {
    const rows = games.filter((g) => g.firsts[key] !== null);
    return mean(rows.map((g) => (g.firsts[key] === g.winner ? 1 : 0)));
  };

  const bo3 = seasons.flatMap((s) => s.series.filter((x) => x.bestOf === 3));
  const conv = bo3.map((x) => {
    const g1 = x.games[0];
    const g1Winner = g1.result.winner === "blue" ? g1.blue : g1.red;
    return g1Winner === x.winner ? 1 : 0;
  });

  // 시즌 승률 표준편차 + 승률 차이별 강팀 승률 (실제 데이터와 같은 구간)
  const teamStd: number[] = [];
  const buckets: Array<[string, number, number]> = [
    ["0~10%p", 0, 0.1], ["10~20%p", 0.1, 0.2], ["20~30%p", 0.2, 0.3], ["30~45%p", 0.3, 0.45], ["45%p+", 0.45, 1.01],
  ];
  const upsetHits = buckets.map(() => [0, 0]);
  for (const s of seasons) {
    const wp = new Map(s.standings.map((t) => [t.team, t.gameWins / (t.gameWins + t.gameLosses)]));
    teamStd.push(std([...wp.values()]));
    for (const x of s.series) {
      for (const g of x.games) {
        const gap = Math.abs(wp.get(g.blue)! - wp.get(g.red)!);
        const strongerBlue = wp.get(g.blue)! >= wp.get(g.red)!;
        const strongerWon = (g.result.winner === "blue") === strongerBlue ? 1 : 0;
        const b = buckets.findIndex(([, lo, hi]) => gap >= lo && gap < hi);
        upsetHits[b][0]++;
        upsetHits[b][1] += strongerWon;
      }
    }
  }

  return {
    games: games.length,
    lengthMean: mean(len),
    lengthStd: std(len),
    lengthP10: quantile(len, 0.1),
    lengthP90: quantile(len, 0.9),
    killsMean: mean(kills),
    killsStd: std(kills),
    dragonsMean: mean(games.map((g) => g.dragons.blue + g.dragons.red)),
    baronsMean: mean(games.map((g) => g.barons.blue + g.barons.red)),
    towersMean: mean(games.map((g) => g.towers.blue + g.towers.red)),
    blueWinrate: mean(games.map((g) => winOf(g, "blue"))),
    gd15Std: Math.sqrt(mean(games.map((g) => g.gd15 * g.gd15))),
    gd15Coef: logisticFit(gdX, gdY)[1],
    comeback3k: ahead3k.length ? 1 - mean(ahead3k.map(([, y]) => y)) : NaN,
    firstBlood: firstRate("blood"),
    firstDragon: firstRate("dragon"),
    firstTower: firstRate("tower"),
    firstBaron: firstRate("baron"),
    laneWeight: Object.fromEntries(POSITIONS.map((pos, j) => [pos, laneCoef[j] / coefSum])) as Record<Position, number>,
    teamWinrateStd: mean(teamStd),
    bo3Game1Conversion: mean(conv),
    bo3Sweep: mean(bo3.map((x) => (x.games.length === 2 ? 1 : 0))),
    upset: buckets.map(([label], i) => [label, upsetHits[i][0], upsetHits[i][0] ? upsetHits[i][1] / upsetHits[i][0] : NaN]),
  };
}

// 비교표의 한 줄: [이름, 시뮬, 실제, 허용 오차(손실 함수 스케일)]
export type Row = [string, number, number, number];

export function compare(m: Metrics, t: Targets): Row[] {
  return [
    ["경기 시간 평균 (분)", m.lengthMean, t.gamelength_min.mean, 0.6],
    ["경기 시간 표준편차", m.lengthStd, t.gamelength_min.std, 0.6],
    ["경기당 킬 평균", m.killsMean, t.kills.mean, 1.2],
    ["경기당 킬 표준편차", m.killsStd, t.kills.std, 1.2],
    ["경기당 용", m.dragonsMean, t.dragons.mean, 0.25],
    ["경기당 바론", m.baronsMean, t.barons.mean, 0.12],
    ["경기당 포탑", m.towersMean, t.towers.mean, 0.6],
    ["블루 진영 승률", m.blueWinrate, t.blue_winrate, 0.015],
    ["15분 팀 골드차 표준편차", m.gd15Std, t.team_gd15_std, 120],
    ["15분 골드 1k당 승리 로짓", m.gd15Coef, t.gd15_logit_coef_per_1k, 0.04],
    ["15분 3k+ 뒤진 팀 역전률", m.comeback3k, t.comeback_rate_behind_3k_at15, 0.02],
    ["퍼스트 블러드 팀 승률", m.firstBlood, t.objective_winrate.firstblood, 0.025],
    ["첫 용 팀 승률", m.firstDragon, t.objective_winrate.firstdragon, 0.025],
    ["첫 포탑 팀 승률", m.firstTower, t.objective_winrate.firsttower, 0.025],
    ["첫 바론 팀 승률", m.firstBaron, t.objective_winrate.firstbaron, 0.025],
    ["정규시즌 팀 승률 표준편차", m.teamWinrateStd, t.regular_season_team_winrate_std, 0.02],
    ["BO3 1세트 승리 팀 시리즈 승률", m.bo3Game1Conversion, t.bo3?.p_series_win_if_won_game1 ?? NaN, 0.03],
    ...POSITIONS.map((pos): Row => [`라인 영향력: ${POS_KO[pos]}`, m.laneWeight[pos], t.lane_relative_weight[pos], 0.04]),
  ];
}

export function loss(rows: Row[]): number {
  return rows.reduce((s, [, sim, real, scale]) => (Number.isFinite(real) ? s + ((sim - real) / scale) ** 2 : s), 0);
}

// ── 통계 도우미 ─────────────────────────────────────────────
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// 절편 포함 로지스틱 회귀 (IRLS). 반환: [절편, 계수...]
export function logisticFit(X: number[][], y: number[], iters = 30): number[] {
  const k = X[0].length + 1;
  let w = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const H = Array.from({ length: k }, () => new Array(k).fill(0));
    const g = new Array(k).fill(0);
    for (let i = 0; i < X.length; i++) {
      const xi = [1, ...X[i]];
      const p = 1 / (1 + Math.exp(-xi.reduce((s, v, j) => s + v * w[j], 0)));
      const wi = p * (1 - p);
      for (let a = 0; a < k; a++) {
        g[a] += (y[i] - p) * xi[a];
        for (let b = 0; b < k; b++) H[a][b] += wi * xi[a] * xi[b];
      }
    }
    for (let a = 0; a < k; a++) H[a][a] += 1e-9;
    const step = solve(H, g);
    w = w.map((v, j) => v + step[j]);
    if (step.every((s) => Math.abs(s) < 1e-8)) break;
  }
  return w;
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
