// 다년 커리어의 세계 상태. 전부 JSON으로 저장할 수 있는 평범한 객체 (웹 localStorage, 재개).
// 능력치는 커리어 시작 때 리그 보정을 한 번 더한 '세계 공통' 값이라, 리그를 옮겨도 실력이 그대로 따라간다.
import type { Player, Position, Ratings } from "../types.ts";
import type { CareerParams } from "./params.ts";

export type Ability = "laning" | "teamfight" | "vision" | "survival" | "champPool";
export const ABILITIES: readonly Ability[] = ["laning", "teamfight", "vision", "survival", "champPool"];

export interface Contract {
  team: string;
  endSeason: number; // 이 시즌이 끝나면 풀림
  salary: number; // 가상 크레딧 C / 시즌 (실제 연봉 아님)
  role: "starter" | "bench";
  generated: boolean; // 실제 계약 정보 없이 게임이 만든 계약
}

// intangible·intangibleSe·intangibleKnown = 공개된 운영 기여 추정치 (화면·시장·AI 판단), macroTrue = 경기에 쓰이는 진짜 값
export interface PlayerState extends Player {
  macroTrue: number; // 숨김. 실제 선수는 데이터 추정치, 새 선수는 뽑은 값 (경험으로 조금씩 오름)
  potential: Ratings; // 숨김. 능력별 도달 가능한 상한 (커리어 시작이나 신인 생성 때 고정)
  contract: Contract | null; // null = 자유계약(FA)
  academy: boolean; // LCK 팀 2군 소속
  virtual: boolean; // 게임이 만든 신인
  faSeasons: number; // 무소속으로 보낸 스토브리그 수 (2번이면 은퇴)
  retired: boolean;
  careerTitles: string[]; // "2027 LCK", "2028 월즈" ... (2020~2025는 실제 우승)
  careerGames: number; // 통산 출전 세트 (2020~2025 실제 + 커리어 중 출전)
}

export interface TeamState {
  id: string;
  name: string;
  league: string;
  starters: Record<Position, string>;
  bench: string[]; // 1군 후보
  academy: string[]; // 2군 (LCK 팀만)
  cap: number; // 1군 연봉 합 상한 (C)
  transferBudget: number; // 이적료 예산 (C)
  teamwork: number; // 팀 고유 효과 (엔진 params.teamwork와 같은 단위)
  prestige: number; // 0~1, 최근 성적. 선수가 팀을 고를 때 씀
  seasonStarters: string[]; // 시즌 시작 때 주전 (팀워크 유지 비율 계산용)
  focus: string[]; // 집중 육성 선수 (최대 2명)
}

export interface SeasonRecord {
  season: number;
  champions: Record<string, string>; // LCK, MSI, WORLDS → 팀
  places: Record<string, Record<string, number>>; // 팀 → 대회 → 최종 순위
  owner?: { team: string; grade: string; goals: Array<{ text: string; met: boolean }> };
  moves: string[]; // 주요 이적 한 줄 요약
}

// 성장 시점별 변화 (화면 리포트용): 선수 → 능력별 변화
export interface GrowthReport {
  checkpoint: string;
  label: string;
  season: number;
  changes: Record<string, Partial<Record<Ability, number>>>;
}

export interface WorldState {
  version: 1;
  seed: number;
  season: number;
  players: Record<string, PlayerState>;
  teams: Record<string, TeamState>;
  freeAgents: string[];
  champMeta: Record<string, number>; // 챔피언 메타 점수 (시즌마다 조금 바뀜)
  baseMeta: Record<string, number>; // 2026 데이터 메타 (평균 회귀 기준)
  history: SeasonRecord[];
  lastGrowth: GrowthReport | null;
  nextRookie: number; // 신인 id 번호
  replacement: Record<string, number>; // 리그별 '대체 선수 수준'. 빈자리·해외 유망주·신인 능력 기준 (해마다 보정)
  baseline: Record<string, number>; // 2026 리그별 주전 평균 '실효' 실력 (세계 수준 유지 목표)
  baselineEquiv?: number; // baseline을 계산할 때 쓴 운영 환산 비율 (cp.macro.ratingEquiv). 없으면 예전 저장(1)
  macroWeight: number; // 운영 기여를 실력 점수로 바꿀 때 씀 (엔진 params.macroWeight)
  cp: CareerParams; // 성장·노쇠·신인·은퇴 조절값 (저장을 불러올 때 최신 값으로 바꿀 수 있음)
  opening: Opening | null; // 첫 스토브리그(2025 → 2026) 동안만: 실제 2026 이적 재현용
}

// ── 커리어 시작: 2025 시즌이 끝난 스토브리그 (engine/data/start2025.json) ──
export interface StartEntry {
  team: string | null; // 2025 시즌 끝 소속 (null = FA)
  academy: boolean;
  starter: boolean;
  contractEnd: number | null; // 2025 = 이번 스토브리그에 끝남, null = 모름(게임이 정함)
  dest: string | null; // 실제 2026 팀
  destAcademy: boolean;
  destStarter: boolean;
  destYears: number | null;
  retire: boolean; // 2025 시즌 뒤 실제 은퇴
  titles: string[];
  careerGames: number;
}
export interface Start2025 {
  season: number;
  entries: Record<string, StartEntry>; // players.json + academy.json 선수
  extra: Array<Player & StartEntry & { academy: boolean; ageEstimated?: boolean }>; // 2025에만 뛴 선수 (나이가 없으면 첫 프로 시즌으로 추정)
  teams: Record<string, { starters: Record<Position, string>; bench: string[]; academy: string[]; winrate2025: number | null }>;
  history: SeasonRecord;
}

// 실제 2026 계약 (사전 합의): 이 팀 제안엔 선수가 효용 보너스를 준다. 사용자가 더 좋은 조건으로 뺏을 수 있다
export interface PreAgreement {
  team: string;
  academy: boolean;
  starter: boolean;
  years: number;
}
export interface Opening {
  pre: Record<string, PreAgreement>; // 선수 → 실제 2026 팀
  retire: string[]; // 2025 시즌 뒤 실제 은퇴
  realStarters: Record<string, Record<Position, string>>; // 팀 → 실제 2026 주전
  tunedTeamwork: Record<string, number>; // 실제 2026 로스터에 맞춘 팀워크
}

// 시즌 중 쌓는 기록 (성장·챔피언 풀용). 시즌이 바뀌면 비운다
export interface SeasonStats {
  games: Record<string, number>; // 선수 → 출전 세트
  picks: Record<string, Record<string, number>>; // 선수 → 챔피언 → 세트
  teamGames: Record<string, number>; // 팀 → 세트
}

export const emptyStats = (): SeasonStats => ({ games: {}, picks: {}, teamGames: {} });
