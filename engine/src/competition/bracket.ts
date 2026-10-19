// 토너먼트 대진표를 데이터로 정의하고, 결과가 들어올 때마다 다음에 치를 수 있는 경기를 풀어낸다.
// 자리(Slot)는 "n번 시드", "X 경기 승자/패자", "누가 지목한 팀/지목 안 된 팀", "두 팀 중 시드가 높은/낮은 팀"으로 적는다.
import type { BestOf } from "./types.ts";

export type Slot =
  | { seed: number }
  | { w: string }
  | { l: string }
  | { pick: string } // 지목(choice key)으로 고른 팀
  | { rest: string } // 지목에서 남은 팀
  | { better: [Slot, Slot] } // 원래 시드가 높은 쪽
  | { worse: [Slot, Slot] };

export interface BracketMatchDef {
  key: string;
  label: string;
  a: Slot;
  b: Slot;
}

export interface ChoiceDef {
  key: string;
  label: string;
  by: Slot; // 지목하는 팀
  options: [Slot, Slot];
}

export interface BracketDef {
  id: string;
  name: string;
  size: number;
  bestOf: BestOf;
  matches: BracketMatchDef[];
  choices?: ChoiceDef[];
  places: Array<[number, Slot]>; // 최종 순위 (같은 순위 여러 팀 가능)
}

const s = (seed: number): Slot => ({ seed });
const w = (key: string): Slot => ({ w: key });
const l = (key: string): Slot => ({ l: key });

// 4팀 더블 엘리미네이션, 1팀 진출 (MSI·월즈 플레이인). 브래킷 리셋 없음
const DE4: BracketDef = {
  id: "DE4",
  name: "4팀 더블 엘리미네이션",
  size: 4,
  bestOf: 5,
  matches: [
    { key: "M1", label: "승자조 1경기", a: s(1), b: s(4) },
    { key: "M2", label: "승자조 2경기", a: s(2), b: s(3) },
    { key: "M3", label: "승자조 결승", a: w("M1"), b: w("M2") },
    { key: "M4", label: "패자조 1라운드", a: l("M1"), b: l("M2") },
    { key: "M5", label: "패자조 결승", a: l("M3"), b: w("M4") },
    { key: "M6", label: "최종전", a: w("M3"), b: w("M5") },
  ],
  places: [[1, w("M6")], [2, l("M6")], [3, l("M5")], [4, l("M4")]],
};

// LCK Road to MSI: 1~2라운드 상위 6팀. 1·2위 대결 승자가 MSI 1시드, 3~6위 사다리 승자와 그 패자가 2시드를 다툰다
const RTM: BracketDef = {
  id: "RTM",
  name: "Road to MSI",
  size: 6,
  bestOf: 5,
  matches: [
    { key: "R1", label: "1라운드 (5위 대 6위)", a: s(5), b: s(6) },
    { key: "R3", label: "1시드 결정전 (1위 대 2위)", a: s(1), b: s(2) },
    { key: "R2", label: "2라운드 (4위 도전)", a: s(4), b: w("R1") },
    { key: "R4", label: "3라운드 (3위 도전)", a: s(3), b: w("R2") },
    { key: "R5", label: "2시드 결정전", a: l("R3"), b: w("R4") },
  ],
  places: [[1, w("R3")], [2, w("R5")], [3, l("R5")], [4, l("R4")], [5, l("R2")], [6, l("R1")]],
};

