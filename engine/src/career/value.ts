// 선수 가치: 연봉 요구·이적료·트레이드 판단에 같은 함수를 쓴다. 단위는 가상 크레딧 C (실제 연봉 아님).
// 실력 = 경기 능력 평균. 여기에 운영 기여(공개 추정치)를 더한 '실효 실력'으로 주전·영입을 고르고,
// 연봉은 운영 기여를 불확실한 만큼 할인해 넣은 '시장 평가'와 우승 경력(인지도)으로 정한다.
import type { Ratings } from "../types.ts";
import type { CareerParams } from "./params.ts";
import type { PlayerState } from "./types.ts";

// 가치 계산에 필요한 세계 값 (WorldState가 그대로 맞음)
export interface ValueCtx {
  macroWeight: number;
  cp: CareerParams;
  season: number;
}

// 경기 능력 평균 (챔프폭 제외)
export const overall = (r: Ratings) => (r.laning + r.teamfight + r.vision + r.survival) / 4;

// 운영 기여 1 = 선수 한 명 실력 몇 점인가. 팀 전투력에 macroWeight × 운영 기여가 더해지고, 전투력 1 = 주전 5명 평균 17점
export const macroPoints = (ctx: ValueCtx) => 5 * 17 * ctx.macroWeight;

// 실효 실력: 경기에서 내는 힘 (공개 추정치 기준). AI 주전 선택·영입에 쓴다
export const effective = (ctx: ValueCtx, p: PlayerState) => overall(p.ratings) + macroPoints(ctx) * p.intangible;

// 시장 평가 실력: 운영 기여를 불확실한 만큼 할인하고 상한을 둔다 (연봉·가치·이적료용)
export function marketRating(ctx: ValueCtx, p: PlayerState): number {
  const m = ctx.cp.macro;
  return overall(p.ratings) + Math.max(-m.priceCap, Math.min(m.priceCap, m.price * macroPoints(ctx) * p.intangible));
}

// 인지도: 우승 경력 점수 ("2024 월즈" 1, MSI 0.6, LCK 0.5, 예전 LCK 스플릿 0.35, 해마다 × decay)
export function fame(ctx: ValueCtx, p: PlayerState): number {
  const f = ctx.cp.fame;
  let s = 0;
  for (const t of p.careerTitles) {
    const year = Number(t.slice(0, 4));
    const kind = t.includes("월즈") ? "worlds" : t.includes("MSI") ? "msi" : /스프링|서머/.test(t) ? "split" : "lck";
    s += (f.weights[kind] ?? 0) * f.decay ** Math.max(0, ctx.season - year);
  }
  return s;
}
export const famePremium = (ctx: ValueCtx, p: PlayerState) => Math.min(ctx.cp.fame.cap, ctx.cp.fame.rate * fame(ctx, p));

// 잠재력 여유 (상한 − 현재, 경기 능력 평균)
export const headroom = (p: PlayerState) => Math.max(0, overall(p.potential) - overall(p.ratings));

// 화면 표시용 잠재력 별 (1~5)
export const potentialStars = (p: PlayerState) => Math.max(1, Math.min(5, 1 + Math.round(headroom(p) / 3)));

// 요구 연봉: 시장 평가 90 ≈ 9C, 75 ≈ 3.5C, 65 ≈ 1.3C. 21세 이하는 잠재력만큼 조금 더, 우승 경력이 있으면 인지도만큼 더 부른다
export function salaryDemand(ctx: ValueCtx, p: PlayerState): number {
  const base = 0.4 + 0.9 * Math.max(0, (marketRating(ctx, p) - 55) / 10) ** 1.8;
  const youth = (p.age ?? 22) <= 21 ? 0.15 * headroom(p) : 0;
  return Math.round((base + youth) * (1 + famePremium(ctx, p)) * 10) / 10;
}

// 선수 가치 (트레이드 비교용): 요구 연봉에 나이 할인·잠재력 할증
export function playerValue(ctx: ValueCtx, p: PlayerState): number {
  const age = p.age ?? 22;
  const ageFactor = age <= 22 ? 1.1 : age <= 25 ? 1 : Math.max(0.5, 1 - 0.12 * (age - 25));
  return salaryDemand(ctx, p) * ageFactor + 0.2 * headroom(p);
}

// 이적료: 남은 계약 년수가 길수록 비싸다
export function transferFee(ctx: ValueCtx, p: PlayerState): number {
  const years = p.contract ? Math.max(0, p.contract.endSeason - ctx.season) : 0;
  return Math.round(salaryDemand(ctx, p) * (0.8 + 0.7 * years) * 10) / 10;
}

// 나이에 따른 계약 기간
export const contractYears = (age: number) => (age <= 22 ? 3 : age <= 26 ? 2 : 1);

export const payroll = (players: Record<string, PlayerState>, ids: string[]) =>
  Math.round(ids.reduce((s, id) => s + (players[id]?.contract?.salary ?? 0), 0) * 10) / 10;
