import { lineupOf, POSITIONS, type Universe } from "../engine.ts";

export interface TeamProfile {
  laning: number;
  teamfight: number;
  vision: number;
  survival: number;
  champPool: number;
  macro: number; // 주전 5명 운영 기여 합 (경기 승리 로짓)
}

export function teamProfile(u: Universe, teamId: string): TeamProfile {
  const lu = lineupOf(u, teamId);
  const avg = (k: keyof TeamProfile & keyof (typeof lu.players)["top"]["ratings"]) =>
    POSITIONS.reduce((s, pos) => s + lu.players[pos].ratings[k], 0) / POSITIONS.length;
  return {
    laning: avg("laning"),
    teamfight: avg("teamfight"),
    vision: avg("vision"),
    survival: avg("survival"),
    champPool: avg("champPool"),
    macro: POSITIONS.reduce((s, pos) => s + lu.players[pos].intangible, 0),
  };
}
