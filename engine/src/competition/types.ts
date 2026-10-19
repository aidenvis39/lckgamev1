// 대회 공통 타입. 전부 JSON으로 저장할 수 있는 평범한 객체만 쓴다 (웹 저장, 재개).

export type BestOf = 1 | 3 | 5;

// 한 시리즈 일정. home이 1세트 블루(= 선픽)이고 이후 세트는 진 팀이 진영을 고른다.
export interface Match {
  id: string; // 해 전체에서 고유
  event: string; // LCK, LPL, LEC, LCS, LCP, CBLOL, RTM(Road to MSI), MSI, LCKPO(LCK 플레이인·플레이오프), WORLDS
  stage: string; // R12, R34L, H1, PI, BR, SW, KO ...
  label: string; // 화면 표시용 이름
  day: number; // 달력 날짜 (0부터)
  home: string;
  away: string;
  bestOf: BestOf;
  round?: number; // 스위스 라운드 등
}

export interface Outcome {
  winner: string;
  score: [number, number]; // [home, away] 세트 수
}

export type Results = Record<string, Outcome>;

// 국제대회 참가 자격: 어느 리그 몇 번 시드인지
export interface Entrant {
  team: string;
  league: string;
  seed: number; // 지역 시드 (1이 가장 높음)
  stage?: "SW" | "PI"; // 월즈: 스위스 직행 / 플레이인
  bonusSeat?: boolean; // 월즈: MSI 성적으로 생긴 스위스 4풀 자리
  via?: string; // "MSI 우승", "MSI 지역 추가"
}

export const loserOf = (m: Match, o: Outcome): string => (o.winner === m.home ? m.away : m.home);
