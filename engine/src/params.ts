import type { Position } from "./types.ts";

// 엔진의 모든 조절값. data/params.json 이 있으면 그 값으로 덮어쓴다 (npm run tune 결과).
// 능력치는 z = (rating - 70) / 17 로 표준화해서 쓴다.
export interface Params {
  // --- 라인전 (0~15분): 라인 골드차 = laneSd × (우위 + 노이즈) ---
  laneSd: Record<Position, number>; // 실제 LCK 라인별 15분 골드차 표준편차
  laneSkill: number; // 라인전 능력치 차이 가중치
  laneChamp: number; // 챔피언 초반 성향 가중치
  laneMeta: number; // 챔피언 메타 점수 가중치
  laneMastery: number; // 챔피언 숙련도 가중치
  laneMatchup: number; // 상성 데이터(맞대결 15분 골드차) 가중치
  laneNoise: number; // 라인전 랜덤성
  laneValue: Record<Position, number>; // 라인 골드 1이 교전에서 갖는 가치 (원딜 우위가 탑 우위보다 크다)
  jungleGank: number; // 정글 우위가 탑·미드·바텀으로 번지는 비율
  supportSynergy: number; // 서폿 우위가 바텀으로 번지는 비율
  form: number; // 경기마다 선수 컨디션 흔들림 (z 단위 표준편차)
  objControl: number; // 라인 우위 → 초반 오브젝트(용·유충·전령) 확보
  killsAt15: number; // 15분까지 양 팀 합계 킬 평균

  // --- 중후반 (15분~): 몇 분마다 교전 → 승자가 골드·오브젝트·포탑 획득 ---
  roleWeight: Record<Position, number>; // 한타 전투력에서 포지션 비중
  fightSkill: number; // 팀 전투력 차이 → 교전 승률 (로짓)
  fightGold: number; // 골드 1,000 차이 → 교전 승률 (로짓)
  sideBonus: number; // 블루 진영 보너스 (로짓)
  champMeta: number;
  champMastery: number;
  champLate: number; // 시간에 따른 챔피언 성향 (초반형 vs 후반형)
  compFront: number; // 앞라인 없는 조합 페널티
  compDamage: number; // 물리/마법 딜 쏠림 페널티
  compDuo: number; // 바텀 조합 승률 데이터 가중치
  drakeBuff: number; // 용 1개당 전투력
  soulBuff: number;
  baronBuff: number;
  elderBuff: number;
  windowMin: number; // 교전 간격 (분)
  windowMax: number;
  swingMean: number; // 교전 승리 시 골드 이득
  swingSd: number;
  baronGold: number;
  killsPerFight: number; // 교전 승리 팀 평균 킬
  loserKillRatio: number; // 진 팀 킬 비율
  baronContest: number; // 바론이 있을 때 바론 싸움이 날 확률
  endBase: number; // 마무리(넥서스 파괴) 확률 로짓
  endGold: number;
  endBaron: number;
  endTime: number;

  // --- 드래프트 AI ---
  draftMeta: number;
  draftMastery: number;
  draftNoise: number;
}

export const DEFAULT_PARAMS: Params = {
  laneSd: { top: 855, jng: 735, mid: 860, bot: 1070, sup: 445 },
  laneSkill: 0.35,
  laneChamp: 0.2,
  laneMeta: 0.3,
  laneMastery: 0.4,
  laneMatchup: 0.3,
  laneNoise: 0.85,
  laneValue: { top: 1, jng: 1, mid: 1, bot: 1, sup: 1 },
  jungleGank: 0.25,
  supportSynergy: 0.4,
  form: 0.3,
  objControl: 0.9,
  killsAt15: 7.6,

  roleWeight: { top: 1.0, jng: 1.0, mid: 1.1, bot: 1.2, sup: 0.8 },
  fightSkill: 0.9,
  fightGold: 0.35,
  sideBonus: 0.15,
  champMeta: 0.5,
  champMastery: 0.6,
  champLate: 0.3,
  compFront: 0.15,
  compDamage: 0.4,
  compDuo: 1.0,
  drakeBuff: 0.05,
  soulBuff: 0.35,
  baronBuff: 0.8,
  elderBuff: 1.0,
  windowMin: 2.0,
  windowMax: 4.0,
  swingMean: 900,
  swingSd: 500,
  baronGold: 1500,
  killsPerFight: 2.4,
  loserKillRatio: 0.45,
  baronContest: 0.5,
  endBase: -1.0,
  endGold: 0.4,
  endBaron: 1.2,
  endTime: 0.15,

  draftMeta: 1.0,
  draftMastery: 1.3,
  draftNoise: 0.15,
};

// 튜너가 건드리는 값과 범위 ("laneValue.bot" 처럼 점으로 중첩 키 지정)
export const TUNABLE: Array<{ key: string; min: number; max: number }> = [
  { key: "laneSkill", min: 0.05, max: 1.2 },
  { key: "laneNoise", min: 0.3, max: 1.5 },
  { key: "jungleGank", min: 0, max: 0.8 },
  { key: "laneValue.top", min: 0, max: 4 },
  { key: "laneValue.jng", min: 0, max: 4 },
  { key: "laneValue.mid", min: 0, max: 4 },
  { key: "laneValue.bot", min: 0, max: 4 },
  { key: "laneValue.sup", min: 0, max: 4 },
  { key: "form", min: 0, max: 0.8 },
  { key: "objControl", min: 0.2, max: 2.5 },
  { key: "fightSkill", min: 0.2, max: 3 },
  { key: "fightGold", min: 0.05, max: 1.2 },
  { key: "sideBonus", min: 0, max: 0.6 },
  { key: "swingMean", min: 300, max: 2000 },
  { key: "swingSd", min: 100, max: 1500 },
  { key: "windowMin", min: 1, max: 4 },
  { key: "windowMax", min: 2.5, max: 6 },
  { key: "killsPerFight", min: 1, max: 5 },
  { key: "loserKillRatio", min: 0.1, max: 0.9 },
  { key: "baronContest", min: 0.1, max: 0.95 },
  { key: "baronBuff", min: 0, max: 2 },
  { key: "baronGold", min: 300, max: 3000 },
  { key: "endBase", min: -4, max: 2 },
  { key: "endGold", min: 0, max: 1.5 },
  { key: "endBaron", min: 0, max: 3 },
  { key: "endTime", min: 0, max: 0.6 },
];

export function getParam(p: Params, key: string): number {
  return key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], p) as number;
}

// 원본을 바꾸지 않고 key 하나만 바꾼 사본
export function setParam(p: Params, key: string, value: number): Params {
  const [head, sub] = key.split(".");
  const next = { ...p } as unknown as Record<string, unknown>;
  next[head] = sub ? { ...(next[head] as Record<string, number>), [sub]: value } : value;
  return next as unknown as Params;
}
