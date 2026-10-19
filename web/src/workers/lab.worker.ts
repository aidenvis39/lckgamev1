// 이적 실험실: 맞트레이드 전후 LCK 정규시즌을 여러 번 돌린다 (메인 화면이 멈추지 않게 워커에서).
// 해외 선수와 바꾸면 그 선수는 LCK 팀으로 오고, 해외 팀은 시뮬에 안 들어간다.
import { createRng, hashSeed } from "../../../engine/src/rng.ts";
import { playSeason } from "../../../engine/src/season.ts";
import { swapPlayers } from "../../../engine/src/lineup.ts";
import { buildDraftPool } from "../../../engine/src/tune.ts";
import { lckUniverse, params } from "../engine.ts";
import type { Universe } from "../engine.ts";

export interface LabRequest {
  a: string;
  b: string;
  runs: number;
  seed: number;
}

export interface TeamOutcome {
  winrate: number;
  rank: number;
  legend: number; // 1~2라운드 5위 안(레전드 그룹) 비율
}

export type LabMessage =
  | { type: "progress"; done: number; total: number }
  | { type: "result"; before: Record<string, TeamOutcome>; after: Record<string, TeamOutcome> };

function run(u: Universe, req: LabRequest, phase: number, report: (done: number) => void): Record<string, TeamOutcome> {
  const draft = buildDraftPool(u, params, req.seed);
  const acc = new Map<string, { w: number; g: number; rank: number; legend: number }>();
  for (let i = 0; i < req.runs; i++) {
    const s = playSeason(u, params, createRng(hashSeed(req.seed, "lab", i)), { draft });
    s.standings.forEach((t, rank) => {
      const a = acc.get(t.team) ?? { w: 0, g: 0, rank: 0, legend: 0 };
      a.w += t.gameWins;
      a.g += t.gameWins + t.gameLosses;
      a.rank += rank + 1;
      a.legend += s.groups?.legend.includes(t.team) ? 1 : 0;
      acc.set(t.team, a);
    });
    if (i % 5 === 4) report(phase * req.runs + i + 1);
  }
  return Object.fromEntries([...acc].map(([t, a]) => [t, { winrate: a.w / a.g, rank: a.rank / req.runs, legend: a.legend / req.runs }]));
}

self.onmessage = (e: MessageEvent<LabRequest>) => {
  const req = e.data;
  const post = (m: LabMessage) => (self as unknown as Worker).postMessage(m);
  const progress = (done: number) => post({ type: "progress", done, total: req.runs * 2 });
  const before = run(lckUniverse, req, 0, progress);
  const after = run(swapPlayers(lckUniverse, req.a, req.b), req, 1, progress);
  post({ type: "result", before, after });
};
