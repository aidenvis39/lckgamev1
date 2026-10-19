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
  // 해외 (색은 각 팀 대표색을 대략 맞춘 것)
  BLG: { name: "빌리빌리 게이밍", color: "#1E9BE0", ink: "#FFFFFF" },
  AL: { name: "애니원즈 레전드", color: "#C8102E", ink: "#FFFFFF" },
  NIP: { name: "닌자스 인 파자마스", color: "#2B2B2B", ink: "#F5F5F5" },
  TES: { name: "탑 e스포츠", color: "#E8501A", ink: "#FFFFFF" },
  JDG: { name: "징동 게이밍", color: "#C4122F", ink: "#FFFFFF" },
  IG: { name: "인빅터스 게이밍", color: "#F2F2F2", ink: "#151515" },
  LGD: { name: "LGD 게이밍", color: "#8E1B2B", ink: "#FFFFFF" },
  WBG: { name: "웨이보 게이밍", color: "#E6162D", ink: "#FFFFFF" },
  LNG: { name: "LNG e스포츠", color: "#1450A0", ink: "#FFFFFF" },
  TT: { name: "썬더토크 게이밍", color: "#F5C400", ink: "#1A1400" },
  WE: { name: "팀 WE", color: "#B1132A", ink: "#FFFFFF" },
  EDG: { name: "에드워드 게이밍", color: "#1B1B1B", ink: "#FFFFFF" },
  KC: { name: "카르민 코프", color: "#0F3EB5", ink: "#FFFFFF" },
  G2: { name: "G2 e스포츠", color: "#E8E8E8", ink: "#E2001A" },
  VIT: { name: "팀 바이탈리티", color: "#F5E400", ink: "#141400" },
  MKOI: { name: "모비스타 코이", color: "#5B2A86", ink: "#FFFFFF" },
  NAVI: { name: "나투스 빈체레", color: "#FFE600", ink: "#111111" },
  GX: { name: "자이언트X", color: "#5E2CA5", ink: "#FFFFFF" },
  FNC: { name: "프나틱", color: "#FF5900", ink: "#111111" },
  SK: { name: "SK 게이밍", color: "#E5E5E5", ink: "#111111" },
  SHFT: { name: "시프터스", color: "#2F8F5B", ink: "#FFFFFF" },
  TH: { name: "팀 헤레틱스", color: "#D4AF37", ink: "#111111" },
  LYON: { name: "라이온", color: "#0D2B6B", ink: "#FFFFFF" },
  TL: { name: "팀 리퀴드", color: "#0A1F44", ink: "#9BD3FF" },
  C9: { name: "클라우드 나인", color: "#1DAFEC", ink: "#FFFFFF" },
  FLY: { name: "플라이퀘스트", color: "#0E7A4E", ink: "#FFFFFF" },
  SEN: { name: "센티널즈", color: "#CE1126", ink: "#FFFFFF" },
  SR: { name: "쇼피파이 리벨리온", color: "#95BF47", ink: "#10230A" },
  DSG: { name: "디스가이즈드", color: "#F2A900", ink: "#1A1200" },
  DIG: { name: "디그니타스", color: "#F7C600", ink: "#151515" },
  TSW: { name: "팀 시크릿 웨일즈", color: "#20232A", ink: "#FFFFFF" },
  GAM: { name: "GAM e스포츠", color: "#F4B400", ink: "#161000" },
  MVK: { name: "MVK e스포츠", color: "#D7263D", ink: "#FFFFFF" },
  CFO: { name: "CTBC 플라잉 오이스터", color: "#1F6F43", ink: "#FFFFFF" },
  DCG: { name: "딥 크로스 게이밍", color: "#3B3F8F", ink: "#FFFFFF" },
  SHG: { name: "후쿠오카 소프트뱅크 호크스", color: "#F6C800", ink: "#161200" },
  GZ: { name: "그라운드 제로 게이밍", color: "#5A5A5A", ink: "#FFFFFF" },
  DFM: { name: "데토네이션 포커스미", color: "#0B3C91", ink: "#FFFFFF" },
  LOUD: { name: "라우드", color: "#13D161", ink: "#06180C" },
  FUR: { name: "퓨리아", color: "#1A1A1A", ink: "#FFFFFF" },
  LOS: { name: "로스", color: "#E94B3C", ink: "#FFFFFF" },
  RED: { name: "레드 카니즈", color: "#C1121F", ink: "#FFFFFF" },
  VKS: { name: "비보 키드 스타즈", color: "#4B0F8C", ink: "#FFFFFF" },
  FXW7: { name: "플럭소 W7M", color: "#8A2BE2", ink: "#FFFFFF" },
  PNG: { name: "페인 게이밍", color: "#D50000", ink: "#FFFFFF" },
  LEV: { name: "레비아탄", color: "#202A44", ink: "#FFFFFF" },
};

export const LEAGUE_STYLE: Record<string, { name: string; color: string }> = {
  LCK: { name: "LCK", color: "#C8AA6E" },
  LPL: { name: "LPL", color: "#E5484D" },
  LEC: { name: "LEC", color: "#4C8DFF" },
  LCS: { name: "LCS", color: "#3DD68C" },
  LCP: { name: "LCP", color: "#F5A524" },
  CBLOL: { name: "CBLOL", color: "#A78BFA" },
};

export const EVENT_NAME: Record<string, string> = {
  LCK: "LCK 정규시즌",
  RTM: "Road to MSI",
  MSI: "MSI",
  LCKPO: "LCK 포스트시즌",
  WORLDS: "월즈",
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

// 대회 최종 순위 → 표시 이름
export function placeName(event: string, place: number | null): string {
  if (place === null) return "미출전";
  if (place === 1) return "우승";
  if (place === 2) return "준우승";
  if (event === "WORLDS") {
    if (place === 3) return "4강";
    if (place === 5) return "8강";
    if (place === 9) return "스위스 2승 3패 탈락";
    if (place === 12) return "스위스 1승 3패 탈락";
    if (place === 15) return "스위스 0승 3패 탈락";
    return "플레이인 탈락";
  }
  if (event === "MSI") {
    if (place === 5) return "5~6위";
    if (place === 7) return "7~8위";
    if (place >= 9) return "플레이인 탈락";
  }
  return `${place}위`;
}
