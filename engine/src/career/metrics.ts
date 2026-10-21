// 다년 커리어 측정 (CLI `career`와 `tune --career`가 같은 함수를 쓴다): AI끼리 여러 시즌을 돌리며
// 리그 수준 유지, LCK 팀 승률 퍼짐, 나이별 실력 변화(실제 곡선과 같은 조건), 리그 간 격차, 은퇴·FA·신인 수를 잰다.
import type { Params } from "../params.ts";
import type { Universe } from "../types.ts";
import { POSITIONS } from "../types.ts";
import type { CareerParams } from "./params.ts";
import { knot } from "./params.ts";
import { aiOffseason, aiOpening, playCareerSeason } from "./play.ts";
import type { TeamState, WorldState } from "./types.ts";
import { overall, payroll, teamMacroPoints } from "./value.ts";
import { initWorld, mainRoster, starterMeans, validateWorld, type WorldInput } from "./world.ts";

export const LEAGUES6 = ["LCK", "LPL", "LEC", "LCS", "LCP", "CBLOL"];

export interface RunMetrics {
  seasons: number[];
  baseline: Record<string, number>; // 2026 실제 로스터 리그 평균 (유지 목표)
  leagueMeans: Array<Record<string, number>>; // 시즌 시작 때 리그 주전 평균 실효 실력
  topGaps: Array<Record<string, number>>; // 리그 상위 4팀 평균 − LCK 상위 4팀 평균
  lckSpread: number[]; // LCK 팀 세트 승률 표준편차
  agePairs: Array<[number, number]>; // [나이, 다음 시즌 실력 변화] LCK 1군(두 해 15세트 이상)·LCK CL 2군 생존 선수
  retired: number[];
  fa: number[];
  rookies: number[];
  overCap: number[];
  worlds: string[]; // 월즈 우승 팀(리그)
  rosterErrors: number;
}

export type CareerData = Omit<WorldInput, "seed" | "cp"> & { base: Universe; params: Params };

// 팀 전력 (능력 점수): 능력 평균 + 운영(승리 효과 환산) + 팀워크. 월즈 같은 국제전 결과를 정하는 몫을 다 넣는다
const teamStrength = (w: WorldState, t: TeamState) => {
  const ids = POSITIONS.map((pos) => t.starters[pos]).filter((id) => w.players[id]);
  const ovr = ids.reduce((s, id) => s + overall(w.players[id].ratings), 0) / Math.max(1, ids.length);
  return ovr + teamMacroPoints(w) * ids.reduce((s, id) => s + (w.players[id].macroTrue ?? w.players[id].intangible ?? 0), 0) + 17 * t.teamwork;
};

function topGaps(w: WorldState): Record<string, number> {
  const top4 = (lg: string) => {
    const s = Object.values(w.teams).filter((t) => t.league === lg).map((t) => teamStrength(w, t)).sort((a, b) => b - a).slice(0, 4);
    return s.reduce((a, b) => a + b, 0) / s.length;
  };
  const lck = top4("LCK");
  return Object.fromEntries(LEAGUES6.filter((lg) => lg !== "LCK").map((lg) => [lg, Math.round((top4(lg) - lck) * 100) / 100]));
}

// 실제 곡선과 같은 조건의 선수: LCK 1군 또는 LCK CL 2군
function lckSnapshot(w: WorldState): Map<string, { group: string; age: number; ovr: number }> {
  const out = new Map<string, { group: string; age: number; ovr: number }>();
  for (const t of Object.values(w.teams).filter((x) => x.league === "LCK")) {
    for (const id of mainRoster(t)) out.set(id, { group: "LCK", age: w.players[id].age ?? 22, ovr: overall(w.players[id].ratings) });
    for (const id of t.academy) out.set(id, { group: "CL", age: w.players[id].age ?? 22, ovr: overall(w.players[id].ratings) });
  }
  return out;
}

