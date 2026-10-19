// 성장·노쇠. 시즌 안 여러 시점에 연간 성장분을 나눠 주고, 시즌 전환 때 나이를 먹으며 노쇠한다.
//   1~2라운드 중간 15% · 끝 20% · (MSI 참가 팀) MSI 끝 +10% · 3~4라운드 중간 15% · 끝 20% · (월즈 참가 팀) 월즈 끝 +15% · 시즌 전환 30%
// 연간 성장분 = (잠재력 − 현재) × 나이 계수, 능력별 최대 +6. 주전으로 많이 뛸수록, 집중 육성이면 더 큰다.
import { createRng, hashSeed } from "../rng.ts";
import type { YearState } from "../competition/year.ts";
import { RULES } from "../competition/year.ts";
import { knot, type CareerParams } from "./params.ts";
import type { Ability, GrowthReport, PlayerState, SeasonStats, WorldState } from "./types.ts";
import { ABILITIES } from "./types.ts";
import { mainRoster } from "./world.ts";

export type Checkpoint = "SPRING_MID" | "SPRING_END" | "MSI_END" | "SUMMER_MID" | "SUMMER_END" | "WORLDS_END" | "SEASON_END";

export const CHECKPOINTS: Record<Checkpoint, { label: string; share: number; who: "all" | "MSI" | "WORLDS" }> = {
  SPRING_MID: { label: "1~2라운드 중간 성장", share: 0.15, who: "all" },
  SPRING_END: { label: "1~2라운드 끝 성장", share: 0.2, who: "all" },
  MSI_END: { label: "MSI 경험 성장", share: 0.1, who: "MSI" },
  SUMMER_MID: { label: "3~4라운드 중간 성장", share: 0.15, who: "all" },
  SUMMER_END: { label: "3~4라운드 끝 성장", share: 0.2, who: "all" },
  WORLDS_END: { label: "월즈 경험 성장", share: 0.15, who: "WORLDS" },
  SEASON_END: { label: "시즌 결산 (성장·노쇠)", share: 0.3, who: "all" },
};

const ORDER = ["SPRING", "RTM", "MSI_PI", "MSI_BR", "SUMMER", "LCK_PI", "LCK_PO", "WLD_PI", "WLD_SW", "WLD_KO", "DONE"];
const idx = (y: YearState) => ORDER.indexOf(y.phase);
const into = (y: YearState, phase: string) => y.day - (y.phaseStart[phase as keyof YearState["phaseStart"]] ?? y.day);

function reached(y: YearState, cp: Checkpoint): boolean {
  switch (cp) {
    case "SPRING_MID":
      return idx(y) > ORDER.indexOf("SPRING") || into(y, "SPRING") >= RULES.springDays / 2;
    case "SPRING_END":
      return idx(y) > ORDER.indexOf("SPRING");
    case "MSI_END":
      return idx(y) > ORDER.indexOf("MSI_BR");
    case "SUMMER_MID":
      return idx(y) > ORDER.indexOf("SUMMER") || (y.phase === "SUMMER" && into(y, "SUMMER") >= RULES.summerDays / 2);
    case "SUMMER_END":
      return idx(y) > ORDER.indexOf("SUMMER");
    case "WORLDS_END":
      return y.phase === "DONE";
    case "SEASON_END":
      return false; // 시즌 전환 때 따로 부른다
  }
}

// 하루를 넘기며 지나간 성장 시점 (보통 0~1개)
export function crossedCheckpoints(prev: YearState, next: YearState): Checkpoint[] {
  return (Object.keys(CHECKPOINTS) as Checkpoint[]).filter((cp) => !reached(prev, cp) && reached(next, cp));
}

// 나이 계수·리그 배율(리그 수준이 높을수록 더 큰다)·상한은 CareerParams.growth
export const ageCoef = (cp: CareerParams, age: number) => knot(cp.growth.ageCoef, age);

