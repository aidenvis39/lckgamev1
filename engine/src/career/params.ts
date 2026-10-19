// 다년 커리어 조절값: 성장·노쇠·잠재력·신인·대체 선수·은퇴. data/careerParams.json 이 있으면 그 값으로 덮어쓴다 (npm run tune -- --career 결과).
// 나이 표는 [나이, 값] 점 목록이고 사이는 직선으로 잇는다. 범위 밖은 끝 값.
import type { Ability } from "./types.ts";

export type Knots = Array<[number, number]>;

export interface CareerParams {
  growth: {
    ageCoef: Knots; // 연간 성장분 = (잠재력 − 현재) × 이 계수
    maxYearGain: number; // 능력별 연간 성장 상한
    noise: number; // 성장 시점마다 흔들림 (× 그 시점 비중)
    focus: number; // 집중 육성 배율
    playMin: number; // 한 번도 안 뛴 선수의 출전 배율 (다 뛰면 1)
    academyPlay: number; // 2군 출전 배율
    league: Record<string, number>; // 리그별 성장 배율
  };
  decline: {
    byAge: Knots; // 시즌 결산 노쇠 (능력 점수)
    weights: Record<Ability, number>; // 능력별 노쇠 배율
    noise: number; // 노쇠 흔들림
    noiseOld: number; // oldAge 이상 흔들림 배율
    oldAge: number;
    max: number; // 한 해 최대 하락
  };
  potential: {
    headroom: Knots; // 나이별 잠재력 여유 평균
    sd: number;
    prodigyP: number; // '재능형' 확률 (19세 이하·신인)
    prodigyMin: number;
    prodigyRange: number;
    prodigyMaxAge: number;
  };
  rookies: {
    mean: Record<string, number>; // 리그별 신인 평균 능력 (세계 공통 기준)
    meanShift: number; // 신인 평균 전체 이동 (튜너용)
    sd: number;
    replacementSd: number;
    cap: number; // 신인 평균 상한
    extra: number; // 신인 잠재력 여유 추가
  };
  replacement: {
    gap: number; // 대체 선수 = 리그 주전 평균 − gap
    gain: number; // 리그 평균이 기준보다 낮으면 새 선수 수준을 이만큼 배로 올림
    lo: number;
    hi: number;
  };
  retire: {
    startAge: number;
    perYear: number; // (나이 − startAge + 1) × perYear
    lowOvr: number; // 이 실력 아래면 더 잘 은퇴
    lowRate: number;
    oldAge: number;
    oldBonus: number;
    eliteHi: number;
    eliteHiMult: number;
    eliteLo: number;
    eliteLoMult: number;
    contracted: number; // 다음 시즌 계약이 남았으면 배율
    faSeasons: number; // FA로 이만큼 못 뛰면 은퇴
  };
  opening: {
    preBonus: number; // 첫 스토브리그: 실제 2026 팀 제안에 더하는 효용 (사전 합의)
  };
  macro: {
    newMean: Record<string, number>; // 새 선수(신인·유망주) 진짜 운영 능력 평균 (리그별)
    newSd: number; // 새 선수 운영 능력 퍼짐 = 처음 추정의 불확실성
    maxAbs: number;
    obsSd: number; // 한 세트로 보는 운영 능력의 흔들림 (추정 갱신: 약 (obsSd/newSd)² 세트에 반쯤 드러남)
    knownSe: number; // 불확실성이 이 아래면 '추정 있음'
    learn: number; // 경험으로 오르는 운영 능력 (learnGames 세트까지 고르게)
    learnGames: number;
    price: number; // 시장 평가에 넣는 운영 기여 비율 (불확실성 할인)
    priceCap: number; // 시장 평가에 더하는 운영 기여 상한 (실력 점수)
  };
  fame: {
    weights: Record<string, number>; // 우승 가중: worlds, msi, lck, split(예전 LCK 스플릿)
    decay: number; // 한 해 지날 때마다
    rate: number; // 인지도 1당 요구 연봉 할증
    cap: number; // 할증 상한
  };
}

