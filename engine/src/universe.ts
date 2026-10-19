// JSON 데이터 → Universe. fs에 의존하지 않아 브라우저·Workers에서도 그대로 쓴다.
import type { Champion, Player, Position, Ratings, TeamInfo, Universe } from "./types.ts";

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

// 한 리그 팀만 남긴 Universe (선수·챔피언은 그대로 공유). 리그 시즌·튜닝은 이걸로 돌린다.
export function leagueUniverse(u: Universe, league: string): Universe {
  return { ...u, teams: new Map([...u.teams].filter(([, t]) => t.league === league)) };
}

// 리그 안 백분위 능력치에 리그 보정을 더해 모든 선수를 LCK 기준 하나로 맞춘다.
// 챔프폭은 리그 간 비교가 아니라 챔피언 수라 그대로 둔다.
export function applyLeagueOffsets(u: Universe, offsets: Record<string, number>): Universe {
  if (!Object.values(offsets).some((v) => v !== 0)) return u;
  const shift = (r: Ratings, d: number): Ratings => ({
    laning: r.laning + d,
    teamfight: r.teamfight + d,
    vision: r.vision + d,
    survival: r.survival + d,
    champPool: r.champPool,
  });
  const players = new Map(
    [...u.players].map(([id, p]) => {
      const d = offsets[p.ratingLeague] ?? 0;
      return [id, d ? { ...p, ratings: shift(p.ratings, d) } : p];
    }),
  );
  return { ...u, players };
}
