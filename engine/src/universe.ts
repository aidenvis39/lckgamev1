// JSON 데이터 → Universe. fs에 의존하지 않아 브라우저·Workers에서도 그대로 쓴다.
import type { Champion, Player, Position, TeamInfo, Universe } from "./types.ts";

export interface RawData {
  players: Player[];
  champions: Champion[];
  teams: TeamInfo[];
  matchups: {
    lanes: Array<[Position, string, string, number, number]>; // [포지션, 챔피언, 상대, 경기 수, 15분 골드차]
    duos: Array<[string, string, number, number]>; // [원딜, 서폿, 경기 수, 승률]
  };
}

export function createUniverse(raw: RawData): Universe {
  return {
    players: new Map(raw.players.map((p) => [p.id, p])),
    champions: new Map(raw.champions.map((c) => [c.id, c])),
    teams: new Map(raw.teams.map((t) => [t.id, t])),
    matchups: {
      lane: new Map(raw.matchups.lanes.map(([pos, a, b, n, gd15]) => [`${pos}|${a}|${b}`, { n, gd15 }])),
      duo: new Map(raw.matchups.duos.map(([bot, sup, n, winrate]) => [`${bot}|${sup}`, { n, winrate }])),
    },
  };
}
