// 구단주 목표: 시즌 시작 때 팀 명성(리그 안 순위)으로 2~3개를 보여주고, 시즌이 끝나면 평가 등급을 매긴다. 경질은 없다.
import type { YearState } from "../competition/year.ts";
import { payroll } from "./value.ts";
import type { WorldState } from "./types.ts";
import { mainRoster } from "./world.ts";

export type Goal =
  | { kind: "lckPlace"; max: number; text: string }
  | { kind: "worldsPlace"; max: number; text: string }
  | { kind: "worlds"; text: string }
  | { kind: "budget"; text: string };

export function goalsFor(world: WorldState, teamId: string): Goal[] {
  const t = world.teams[teamId];
  const rank = Object.values(world.teams)
    .filter((x) => x.league === t.league)
    .sort((a, b) => b.prestige - a.prestige)
    .findIndex((x) => x.id === teamId);
  if (rank < 3)
    return [
      { kind: "lckPlace", max: 2, text: "LCK 플레이오프 결승 진출" },
      { kind: "worldsPlace", max: 5, text: "월즈 8강 이상" },
      { kind: "budget", text: "연봉 상한 지키기" },
    ];
  if (rank < 6)
    return [
      { kind: "lckPlace", max: 6, text: "LCK 플레이오프 진출 (6위 안)" },
      { kind: "worlds", text: "월즈 진출" },
      { kind: "budget", text: "연봉 상한 지키기" },
    ];
  return [
    { kind: "lckPlace", max: 8, text: "LCK 플레이인 진출 (8위 안)" },
    { kind: "budget", text: "연봉 상한 지키기" },
  ];
}

export function evaluateGoals(world: WorldState, y: YearState, teamId: string, goals: Goal[]): { grade: string; goals: Array<{ text: string; met: boolean }> } {
  const place = (ev: string) => y.finals[ev]?.find(([, t]) => t === teamId)?.[0] ?? 99;
  const results = goals.map((g) => {
    let met = false;
    if (g.kind === "lckPlace") met = place("LCK") <= g.max;
    if (g.kind === "worldsPlace") met = place("WORLDS") <= g.max;
    if (g.kind === "worlds") met = y.qualified.worlds.some((e) => e.team === teamId);
    if (g.kind === "budget") met = payroll(world.players, mainRoster(world.teams[teamId])) <= world.teams[teamId].cap + 0.05;
    return { text: g.text, met };
  });
  const rate = results.filter((r) => r.met).length / results.length;
  const champ = place("WORLDS") === 1;
  const grade = champ ? "S" : rate === 1 ? "A" : rate >= 0.6 ? "B" : rate >= 0.3 ? "C" : "D";
  return { grade, goals: results };
}
