// 다년 커리어 조절값 자동 튜닝 (npm run tune -- --career). Node 전용: worker_threads로 여러 번을 나란히 돌린다.
//   A단계: 성장·노쇠·잠재력 나이 표 → 나이별 실력 변화를 실제(부드럽게 만든 곡선)에 맞춘다
//   B단계: 운영 능력·신인·대체 선수·은퇴 → 리그 평균이 2026 수준을 유지하게
// 손실 = 리그 평균 하락 + LCK 팀 승률 퍼짐 + 나이별 변화 + 리그 간 격차 + 나이 표 모양 (career/metrics.ts)
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { careerLoss, smoothAgeCurve, type AgeTarget, type LossParts, type RunMetrics } from "./career/metrics.ts";
import { getCareerParam, setCareerParam, type CareerParams } from "./career/params.ts";
import { saveCareerParams } from "./data.ts";
import { createRng, hashSeed } from "./rng.ts";

export class CareerPool {
  private workers: Worker[];
  private idle: Worker[];
  private queue: Array<{ id: number; job: object }> = [];
  private waiting = new Map<number, (m: RunMetrics) => void>();
  private next = 0;
  constructor(n = availableParallelism()) {
    this.workers = Array.from({ length: n }, () => new Worker(new URL("./careerWorker.ts", import.meta.url)));
    this.idle = [...this.workers];
    for (const w of this.workers)
      w.on("message", ({ id, m }: { id: number; m: RunMetrics }) => {
        this.waiting.get(id)!(m);
        this.waiting.delete(id);
        this.idle.push(w);
        this.pump();
      });
  }
  get size() {
    return this.workers.length;
  }
  run(cp: CareerParams, seed: number, years: number): Promise<RunMetrics> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.queue.push({ id, job: { id, cp, seed, years } });
      this.pump();
    });
  }
  private pump() {
    while (this.idle.length && this.queue.length) this.idle.pop()!.postMessage(this.queue.shift()!.job);
  }
  close() {
    for (const w of this.workers) void w.terminate();
  }
}

export const careerSeeds = (base: number, runs: number) => Array.from({ length: runs }, (_, r) => hashSeed(base, "career", r));

export function loadAgeTarget(): AgeTarget[] {
  const rows = readFileSync(new URL("../../output/players/aging_curve_delta.csv", import.meta.url), "utf8")
    .replace(/^﻿/, "")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","))
    .map((c) => ({ age: Number(c[0]), n: Number(c[1]), delta: Number(c[7]) }));
  return smoothAgeCurve(rows);
}

// 튜닝할 값: 경로 → [하한, 상한]. 나이 표는 점 [나이, 값]의 값만 바꾼다
export const STAGES: Record<string, Record<string, [number, number]>> = {
  A: {
    "growth.ageCoef.0.1": [0.05, 1],
    "growth.ageCoef.1.1": [0.05, 1],
    "growth.ageCoef.2.1": [0.02, 0.8],
    "growth.ageCoef.3.1": [0.01, 0.6],
    "growth.ageCoef.4.1": [0, 0.4],
    "decline.byAge.0.1": [0, 3],
    "decline.byAge.1.1": [0, 4],
    "decline.byAge.2.1": [0, 5],
    "decline.byAge.3.1": [0, 6],
    "decline.byAge.4.1": [0, 6],
    "potential.headroom.0.1": [5, 30],
    "potential.headroom.1.1": [3, 25],
    "potential.headroom.2.1": [1, 18],
    "potential.headroom.3.1": [0, 12],
    "potential.headroom.4.1": [0, 6],
    "growth.maxYearGain": [3, 12],
    "potential.prodigyP": [0, 0.3],
  },
  B: {
    "macro.newMean.LCK": [-0.12, 0.12],
    "macro.learn": [0, 0.15],
    "rookies.meanShift": [-8, 8],
    "replacement.gap": [3, 12],
    "replacement.gain": [0, 8],
    "retire.perYear": [0.02, 0.12],
  },
};