// 8팀 더블 엘리미네이션 (MSI 브래킷). 1·8, 4·5, 2·7, 3·6 시드가 첫 경기
const DE8: BracketDef = {
  id: "DE8",
  name: "8팀 더블 엘리미네이션",
  size: 8,
  bestOf: 5,
  matches: [
    { key: "U1", label: "승자조 1라운드", a: s(1), b: s(8) },
    { key: "U2", label: "승자조 1라운드", a: s(4), b: s(5) },
    { key: "U3", label: "승자조 1라운드", a: s(2), b: s(7) },
    { key: "U4", label: "승자조 1라운드", a: s(3), b: s(6) },
    { key: "U5", label: "승자조 2라운드", a: w("U1"), b: w("U2") },
    { key: "U6", label: "승자조 2라운드", a: w("U3"), b: w("U4") },
    { key: "U7", label: "승자조 결승", a: w("U5"), b: w("U6") },
    { key: "L1", label: "패자조 1라운드", a: l("U1"), b: l("U2") },
    { key: "L2", label: "패자조 1라운드", a: l("U3"), b: l("U4") },
    { key: "L3", label: "패자조 2라운드", a: w("L1"), b: l("U6") },
    { key: "L4", label: "패자조 2라운드", a: w("L2"), b: l("U5") },
    { key: "L5", label: "패자조 3라운드", a: w("L3"), b: w("L4") },
    { key: "L6", label: "패자조 결승", a: w("L5"), b: l("U7") },
    { key: "F", label: "결승", a: w("U7"), b: w("L6") },
  ],
  places: [
    [1, w("F")], [2, l("F")], [3, l("L6")], [4, l("L5")],
    [5, l("L3")], [5, l("L4")], [7, l("L1")], [7, l("L2")],
  ],
};

// LCK 플레이인: 1 = 레전드 5위, 2~4 = 라이즈 1~3위. 1등 = 플레이오프 5시드, 2등 = 6시드
const LCK_PI: BracketDef = {
  id: "LCK_PI",
  name: "LCK 플레이인",
  size: 4,
  bestOf: 5,
  matches: [
    { key: "A", label: "플레이인 1경기 (레전드 5위 대 라이즈 1위)", a: s(1), b: s(2) },
    { key: "B", label: "플레이인 2경기 (라이즈 2위 대 3위)", a: s(3), b: s(4) },
    { key: "C", label: "플레이인 최종전", a: l("A"), b: w("B") },
  ],
  places: [[1, w("A")], [2, w("C")], [3, l("C")], [4, l("B")]],
};

// LCK 플레이오프: 6팀 더블 엘리미네이션. 3시드가 5·6시드 중 상대를, 1시드가 1라운드 승자 중 상대를 지목한다
const LCK_PO: BracketDef = {
  id: "LCK_PO",
  name: "LCK 플레이오프",
  size: 6,
  bestOf: 5,
  choices: [
    { key: "C1", label: "3시드가 1라운드 상대 지목", by: s(3), options: [s(5), s(6)] },
    { key: "C2", label: "1시드가 2라운드 상대 지목", by: s(1), options: [w("U1A"), w("U1B")] },
  ],
  matches: [
    { key: "U1A", label: "승자조 1라운드", a: s(3), b: { pick: "C1" } },
    { key: "U1B", label: "승자조 1라운드", a: s(4), b: { rest: "C1" } },
    { key: "L1", label: "패자조 1라운드", a: l("U1A"), b: l("U1B") },
    { key: "U2A", label: "승자조 2라운드", a: s(1), b: { pick: "C2" } },
    { key: "U2B", label: "승자조 2라운드", a: s(2), b: { rest: "C2" } },
    { key: "L2", label: "패자조 2라운드", a: w("L1"), b: { worse: [l("U2A"), l("U2B")] } },
    { key: "U3", label: "승자조 결승", a: w("U2A"), b: w("U2B") },
    { key: "L3", label: "패자조 3라운드", a: { better: [l("U2A"), l("U2B")] }, b: w("L2") },
    { key: "LF", label: "패자조 결승", a: l("U3"), b: w("L3") },
    { key: "F", label: "결승", a: w("U3"), b: w("LF") },
  ],
  places: [[1, w("F")], [2, l("F")], [3, l("LF")], [4, l("L3")], [5, l("L2")], [6, l("L1")]],
};

