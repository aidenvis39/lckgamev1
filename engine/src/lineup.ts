import type { Lineup, Player, Position, Universe } from "./types.ts";
import { POSITIONS } from "./types.ts";

export function lineupOf(u: Universe, teamId: string): Lineup {
  const team = u.teams.get(teamId.toUpperCase());
  if (!team) throw new Error(`알 수 없는 팀: ${teamId} (가능: ${[...u.teams.keys()].join(", ")})`);
  const players = Object.fromEntries(POSITIONS.map((pos) => [pos, u.players.get(team.starters[pos])!])) as Record<
    Position,
    Player
  >;
  return { team, players };
}
