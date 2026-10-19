import { lineupOf, POSITIONS, type Universe, type WorldState } from "../engine.ts";

export interface TeamProfile {
  laning: number;
  teamfight: number;
  vision: number;
  survival: number;
  champPool: number;
  macro: number; // 주전 5명 운영 기여 합 (경기 승리 로짓)
  macroKnown: boolean; // 해외 선수는 운영 기여 추정치가 없다
}

// world가 있으면 운영 기여는 공개 추정치로 (커리어 Universe엔 숨은 진짜 값이 들어 있어서)
export function teamProfile(u: Universe, teamId: string, world?: WorldState): TeamProfile {
  const lu = lineupOf(u, teamId);
  const avg = (k: keyof TeamProfile & keyof (typeof lu.players)["top"]["ratings"]) =>
    POSITIONS.reduce((s, pos) => s + lu.players[pos].ratings[k], 0) / POSITIONS.length;
  return {
    laning: avg("laning"),
    teamfight: avg("teamfight"),
    vision: avg("vision"),
    survival: avg("survival"),
    champPool: avg("champPool"),
    macro: POSITIONS.reduce((s, pos) => s + (world?.players[lu.players[pos].id] ?? lu.players[pos]).intangible, 0),
    macroKnown: POSITIONS.every((pos) => (world?.players[lu.players[pos].id] ?? lu.players[pos]).intangibleKnown),
  };
}
