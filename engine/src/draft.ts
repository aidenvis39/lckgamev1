// 밴픽. 프로 경기 순서(밴 3-픽 3-밴 2-픽 2)대로 진행하고, 피어리스 드래프트를 지원한다.
// 한 단계씩 진행하는 API(newDraft → currentTurn → applyChoice)라서 사람이 한쪽을 맡을 수 있고,
// runDraft는 같은 API로 양쪽 모두 AI가 고른다.
import type { Params } from "./params.ts";
import type { Rng } from "./rng.ts";
import { mastery, matchupGd15, duoBonus } from "./strength.ts";
import type { Champion, DraftResult, DraftStep, Lineup, Position, Side, Universe } from "./types.ts";
import { POSITIONS, other } from "./types.ts";

export const DRAFT_ORDER: ReadonlyArray<readonly ["ban" | "pick", Side]> = [
  ["ban", "blue"], ["ban", "red"], ["ban", "blue"], ["ban", "red"], ["ban", "blue"], ["ban", "red"],
  ["pick", "blue"], ["pick", "red"], ["pick", "red"], ["pick", "blue"], ["pick", "blue"], ["pick", "red"],
  ["ban", "red"], ["ban", "blue"], ["ban", "red"], ["ban", "blue"],
  ["pick", "red"], ["pick", "blue"], ["pick", "blue"], ["pick", "red"],
];

export const MIN_ROLE_SHARE = 0.15;

export interface DraftState {
  turn: number; // DRAFT_ORDER 위치
  unavailable: ReadonlySet<string>; // 피어리스로 막힌 챔피언
  taken: ReadonlySet<string>; // 밴·픽·피어리스로 쓸 수 없는 챔피언
  bans: Record<Side, string[]>;
  picks: Record<Side, Partial<Record<Position, string>>>;
  steps: DraftStep[];
}

export interface DraftContext {
  u: Universe;
  lineups: Record<Side, Lineup>;
  p: Params;
}

export interface DraftOption {
  champion: string;
  position: Position;
  value: number;
}

export function newDraft(unavailable: Iterable<string> = []): DraftState {
  const blocked = new Set(unavailable);
  return { turn: 0, unavailable: blocked, taken: new Set(blocked), bans: { blue: [], red: [] }, picks: { blue: {}, red: {} }, steps: [] };
}

export function currentTurn(s: DraftState): readonly ["ban" | "pick", Side] | null {
  return DRAFT_ORDER[s.turn] ?? null;
}

// side 팀이 champ를 pos에 쓸 때의 가치 (메타 + 숙련도 + 포지션 적합도 + 상성 + 바텀 조합)
export function pickValue(ctx: DraftContext, s: DraftState, side: Side, champ: Champion, pos: Position): number {
  const share = champ.positions[pos] ?? 0;
  if (share < MIN_ROLE_SHARE) return -Infinity;
  const { u, p } = ctx;
  const player = ctx.lineups[side].players[pos];
  let v = p.draftMeta * champ.meta + p.draftMastery * mastery(player, champ.id) + 0.3 * share;
  const enemy = s.picks[other(side)][pos];
  if (enemy) v += matchupGd15(u, pos, champ.id, enemy) / 500;
  const mine = s.picks[side];
  if (pos === "bot" && mine.sup) v += 2 * duoBonus(u, champ.id, mine.sup);
  if (pos === "sup" && mine.bot) v += 2 * duoBonus(u, mine.bot, champ.id);
  return v;
}

