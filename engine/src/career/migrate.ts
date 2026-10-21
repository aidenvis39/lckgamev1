// 예전 저장(세계 상태)을 지금 형식으로. 웹 저장 v3 → v4: 이미 2026 이후라 첫 스토브리그는 없고,
// 새로 생긴 값(통산 경기, 2020~2025 실제 우승)만 시작 데이터에서 채운다. 조절값은 최신으로 바꾼다
import type { CareerParams } from "./params.ts";
import type { Start2025, WorldState } from "./types.ts";
import { retuneReplacement } from "./world.ts";

export function upgradeWorld(world: WorldState, start: Start2025, cp: CareerParams): WorldState {
  const extra = new Map(start.extra.map((x) => [x.id, x]));
  const players = Object.fromEntries(
    Object.values(world.players).map((p) => {
      const e = start.entries[p.id] ?? extra.get(p.id);
      const real = (e?.titles ?? []).filter((t) => !p.careerTitles.includes(t));
      const macro = { macroTrue: p.macroTrue ?? p.intangible, intangibleSe: p.intangibleKnown || p.intangibleSe ? p.intangibleSe : cp.macro.newSd };
      return [p.id, { ...p, ...macro, careerGames: p.careerGames ?? e?.careerGames ?? 0, careerTitles: [...real, ...p.careerTitles] }];
    }),
  );
  return { ...world, players, cp, opening: world.opening ?? null };
}

// 리그 평균 기준선(2026 실제 로스터)은 운영 환산 비율로 계산한 값이다. 비율이 바뀌었으면 시작 데이터로 새로 만든 세계(fresh)의 기준선으로 바꾸고
// 새로 들어오는 선수 수준도 바로 다시 맞춘다
export function refreshBaseline(world: WorldState, cp: CareerParams, fresh: () => WorldState): WorldState {
  if ((world.baselineEquiv ?? 1) === cp.macro.ratingEquiv) return world;
  return retuneReplacement({ ...world, cp, baseline: fresh().baseline, baselineEquiv: cp.macro.ratingEquiv });
}
