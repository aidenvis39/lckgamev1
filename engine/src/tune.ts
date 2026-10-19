// 조절값 자동 튜닝: 시즌을 여러 번 돌려서 실제 LCK 통계와의 차이(손실)를 줄이는 방향으로 랜덤 탐색.
import { compare, loss, measure, type Metrics, type Row } from "./calibrate.ts";
import type { Targets } from "./data.ts";
import { runDraft } from "./draft.ts";
import { lineupOf } from "./lineup.ts";
import { TUNABLE, getParam, setParam, type Params } from "./params.ts";
import { createRng, hashSeed } from "./rng.ts";
import { playSeason } from "./season.ts";
import type { DraftProvider } from "./series.ts";
import type { DraftResult, Side, Universe } from "./types.ts";
import { POSITIONS } from "./types.ts";

// 드래프트는 경기 조절값과 무관하므로 (블루, 레드, 세트 번호)별로 미리 만들어 재사용한다.
export function buildDraftPool(u: Universe, p: Params, seed: number, depth = 3): DraftProvider {
  const pool = new Map<string, DraftResult[]>();
  const teams = [...u.teams.keys()];
  for (const blue of teams) {
    for (const red of teams) {
      if (blue === red) continue;
      const lineups = { blue: lineupOf(u, blue), red: lineupOf(u, red) };
      const rng = createRng(hashSeed(seed, blue, red));
      const used = new Set<string>();
      const seq: DraftResult[] = [];
      for (let g = 0; g < depth; g++) {
        const d = runDraft(u, lineups, p, rng.fork(g), { unavailable: used });
        for (const side of ["blue", "red"] as Side[]) for (const pos of POSITIONS) used.add(d.picks[side][pos]);
        seq.push(d);
      }
      pool.set(`${blue}|${red}`, seq);
    }
  }
  return (g, lineups) => pool.get(`${lineups.blue.team.id}|${lineups.red.team.id}`)![Math.min(g, depth - 1)];
}

export interface Evaluation {
  rows: Row[];
  loss: number;
  metrics: Metrics;
}

export function evaluate(u: Universe, p: Params, targets: Targets, seasons: number, seed: number, draft?: DraftProvider): Evaluation {
  const results = Array.from({ length: seasons }, (_, i) =>
    playSeason(u, p, createRng(hashSeed(seed, "season", i)), { draft }),
  );
  const metrics = measure(results);
  const rows = compare(metrics, targets);
  return { rows, loss: loss(rows), metrics };
}

export interface TuneOptions {
  iterations: number;
  seasons: number;
  seed: number;
  onProgress?: (iteration: number, bestLoss: number) => void;
}

export function tune(u: Universe, targets: Targets, start: Params, opts: TuneOptions): { params: Params; loss: number } {
  const draft = buildDraftPool(u, start, opts.seed);
  const rng = createRng(hashSeed(opts.seed, "tune"));
  let best = start;
  let bestLoss = evaluate(u, best, targets, opts.seasons, opts.seed, draft).loss;
  for (let i = 0; i < opts.iterations; i++) {
    const step = 0.15 * (0.3 + (1 - i / opts.iterations)); // 갈수록 작게 움직인다
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
  return { params: best, loss: bestLoss };
}