// 이번 시즌 팀 경기 중 몇 %를 뛰었나 → 성장 배율 playMin~1.0. 2군은 2군 리그에서 뛰는 셈으로 academyPlay
function playFactor(cp: CareerParams, p: PlayerState, stats: SeasonStats): number {
  if (p.academy) return cp.growth.academyPlay;
  const team = p.contract?.team;
  const total = team ? (stats.teamGames[team] ?? 0) : 0;
  if (!total) return cp.growth.academyPlay;
  return cp.growth.playMin + (1 - cp.growth.playMin) * Math.min(1, (stats.games[p.id] ?? 0) / total);
}

function participants(world: WorldState, y: YearState | null, who: "all" | "MSI" | "WORLDS"): Set<string> {
  if (who === "all" || !y) return new Set(Object.values(world.teams).flatMap((t) => [...mainRoster(t), ...t.academy]));
  const teams = (who === "MSI" ? y.qualified.msi : y.qualified.worlds).map((e) => e.team);
  return new Set(teams.flatMap((t) => (world.teams[t] ? mainRoster(world.teams[t]) : [])));
}

const round1 = (x: number) => Math.round(x * 10) / 10;

// 한 성장 시점 적용. 선수 능력치만 바꾸고, 내 팀 리포트용 변화를 돌려준다
export function developAt(world: WorldState, cp: Checkpoint, stats: SeasonStats, y: YearState | null): WorldState {
  const { share, who, label } = CHECKPOINTS[cp];
  const g = world.cp.growth;
  const rng = createRng(hashSeed(world.seed, world.season, "grow", cp));
  const who_ = participants(world, y, who);
  const focus = new Set(Object.values(world.teams).flatMap((t) => t.focus));
  const players = { ...world.players };
  const changes: GrowthReport["changes"] = {};
  for (const id of who_) {
    const p = players[id];
    if (!p || p.retired) continue;
    const league = world.teams[p.contract?.team ?? ""]?.league ?? "LCK";
    const mult = share * playFactor(world.cp, p, stats) * (focus.has(id) ? g.focus : 1) * (g.league[league] ?? 0.85);
    const ratings = { ...p.ratings };
    const diff: Partial<Record<Ability, number>> = {};
    for (const a of ABILITIES) {
      const yearly = Math.min(g.maxYearGain, Math.max(0, (p.potential[a] - p.ratings[a]) * ageCoef(world.cp, p.age ?? 22)));
      const d = round1(yearly * mult + g.noise * share * rng.normal());
      if (d === 0) continue;
      ratings[a] = round1(ratings[a] + d);
      diff[a] = d;
    }
    players[id] = { ...p, ratings };
    changes[id] = diff;
  }
  return { ...world, players, lastGrowth: { checkpoint: cp, label, season: world.season, changes } };
}

// 시즌 전환: 남은 30% 성장 + 나이 +1 + 노쇠. 라인전·한타가 먼저 떨어지고 시야는 늦게 떨어진다 (CareerParams.decline)
export const declineAt = (cp: CareerParams, age: number) => knot(cp.decline.byAge, age);

export function seasonEndDevelop(world: WorldState, stats: SeasonStats): WorldState {
  let w = developAt(world, "SEASON_END", stats, null);
  const rng = createRng(hashSeed(world.seed, world.season, "aging"));
  const dc = world.cp.decline;
  const players = { ...w.players };
  const changes = { ...w.lastGrowth!.changes };
  for (const p of Object.values(players)) {
    if (p.retired) continue;
    const age = (p.age ?? 22) + 1;
    const ratings = { ...p.ratings };
    const diff = { ...(changes[p.id] ?? {}) };
    for (const a of ABILITIES) {
      if (!dc.weights[a]) continue;
      const d = round1(Math.max(-dc.max, -declineAt(world.cp, age) * dc.weights[a] + (age >= dc.oldAge ? dc.noiseOld : 1) * rng.normal() * dc.noise));
      ratings[a] = round1(ratings[a] + d);
      diff[a] = round1((diff[a] ?? 0) + d);
    }
    players[p.id] = { ...p, age, ratings };
    changes[p.id] = diff;
  }
  w = { ...w, players, lastGrowth: { ...w.lastGrowth!, changes } };
  return w;
}
