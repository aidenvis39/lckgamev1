// 조절값 자동 튜닝: 시즌을 여러 번 돌려서 실제 LCK 통계와의 차이(손실)를 줄이는 방향으로 랜덤 탐색.
import { compare, loss, measure, type Metrics, type Row } from "./calibrate.ts";
import type { Targets } from "./targets.ts";
import { runDraft } from "./draft.ts";
import { lineupOf } from "./lineup.ts";
import { simulateGame } from "./match.ts";
import { TUNABLE, getParam, setParam, type Params } from "./params.ts";
import { createRng, hashSeed } from "./rng.ts";
import { playSeason } from "./season.ts";
import type { DraftProvider } from "./series.ts";
import type { DraftResult, Lineup, Universe } from "./types.ts";
import { POSITIONS } from "./types.ts";

// 드래프트는 경기 조절값과 무관하므로 (블루, 레드, 실제 금지 목록)별로 한 번만 만들어 재사용한다.
// 피어리스 금지 목록까지 키에 넣어야 진영이 바뀐 시리즈에서도 앞 세트 챔피언을 다시 고르지 않는다.
// 금지 목록은 앞 세트들의 진영 순서로 정해지므로 경우의 수는 적다 (BO3 쌍당 7, BO5 31).
export function buildDraftPool(u: Universe, p: Params, seed: number): DraftProvider {
  const pool = new Map<string, DraftResult>();
  return (_g, lineups, unavailable) => {
    const key = `${lineups.blue.team.id}|${lineups.red.team.id}|${[...unavailable].sort().join(",")}`;
    let d = pool.get(key);
    if (!d) {
      d = runDraft(u, lineups, p, createRng(hashSeed(seed, key)), { unavailable });
      pool.set(key, d);
    }
    return d;
  };
}

// 운영 기여 1점(실효 실력 기준: 팀 운영 합 × macroWeight × 17)이 능력치 1점에 비해 승리에 얼마나 작용하나.
// 능력치는 교전 전투력 말고도 라인전·시야·오브젝트에 들어가서, 같은 점수라도 운영보다 크게 작용한다.
// 같은 팀끼리 붙이고 블루만 (a) 경기 능력 4개 +D, (b) 운영 +D점을 줘서 블루 승률 로짓 증가의 비를 잰다 (같은 드래프트·같은 난수).
export function measureMacroEquiv(u: Universe, p: Params, seed: number, teams = ["GEN", "HLE", "T1", "DK", "KT"], games = 3000): { ratio: number; byTeam: Record<string, number> } {
  const logit = (x: number) => Math.log(x / (1 - x));
  const bump = (base: Lineup, mode: "rating" | "macro", d: number): Lineup => ({
    ...base,
    players: Object.fromEntries(
      POSITIONS.map((pos) => {
        const x = base.players[pos];
        if (mode === "macro") return [pos, { ...x, intangible: x.intangible + d / (5 * 17 * p.macroWeight) }];
        const r = x.ratings;
        return [pos, { ...x, ratings: { ...r, laning: r.laning + d, teamfight: r.teamfight + d, vision: r.vision + d, survival: r.survival + d } }];
      }),
    ) as Lineup["players"],
  });
  let sumMacro = 0;
  let sumRating = 0;
  const byTeam: Record<string, number> = {};
  for (const team of teams.filter((t) => u.teams.has(t))) {
    const base = lineupOf(u, team);
    const drafts = Array.from({ length: 200 }, (_, i) => runDraft(u, { blue: base, red: base }, p, createRng(hashSeed(seed, "equiv-draft", team, i))));
    const wr = (blue: Lineup) => {
      let w = 0;
      for (let i = 0; i < games; i++) w += simulateGame(u, { blue, red: base }, drafts[i % drafts.length], p, createRng(hashSeed(seed, "equiv", team, i))).winner === "blue" ? 1 : 0;
      return w / games;
    };
    const b0 = logit(wr(base));
    let m = 0;
    let r = 0;
    for (const d of [3, 6]) {
      m += logit(wr(bump(base, "macro", d))) - b0;
      r += logit(wr(bump(base, "rating", d))) - b0;
    }
    byTeam[team] = Math.round((m / r) * 1000) / 1000;
    sumMacro += m;
    sumRating += r;
  }
  return { ratio: Math.round((sumMacro / sumRating) * 1000) / 1000, byTeam };
}

export interface Evaluation {
  rows: Row[];
  loss: number;
  metrics: Metrics;
}

export function simulate(u: Universe, p: Params, seasons: number, seed: number, draft?: DraftProvider): Metrics {
  return measure(Array.from({ length: seasons }, (_, i) => playSeason(u, p, createRng(hashSeed(seed, "season", i)), { draft })));
}