// 튜닝용 나이 표 시작점: 지금 계단 모양을 같은 간격 점 5개로
export function withTuningKnots(cp: CareerParams): CareerParams {
  if (cp.growth.ageCoef.length === 5 && cp.growth.ageCoef[0][0] === 17) return cp;
  const c = structuredClone(cp);
  c.growth.ageCoef = [[17, 0.55], [19, 0.55], [21, 0.4], [23, 0.25], [25, 0.1]];
  c.decline.byAge = [[21, 0], [23, 0], [25, 1], [27, 2], [29, 2.5]];
  c.potential.headroom = [[16, 17], [18, 13], [20, 7], [22, 3], [24, 0.5]];
  return c;
}

export async function evaluateCareer(pool: CareerPool, cp: CareerParams, seeds: number[], years: number, target: AgeTarget[]): Promise<{ loss: LossParts; runs: RunMetrics[] }> {
  const runs = await Promise.all(seeds.map((s) => pool.run(cp, s, years)));
  return { loss: careerLoss(runs, target, cp), runs };
}

export interface CareerTuneOptions {
  stage: string;
  iters: number;
  years: number;
  runs: number;
  seed: number;
  log: (msg: string) => void;
}

// (1+λ) 랜덤 지역 탐색: 값 1~3개를 흔들어 보고 손실이 줄면 받아들인다. 후보끼리 같은 시드로 비교한다
export async function tuneCareer(start: CareerParams, opts: CareerTuneOptions): Promise<CareerParams> {
  const keys = Object.keys(STAGES[opts.stage]);
  const ranges = STAGES[opts.stage];
  const pool = new CareerPool();
  const target = loadAgeTarget();
  const seeds = careerSeeds(hashSeed(opts.seed, "career-tune", opts.stage), opts.runs);
  const rng = createRng(hashSeed(opts.seed, "career-tune-steps", opts.stage));
  const lambda = Math.max(1, Math.floor(pool.size / opts.runs));
  let best = opts.stage === "A" ? withTuningKnots(start) : start;
  let bestLoss = (await evaluateCareer(pool, best, seeds, opts.years, target)).loss;
  const fmt = (l: LossParts) => `손실 ${l.total.toFixed(3)} (하락 ${l.drift.toFixed(2)} 퍼짐 ${l.spread.toFixed(2)} 나이 ${l.age.toFixed(2)} 격차 ${l.gaps.toFixed(2)} 모양 ${l.shape.toFixed(2)})`;
  opts.log(`시작 ${fmt(bestLoss)}  · 후보 ${lambda}개씩, ${opts.runs}회 × ${opts.years}년`);
  for (let i = 0; i < opts.iters; i += lambda) {
    const scale = 0.05 + 0.2 * (1 - i / opts.iters);
    const cands = Array.from({ length: lambda }, () => {
      let c = best;
      const n = 1 + rng.int(3);
      const changed: string[] = [];
      for (let k = 0; k < n; k++) {
        const key = keys[rng.int(keys.length)];
        const [lo, hi] = ranges[key];
        const v = Math.max(lo, Math.min(hi, getCareerParam(c, key) + scale * (hi - lo) * rng.normal()));
        c = setCareerParam(c, key, Math.round(v * 1000) / 1000);
        changed.push(`${key}=${Math.round(v * 1000) / 1000}`);
      }
      return { c, changed };
    });
    const results = await Promise.all(cands.map((x) => evaluateCareer(pool, x.c, seeds, opts.years, target)));
    const k = results.reduce((b, r, j) => (r.loss.total < results[b].loss.total ? j : b), 0);
    if (results[k].loss.total < bestLoss.total) {
      best = cands[k].c;
      bestLoss = results[k].loss;
      saveCareerParams(best);
      opts.log(`${i + lambda}/${opts.iters} 개선 ${fmt(bestLoss)}  ${cands[k].changed.join(" ")}`);
    } else if ((i / lambda) % 5 === 0) opts.log(`${i + lambda}/${opts.iters} 그대로 ${bestLoss.total.toFixed(3)} (후보 ${results[k].loss.total.toFixed(3)})`);
  }
  pool.close();
  return best;
}
