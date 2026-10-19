// 선수 가치: 연봉 요구·이적료·트레이드 판단에 같은 함수를 쓴다. 단위는 가상 크레딧 C (실제 연봉 아님).
import type { Ratings } from "../types.ts";
import type { PlayerState } from "./types.ts";

// 경기 능력 평균 (챔프폭 제외)
export const overall = (r: Ratings) => (r.laning + r.teamfight + r.vision + r.survival) / 4;

// 잠재력 여유 (상한 − 현재, 경기 능력 평균)
export const headroom = (p: PlayerState) => Math.max(0, overall(p.potential) - overall(p.ratings));

// 화면 표시용 잠재력 별 (1~5)
export const potentialStars = (p: PlayerState) => Math.max(1, Math.min(5, 1 + Math.round(headroom(p) / 3)));

// 요구 연봉: 실력 90 ≈ 9C, 75 ≈ 3.5C, 65 ≈ 1.3C. 21세 이하는 잠재력만큼 조금 더 부른다
export function salaryDemand(p: PlayerState): number {
  const base = 0.4 + 0.9 * Math.max(0, (overall(p.ratings) - 55) / 10) ** 1.8;
  const youth = (p.age ?? 22) <= 21 ? 0.15 * headroom(p) : 0;
  return Math.round((base + youth) * 10) / 10;
}

// 선수 가치 (트레이드 비교용): 요구 연봉에 나이 할인·잠재력 할증
export function playerValue(p: PlayerState): number {
  const age = p.age ?? 22;
  const ageFactor = age <= 22 ? 1.1 : age <= 25 ? 1 : Math.max(0.5, 1 - 0.12 * (age - 25));
  return salaryDemand(p) * ageFactor + 0.2 * headroom(p);
}

// 이적료: 남은 계약 년수가 길수록 비싸다
export function transferFee(p: PlayerState, season: number): number {
  const years = p.contract ? Math.max(0, p.contract.endSeason - season) : 0;
  return Math.round(salaryDemand(p) * (0.8 + 0.7 * years) * 10) / 10;
}

export const payroll = (players: Record<string, PlayerState>, ids: string[]) =>
  Math.round(ids.reduce((s, id) => s + (players[id]?.contract?.salary ?? 0), 0) * 10) / 10;