export function evaluate(u: Universe, p: Params, targets: Targets, seasons: number, seed: number, draft?: DraftProvider): Evaluation {
  const metrics = simulate(u, p, seasons, seed, draft);
  const rows = compare(metrics, targets);
  return { rows, loss: loss(rows), metrics };
}

// 전투력 1 차이가 경기 승리 로짓을 얼마나 바꾸는지 재서, 선수 운영 기여(로짓 단위)를 전투력으로 바꾸는 배율을 정한다.
// 블루 보너스(교전 로짓)를 ±ε 바꿨을 때 블루 승률 로짓 변화 = κ, 전투력 1 = 교전 로짓 fightSkill 이므로 배율 = 1 / (κ × fightSkill)
export function fitMacroWeight(u: Universe, p: Params, seasons: number, seed: number, draft: DraftProvider): Params {
  const eps = 0.15;
  const logit = (x: number) => Math.log(x / (1 - x));
  const wr = (sb: number) => simulate(u, { ...p, sideBonus: sb }, seasons, seed, draft).blueWinrate;
  const kappa = (logit(wr(p.sideBonus + eps)) - logit(wr(p.sideBonus - eps))) / (2 * eps);
  return { ...p, macroWeight: 1 / (kappa * p.fightSkill) };
}

export interface TuneOptions {
  iterations: number;
  seasons: number;
  seed: number;
  onProgress?: (iteration: number, bestLoss: number) => void;
}

// 팀워크(팀 단위 능력치)를 팀별 실제 정규시즌 승률에 맞춘다: 시뮬 승률이 낮은 팀은 올리고 높은 팀은 내린다.
export function fitTeamwork(u: Universe, targets: Targets, start: Params, seasons: number, seed: number, draft: DraftProvider, rounds = 12): Params {
  let p = start;
  const logit = (x: number) => Math.log(Math.min(0.98, Math.max(0.02, x)) / (1 - Math.min(0.98, Math.max(0.02, x))));
  for (let r = 0; r < rounds; r++) {
    const sim = evaluate(u, p, targets, seasons, seed, draft).metrics.teamWinrate;
    const tw: Record<string, number> = { ...p.teamwork };
    for (const team of u.teams.keys()) {
      const real = targets.team_regular_winrate[team];
      if (real === undefined) continue;
      tw[team] = (tw[team] ?? 0) + (0.25 * (logit(real) - logit(sim[team]))) / Math.max(0.2, p.fightSkill);
    }
    // 이 리그 팀끼리만 평균 0으로 맞춘다 (다른 리그 팀워크는 건드리지 않음)
    const ids = [...u.teams.keys()];
    const avg = ids.reduce((a, t) => a + (tw[t] ?? 0), 0) / ids.length;
    for (const team of ids) tw[team] = (tw[team] ?? 0) - avg;
    p = { ...p, teamwork: tw };
  }
  return p;
}

// 팀워크 맞춤 → 조절값 탐색을 두 번 반복하고, 마지막에 팀워크를 한 번 더 맞춘다.
export function tune(u: Universe, targets: Targets, start: Params, opts: TuneOptions): { params: Params; loss: number } {
  const draft = buildDraftPool(u, start, opts.seed);
  const rng = createRng(hashSeed(opts.seed, "tune"));
  let best = start;
  let bestLoss = Infinity;
  const half = Math.ceil(opts.iterations / 2);
  for (let i = 0; i < opts.iterations; i++) {
    if (i % half === 0) {
      best = fitMacroWeight(u, best, 2 * opts.seasons, opts.seed, draft);
      best = fitTeamwork(u, targets, best, opts.seasons, opts.seed, draft);
      bestLoss = evaluate(u, best, targets, opts.seasons, opts.seed, draft).loss;
    }
    const step = 0.15 * (0.3 + (1 - (i % half) / half)); // 갈수록 작게 움직인다
    let cand = best;
    for (let j = 1 + rng.int(3); j > 0; j--) {
      const { key, min, max } = TUNABLE[rng.int(TUNABLE.length)];
      cand = setParam(cand, key, Math.min(max, Math.max(min, getParam(cand, key) + (max - min) * step * rng.normal())));
    }
    cand = setParam(cand, "windowMax", Math.max(cand.windowMax, cand.windowMin + 0.5));
    const l = evaluate(u, cand, targets, opts.seasons, opts.seed, draft).loss;
    if (l < bestLoss) {
      best = cand;
      bestLoss = l;
    }
    opts.onProgress?.(i, bestLoss);
  }
  best = fitMacroWeight(u, best, 2 * opts.seasons, opts.seed, draft);
  best = fitTeamwork(u, targets, best, opts.seasons, opts.seed, draft);
  return { params: best, loss: evaluate(u, best, targets, opts.seasons, opts.seed, draft).loss };
}
