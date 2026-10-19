import type { Lineup, Player, Position, Universe } from "./types.ts";
import { POSITIONS } from "./types.ts";

// 두 선수의 소속을 맞바꾼 새 Universe (원본은 그대로). 같은 포지션이면 주전 자리도 맞바꾼다.
export function swapPlayers(u: Universe, aId: string, bId: string): Universe {
  const a = u.players.get(aId.toLowerCase());
  const b = u.players.get(bId.toLowerCase());
  if (!a || !b) throw new Error(`알 수 없는 선수: ${!a ? aId : bId}`);
  if (a.position !== b.position) throw new Error(`포지션이 다름: ${a.name}(${a.position}) ↔ ${b.name}(${b.position})`);
  const players = new Map(u.players);
  players.set(a.id, { ...a, team: b.team });
  players.set(b.id, { ...b, team: a.team });
  const teams = new Map(u.teams);
  for (const [id, t] of u.teams) {
    const starters = { ...t.starters };
    for (const pos of POSITIONS) {
      if (starters[pos] === a.id) starters[pos] = b.id;
      else if (starters[pos] === b.id) starters[pos] = a.id;
    }
    teams.set(id, { ...t, starters });
  }
  return { ...u, players, teams };
}

export function lineupOf(u: Universe, teamId: string): Lineup {
  const team = u.teams.get(teamId.toUpperCase());
  if (!team) throw new Error(`알 수 없는 팀: ${teamId} (가능: ${[...u.teams.keys()].join(", ")})`);
  const players = Object.fromEntries(POSITIONS.map((pos) => [pos, u.players.get(team.starters[pos])!])) as Record<
    Position,
    Player
  >;
  return { team, players };
}