export const DEFAULT_CAREER_PARAMS: CareerParams = {
  growth: {
    ageCoef: [[19, 0.55], [20, 0.4], [21, 0.4], [22, 0.25], [23, 0.25], [24, 0.1]],
    maxYearGain: 6,
    noise: 0.4,
    focus: 1.5,
    playMin: 0.4,
    academyPlay: 0.7,
    league: { LCK: 1, LPL: 1, LEC: 0.9, LCS: 0.85, LCP: 0.8, CBLOL: 0.8 },
  },
  decline: {
    byAge: [[23, 0], [24, 0.5], [25, 1], [26, 1.5], [27, 2], [28, 2.5]],
    weights: { laning: 1.2, teamfight: 1.2, vision: 0.6, survival: 0.8, champPool: 0 },
    noise: 0.6,
    noiseOld: 1.5,
    oldAge: 24,
    max: 4,
  },
  potential: {
    headroom: [[16, 17], [17, 16], [18, 13], [19, 10], [20, 7], [21, 5], [22, 3], [23, 1.5], [24, 0.5]],
    sd: 4,
    prodigyP: 0.12,
    prodigyMin: 8,
    prodigyRange: 10,
    prodigyMaxAge: 19,
  },
  rookies: {
    mean: { LCK: 55, LPL: 56, LEC: 50, LCS: 47, LCP: 46, CBLOL: 47 },
    meanShift: 0,
    sd: 5,
    replacementSd: 4,
    cap: 62,
    extra: 1,
  },
  replacement: { gap: 8, gain: 4, lo: -4, hi: 6 },
  retire: {
    startAge: 26,
    perYear: 0.05,
    lowOvr: 70,
    lowRate: 0.02,
    oldAge: 30,
    oldBonus: 0.2,
    eliteHi: 85,
    eliteHiMult: 0.35,
    eliteLo: 78,
    eliteLoMult: 0.6,
    contracted: 0.2,
    faSeasons: 2,
  },
  opening: { preBonus: 0.45 },
  macro: {
    newMean: { LCK: -0.02, LPL: -0.05, LEC: -0.05, LCS: -0.05, LCP: -0.05, CBLOL: -0.05 },
    newSd: 0.12,
    maxAbs: 0.35,
    obsSd: 1.5,
    knownSe: 0.1,
    learn: 0.05,
    learnGames: 400,
    price: 0.6,
    priceCap: 10,
  },
  fame: { weights: { worlds: 1, msi: 0.6, lck: 0.5, split: 0.35 }, decay: 0.85, rate: 0.15, cap: 0.6 },
};

// 나이 표 읽기: 점 사이는 직선, 범위 밖은 끝 값
export function knot(k: Knots, x: number): number {
  if (x <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) {
    const [x1, y1] = k[i];
    if (x <= x1) {
      const [x0, y0] = k[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return k[k.length - 1][1];
}

// 저장된 값(일부만 있을 수 있음)을 기본값 위에 덮는다
export function withDefaults(partial: Partial<Record<keyof CareerParams, object>> | undefined): CareerParams {
  const out = structuredClone(DEFAULT_CAREER_PARAMS) as unknown as Record<string, Record<string, unknown>>;
  for (const [group, values] of Object.entries(partial ?? {})) out[group] = { ...(out[group] ?? {}), ...(values as Record<string, unknown>) };
  return out as unknown as CareerParams;
}

// 튜너용: "growth.maxYearGain", "decline.byAge.3.1" 같은 경로로 숫자 읽기·바꾸기 (원본은 그대로)
export function getCareerParam(cp: CareerParams, key: string): number {
  return key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], cp) as number;
}
export function setCareerParam(cp: CareerParams, key: string, value: number): CareerParams {
  const next = structuredClone(cp) as unknown as Record<string, unknown>;
  const path = key.split(".");
  let o = next;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[path[path.length - 1]] = value;
  return next as unknown as CareerParams;
}
