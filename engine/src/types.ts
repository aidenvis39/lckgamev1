export type Side = "blue" | "red";
export type Position = "top" | "jng" | "mid" | "bot" | "sup";

export const POSITIONS: readonly Position[] = ["top", "jng", "mid", "bot", "sup"];
export const SIDES: readonly Side[] = ["blue", "red"];
export const other = (s: Side): Side => (s === "blue" ? "red" : "blue");

// 같은 리그·시즌·포지션 안의 백분위를 40~99로 바꾼 값 (데이터 파이프라인 rating_*)
export interface Ratings {
  laning: number;
  teamfight: number;
  vision: number;
  survival: number;
  champPool: number;
}

export interface Player {
  id: string;
  name: string;
  team: string;
  position: Position;
  age: number | null;
  games2026: number;
  starter: boolean;
  ratings: Ratings;
  // 운영·콜처럼 개인 기록에 안 잡히는 기여 (경기 승리 로짓 단위, 2020~2026 LCK 회귀 추정). 이적하면 따라간다
  intangible: number;
  intangibleSe: number;
  champions: Record<string, number>; // 챔피언 id → 출전 경기 수 (2025는 0.5배)
}

export interface Champion {
  id: string;
  name: string;
  nameKo: string;
  tags: string[];
  positions: Partial<Record<Position, number>>; // 프로 경기 포지션 비중
  meta: number; // 0~1, 현재 메타에서의 강도
  early: number; // -1~1, 15분 라인 골드차 성향
  late: number; // -1~1, 긴 경기 승률 - 짧은 경기 승률
  presence: number;
  winrate: number;
  damage: { physical: number; magic: number };
  toughness: number;
  proPicks: number;
}

export interface TeamInfo {
  id: string;
  name: string;
  starters: Record<Position, string>;
  bench: string[];
}

export interface Lineup {
  team: TeamInfo;
  players: Record<Position, Player>;
}

export interface Matchups {
  lane: Map<string, { n: number; gd15: number }>; // `${pos}|${champ}|${opp}`
  duo: Map<string, { n: number; winrate: number }>; // `${bot}|${sup}`
}

export interface Universe {
  players: Map<string, Player>;
  champions: Map<string, Champion>;
  teams: Map<string, TeamInfo>;
  matchups: Matchups;
}

export interface DraftStep {
  kind: "ban" | "pick";
  side: Side;
  champion: string;
  position?: Position;
}

export interface DraftResult {
  bans: Record<Side, string[]>;
  picks: Record<Side, Record<Position, string>>;
  steps: DraftStep[];
}

export interface GameEvent {
  t: number; // 분
  side?: Side;
  text: string;
}

export interface PlayerLine {
  kills: number;
  deaths: number;
  assists: number;
}

export interface GameResult {
  winner: Side;
  duration: number; // 분
  gd15: number; // 블루 - 레드
  laneGd15: Record<Position, number>; // 블루 - 레드
  kills: Record<Side, number>;
  dragons: Record<Side, number>;
  barons: Record<Side, number>;
  towers: Record<Side, number>; // 파괴한 포탑 수
  elders: Record<Side, number>;
  soul: Side | null;
  firsts: { blood: Side; dragon: Side; tower: Side; baron: Side | null };
  goldTimeline: Array<[number, number]>; // [분, 블루 - 레드 골드]
  lines: Record<Side, Record<Position, PlayerLine>>;
  events: GameEvent[];
}
