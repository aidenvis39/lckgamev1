// 조절값 자동 튜닝: 시즌을 여러 번 돌려서 실제 LCK 통계와의 차이(손실)를 줄이는 방향으로 랜덤 탐색.
import { compare, loss, measure, type Metrics, type Row } from "./calibrate.ts";
import type { Targets } from "./targets.ts";
import { runDraft } from "./draft.ts";
import { TUNABLE, getParam, setParam, type Params } from "./params.ts";
import { createRng, hashSeed } from "./rng.ts";
import { playSeason } from "./season.ts";
import type { DraftProvider } from "./series.ts";
import type { DraftResult, Universe } from "./types.ts";
import { POSITIONS, SIDES } from "./types.ts";

// 실제 피어리스 이력과 현재 로스터가 같을 때만 재사용한다. 진영은 세트 결과에 따라 바뀐다.
// depth는 캐시할 세트 수일 뿐, 이후 세트에 마지막 드래프트를 재사용하는 상한이 아니다.
// 챔피언·상성 데이터가 바뀌면 새 풀을 만든다 (예: 커리어 시즌 전환).
export function buildDraftPool(u: Universe, p: Params, seed: number, depth = 3): DraftProvider {
  const pool = new Map<string, DraftResult>();
  return (g, lineups, unavailable) => {
    const blocked = [...unavailable].sort();
    const roster = SIDES.map((side) => [lineups[side].team.id, POSITIONS.map((pos) => {
      const player = lineups[side].players[pos];
      return [player.id, player.ratings.champPool, Object.entries(player.champions).sort(([a], [b]) => a.localeCompare(b))];
    })]);
    const key = JSON.stringify([g, roster, blocked, p.draftMeta, p.draftMastery, p.draftNoise]);
    const cached = pool.get(key);
    if (cached) return cached;
    // 호출 순서·캐시 적중 여부·금지 목록 삽입 순서에 무관한 시드.
    const d = runDraft(u, lineups, p, createRng(hashSeed(seed, key)), { unavailable: new Set(blocked) });
    if (g < depth) pool.set(key, d);
    return d;
  };
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