// 8팀 단판 토너먼트 (월즈 8강부터). 자리 1~8은 스위스 결과로 배치한다
const SE8: BracketDef = {
  id: "SE8",
  name: "녹아웃",
  size: 8,
  bestOf: 5,
  matches: [
    { key: "Q1", label: "8강", a: s(1), b: s(2) },
    { key: "Q2", label: "8강", a: s(3), b: s(4) },
    { key: "Q3", label: "8강", a: s(5), b: s(6) },
    { key: "Q4", label: "8강", a: s(7), b: s(8) },
    { key: "S1", label: "4강", a: w("Q1"), b: w("Q2") },
    { key: "S2", label: "4강", a: w("Q3"), b: w("Q4") },
    { key: "F", label: "결승", a: w("S1"), b: w("S2") },
  ],
  places: [
    [1, w("F")], [2, l("F")], [3, l("S1")], [3, l("S2")],
    [5, l("Q1")], [5, l("Q2")], [5, l("Q3")], [5, l("Q4")],
  ],
};

export const BRACKETS: Record<string, BracketDef> = { DE4, RTM, DE8, LCK_PI, LCK_PO, SE8 };

// 대진표 진행 상황: 시드 순서, 경기 결과(승자·패자), 지목 결과
export interface BracketView {
  seeds: string[]; // seeds[0] = 1번 시드
  result: (key: string) => { winner: string; loser: string } | null;
  choice: (key: string) => string | null;
}

export function resolveSlot(def: BracketDef, v: BracketView, slot: Slot): string | null {
  if ("seed" in slot) return v.seeds[slot.seed - 1] ?? null;
  if ("w" in slot) return v.result(slot.w)?.winner ?? null;
  if ("l" in slot) return v.result(slot.l)?.loser ?? null;
  if ("pick" in slot) return v.choice(slot.pick);
  if ("rest" in slot) {
    const picked = v.choice(slot.rest);
    if (!picked) return null;
    const c = def.choices!.find((x) => x.key === slot.rest)!;
    return c.options.map((o) => resolveSlot(def, v, o)).find((t) => t && t !== picked) ?? null;
  }
  const pair = "better" in slot ? slot.better : slot.worse;
  const [a, b] = pair.map((x) => resolveSlot(def, v, x));
  if (!a || !b) return null;
  const better = v.seeds.indexOf(a) < v.seeds.indexOf(b) ? a : b;
  return "better" in slot ? better : better === a ? b : a;
}

// 아직 안 정한 지목 중 지금 정할 수 있는 것 (지목하는 팀과 후보가 모두 정해짐)
export function openChoices(def: BracketDef, v: BracketView): Array<{ key: string; label: string; by: string; options: string[] }> {
  const out = [];
  for (const c of def.choices ?? []) {
    if (v.choice(c.key)) continue;
    const by = resolveSlot(def, v, c.by);
    const options = c.options.map((o) => resolveSlot(def, v, o));
    if (by && options.every(Boolean)) out.push({ key: c.key, label: c.label, by, options: options as string[] });
  }
  return out;
}

// 두 팀이 모두 정해진 경기. 홈(1세트 블루)은 원래 시드가 높은 팀
export function readyMatches(def: BracketDef, v: BracketView): Array<{ key: string; label: string; home: string; away: string }> {
  const out = [];
  for (const m of def.matches) {
    if (v.result(m.key)) continue;
    const a = resolveSlot(def, v, m.a);
    const b = resolveSlot(def, v, m.b);
    if (!a || !b) continue;
    const [home, away] = v.seeds.indexOf(a) <= v.seeds.indexOf(b) ? [a, b] : [b, a];
    out.push({ key: m.key, label: m.label, home, away });
  }
  return out;
}

export function isComplete(def: BracketDef, v: BracketView): boolean {
  return def.matches.every((m) => v.result(m.key));
}

export function placements(def: BracketDef, v: BracketView): Array<[number, string]> {
  return def.places.map(([place, slot]) => [place, resolveSlot(def, v, slot)!] as [number, string]).filter(([, t]) => t);
}
