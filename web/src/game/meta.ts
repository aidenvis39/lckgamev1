// 화면 표시용 정보: 팀 이름·색, 포지션 이름, 등급 계산, 챔피언 이미지
import type { Champion, Position } from "../engine.ts";

export interface TeamStyle {
  name: string; // 한국어 이름
  color: string; // 배지 배경
  ink: string; // 배지 글자
}

export const TEAM_STYLE: Record<string, TeamStyle> = {
  GEN: { name: "젠지", color: "#A98B4E", ink: "#141008" },
  HLE: { name: "한화생명e스포츠", color: "#F07A22", ink: "#1B0D02" },
  T1: { name: "T1", color: "#E0102F", ink: "#FFFFFF" },
  DK: { name: "디플러스 기아", color: "#1AA3A0", ink: "#031716" },
  KT: { name: "kt 롤스터", color: "#2A2A2E", ink: "#FF4A4A" },
  BRO: { name: "한진 브리온", color: "#11895A", ink: "#FFFFFF" },
  NS: { name: "농심 레드포스", color: "#A8141E", ink: "#FFFFFF" },
  BFX: { name: "BNK 피어엑스", color: "#F2C300", ink: "#1C1600" },
  DRX: { name: "키움 DRX", color: "#3C6FE0", ink: "#FFFFFF" },
  DNS: { name: "DN 수퍼스", color: "#7650D8", ink: "#FFFFFF" },
};

export const POS_KO: Record<Position, string> = { top: "탑", jng: "정글", mid: "미드", bot: "원딜", sup: "서폿" };

export const DDRAGON_VERSION = "16.20.1";
export const champImage = (id: string) => `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${id}.png`;

// 메타 점수(0~1) → 티어
export function metaTier(c: Champion): "S" | "A" | "B" | "C" {
  return c.meta >= 0.85 ? "S" : c.meta >= 0.7 ? "A" : c.meta >= 0.5 ? "B" : "C";
}

// 능력치(40~99) → 등급
export function grade(r: number): string {
  return r >= 92 ? "S" : r >= 82 ? "A" : r >= 70 ? "B" : r >= 58 ? "C" : "D";
}

// 운영 기여(로짓) → 표시용 등급. 불확실성이 커서 5단계로만 보여준다.
export function macroGrade(x: number): { label: string; tone: "good" | "neutral" | "bad" } {
  if (x >= 0.15) return { label: "탁월", tone: "good" };
  if (x >= 0.05) return { label: "좋음", tone: "good" };
  if (x > -0.05) return { label: "보통", tone: "neutral" };
  if (x > -0.15) return { label: "아쉬움", tone: "bad" };
  return { label: "부족", tone: "bad" };
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
export const clock = (t: number) => `${String(Math.floor(t)).padStart(2, "0")}:${String(Math.floor((t % 1) * 60)).padStart(2, "0")}`;
export const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(Math.round(x)).toLocaleString("ko-KR")}`;