// side 팀이 지금 쓸 수 있는 챔피언을 가치순으로 (챔피언마다 가장 좋은 빈 포지션 하나)
export function rankOptions(ctx: DraftContext, s: DraftState, side: Side): DraftOption[] {
  const open = POSITIONS.filter((pos) => !s.picks[side][pos]);
  const out: DraftOption[] = [];
  for (const champ of ctx.u.champions.values()) {
    if (s.taken.has(champ.id)) continue;
    let best: DraftOption | null = null;
    for (const pos of open) {
      const value = pickValue(ctx, s, side, champ, pos);
      if (value > (best?.value ?? -Infinity)) best = { champion: champ.id, position: pos, value };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.value - a.value);
}

// 지금 차례인 팀의 AI 선택. 밴은 상대가 가장 원할 챔피언, 픽은 우리 팀에 가장 좋은 챔피언.
export function aiChoice(ctx: DraftContext, s: DraftState, rng: Rng): DraftStep | null {
  const turn = currentTurn(s);
  if (!turn) return null;
  const [kind, side] = turn;
  const target = best(ctx, s, kind === "ban" ? other(side) : side, rng);
  if (kind === "ban") return target ? { kind, side, champion: target.champ.id } : null;
  const choice = target ?? fallback(ctx, s, side);
  return { kind, side, champion: choice.champ.id, position: choice.pos };
}

// 선택을 반영한 새 상태 (원본은 그대로). null이면 그 차례를 건너뛴다.
export function applyChoice(s: DraftState, step: DraftStep | null): DraftState {
  const turn = currentTurn(s);
  if (!turn) throw new Error("밴픽이 이미 끝났음");
  if (!step) return { ...s, turn: s.turn + 1 };
  const [kind, side] = turn;
  if (step.kind !== kind || step.side !== side) throw new Error(`지금은 ${side} ${kind} 차례`);
  if (s.taken.has(step.champion)) throw new Error(`${step.champion}은(는) 쓸 수 없음`);
  const taken = new Set(s.taken).add(step.champion);
  const bans = { blue: [...s.bans.blue], red: [...s.bans.red] };
  const picks = { blue: { ...s.picks.blue }, red: { ...s.picks.red } };
  if (kind === "ban") bans[side].push(step.champion);
  else {
    if (!step.position || picks[side][step.position]) throw new Error("빈 포지션을 골라야 함");
    picks[side][step.position] = step.champion;
  }
  return { ...s, turn: s.turn + 1, taken, bans, picks, steps: [...s.steps, step] };
}

export function toResult(s: DraftState): DraftResult {
  if (currentTurn(s)) throw new Error("밴픽이 아직 안 끝났음");
  return { bans: s.bans, picks: s.picks as Record<Side, Record<Position, string>>, steps: s.steps };
}

export interface DraftOptions {
  unavailable?: ReadonlySet<string>; // 피어리스: 이전 세트에서 나온 챔피언
}

export function runDraft(u: Universe, lineups: Record<Side, Lineup>, p: Params, rng: Rng, opts: DraftOptions = {}): DraftResult {
  const ctx = { u, lineups, p };
  let s = newDraft(opts.unavailable);
  while (currentTurn(s)) s = applyChoice(s, aiChoice(ctx, s, rng));
  return toResult(s);
}

// side 팀이 지금 고를 수 있는 최선의 (챔피언, 포지션). 약간의 랜덤으로 매번 같은 밴픽이 되지 않게 한다.
function best(ctx: DraftContext, s: DraftState, side: Side, rng: Rng): { champ: Champion; pos: Position; v: number } | null {
  const open = POSITIONS.filter((pos) => !s.picks[side][pos]);
  let top: { champ: Champion; pos: Position; v: number } | null = null;
  for (const champ of ctx.u.champions.values()) {
    if (s.taken.has(champ.id)) continue;
    for (const pos of open) {
      let v = pickValue(ctx, s, side, champ, pos);
      if (v === -Infinity) continue;
      v += ctx.p.draftNoise * gumbel(rng);
      if (!top || v > top.v) top = { champ, pos, v };
    }
  }
  return top;
}

// 포지션에 맞는 챔피언이 다 빠졌을 때 (피어리스 후반 세트): 아무 남은 챔피언
function fallback(ctx: DraftContext, s: DraftState, side: Side) {
  const pos = POSITIONS.find((x) => !s.picks[side][x])!;
  const champ = [...ctx.u.champions.values()]
    .filter((c) => !s.taken.has(c.id))
    .sort((a, b) => (b.positions[pos] ?? 0) - (a.positions[pos] ?? 0))[0];
  // 168개 챔피언에 피어리스 BO5(최대 50픽 + 세트당 밴 10)로는 생기지 않지만, 챔피언 풀을 줄인 데이터에선 날 수 있다
  if (!champ) throw new Error(`쓸 수 있는 챔피언이 없어 밴픽을 완성할 수 없음 (${side} ${pos})`);
  return { champ, pos, v: 0 };
}

const gumbel = (rng: Rng): number => -Math.log(-Math.log(rng.next() || 1e-12));