export function careerRun(data: CareerData, cp: CareerParams, seed: number, years: number): RunMetrics {
  const { base, params, ...input } = data;
  let w = aiOpening(initWorld({ ...input, params, cp, seed }), base);
  const m: RunMetrics = { seasons: [], baseline: w.baseline, leagueMeans: [], topGaps: [], lckSpread: [], agePairs: [], retired: [], fa: [], rookies: [], overCap: [], worlds: [], rosterErrors: 0 };
  let prev: { snap: Map<string, { group: string; age: number; ovr: number }>; games: Record<string, number> } | null = null;
  for (let yr = 0; yr < years; yr++) {
    m.seasons.push(w.season);
    m.leagueMeans.push(starterMeans(w.players, w.teams, w));
    m.topGaps.push(topGaps(w));
    m.fa.push(w.freeAgents.length);
    m.rookies.push(Object.values(w.players).filter((p) => p.virtual && !p.retired).length);
    m.overCap.push(Object.values(w.teams).filter((t) => payroll(w.players, mainRoster(t)) > t.cap + 0.05).length);
    const snap = lckSnapshot(w);
    const res = playCareerSeason(w, base, params);
    // 나이별 변화: 지난 시즌 시작 → 이번 시즌 시작, 두 시즌 다 같은 무대(1군 15세트 이상 / 2군)
    if (prev) {
      for (const [id, a] of prev.snap) {
        const b = snap.get(id);
        if (!b || b.group !== a.group) continue;
        if (a.group === "LCK" && ((prev.games[id] ?? 0) < 15 || (res.stats.games[id] ?? 0) < 15)) continue;
        m.agePairs.push([a.age, Math.round((b.ovr - a.ovr) * 100) / 100]);
      }
    }
    prev = { snap, games: res.stats.games };
    const lck = new Map<string, [number, number]>();
    for (const x of res.year.matches.filter((mm) => mm.event === "LCK")) {
      const o = res.year.results[x.id];
      for (const [t, g, l] of [[x.home, o.score[0], o.score[1]], [x.away, o.score[1], o.score[0]]] as const) {
        const a = lck.get(t) ?? [0, 0];
        lck.set(t, [a[0] + g, a[1] + g + l]);
      }
    }
    const wrs = [...lck.values()].map(([g, n]) => g / n);
    const mean = wrs.reduce((a, b) => a + b, 0) / wrs.length;
    m.lckSpread.push(Math.sqrt(wrs.reduce((a, b) => a + (b - mean) ** 2, 0) / wrs.length));
    const champ = res.year.finals.WORLDS.find(([p]) => p === 1)![1];
    m.worlds.push(`${champ}(${w.teams[champ].league})`);
    const retiredBefore = Object.values(res.world.players).filter((p) => p.retired).length;
    w = aiOffseason(res.world, res.year, res.stats, base);
    m.retired.push(Object.values(w.players).filter((p) => p.retired).length - retiredBefore);
    m.rosterErrors += validateWorld(w).length;
  }
  return m;
}

// ── 손실 (튜너) ───────────────────────────────────────
export interface AgeTarget {
  age: number;
  n: number; // 실제 쌍 수 (가중치)
  delta: number; // 부드럽게 만든 실제 변화
}

// 실제 나이별 변화(aging_curve_delta.csv)를 표본 수로 가중한 국소 선형 회귀로 부드럽게 (대역폭 1.5세)
export function smoothAgeCurve(rows: Array<{ age: number; n: number; delta: number }>, h = 1.5): AgeTarget[] {
  return rows.map(({ age, n }) => {
    const w = rows.map((r) => r.n * Math.exp(-0.5 * ((r.age - age) / h) ** 2));
    const W = w.reduce((a, b) => a + b, 0);
    const xm = rows.reduce((s, r, i) => s + w[i] * r.age, 0) / W;
    const ym = rows.reduce((s, r, i) => s + w[i] * r.delta, 0) / W;
    const sxx = rows.reduce((s, r, i) => s + w[i] * (r.age - xm) ** 2, 0);
    const sxy = rows.reduce((s, r, i) => s + w[i] * (r.age - xm) * (r.delta - ym), 0);
    return { age, n, delta: Math.round((ym + (sxy / sxx) * (age - xm)) * 100) / 100 };
  });
}

export interface LossParts {
  total: number;
  drift: number; // 리그 평균이 2026 기준에서 벗어난 정도 (제곱 평균, 점²)
  spread: number;
  age: number; // 나이별 변화 오차 (표본 가중 제곱 평균, 점²)
  gaps: number;
  shape: number; // 나이 표가 이상하게 꺾이는 벌점
  ageRmse: number;
  lckMaxDrift: number;
}

export function careerLoss(runs: RunMetrics[], target: AgeTarget[], cp: CareerParams): LossParts {
  let drift = 0, nd = 0, maxDrift = 0;
  for (const r of runs)
    for (let t = 1; t < r.leagueMeans.length; t++) {
      const lck = r.leagueMeans[t].LCK - r.baseline.LCK;
      const over = LEAGUES6.slice(1).reduce((s, lg) => s + (r.leagueMeans[t][lg] - r.baseline[lg]) ** 2, 0) / 5;
      drift += lck ** 2 + 0.5 * over;
      nd++;
      maxDrift = Math.max(maxDrift, Math.abs(lck));
    }
  drift /= Math.max(1, nd);
  const spreads = runs.flatMap((r) => r.lckSpread);
  const spread = ((spreads.reduce((a, b) => a + b, 0) / spreads.length - 0.152) / 0.015) ** 2;
  const byAge = new Map<number, number[]>();
  for (const r of runs) for (const [a, d] of r.agePairs) byAge.set(a, [...(byAge.get(a) ?? []), d]);
  let age = 0, na = 0;
  for (const t of target.filter((x) => x.age >= 17 && x.age <= 26)) {
    const list = byAge.get(t.age) ?? [];
    if (list.length < 10) continue;
    const sim = list.reduce((a, b) => a + b, 0) / list.length;
    age += t.n * (sim - t.delta) ** 2;
    na += t.n;
  }
  age /= Math.max(1, na);
  let gaps = 0, ng = 0;
  for (const r of runs)
    for (let t = 1; t < r.topGaps.length; t++)
      for (const lg of Object.keys(r.topGaps[0])) {
        gaps += ((r.topGaps[t][lg] - r.topGaps[0][lg]) / 1.5) ** 2;
        ng++;
      }
  gaps /= Math.max(1, ng);
  // 나이 계수는 나이가 들수록 줄고, 노쇠는 늘어나야 한다 (어기면 벌점)
  let shape = 0;
  const ages = Array.from({ length: 16 }, (_, i) => 16 + i);
  for (let i = 1; i < ages.length; i++) {
    shape += Math.max(0, knot(cp.growth.ageCoef, ages[i]) - knot(cp.growth.ageCoef, ages[i - 1])) * 10;
    shape += Math.max(0, knot(cp.decline.byAge, ages[i - 1]) - knot(cp.decline.byAge, ages[i]));
    shape += Math.max(0, knot(cp.potential.headroom, ages[i]) - knot(cp.potential.headroom, ages[i - 1])) * 0.2;
  }
  const total = drift + 0.5 * spread + age + 0.5 * gaps + 0.1 * shape;
  return { total, drift, spread, age, gaps, shape, ageRmse: Math.sqrt(age), lckMaxDrift: maxDrift };
}

// 시뮬 나이별 평균 변화 (표·CLI 출력용)
export function ageTable(runs: RunMetrics[]): Map<number, { mean: number; n: number }> {
  const byAge = new Map<number, number[]>();
  for (const r of runs) for (const [a, d] of r.agePairs) byAge.set(a, [...(byAge.get(a) ?? []), d]);
  return new Map([...byAge].sort((a, b) => a[0] - b[0]).map(([a, l]) => [a, { mean: l.reduce((s, x) => s + x, 0) / l.length, n: l.length }]));
}
