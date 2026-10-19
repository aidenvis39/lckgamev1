// 밴픽 AI. 프로 경기 순서(밴 3-픽 3-밴 2-픽 2)대로 진행하고, 피어리스 드래프트를 지원한다.
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

const MIN_ROLE_SHARE = 0.15;

export interface DraftOptions {
  unavailable?: ReadonlySet<string>; // 피어리스: 이전 세트에서 나온 챔피언
}

export function runDraft(u: Universe, lineups: Record<Side, Lineup>, p: Params, rng: Rng, opts: DraftOptions = {}): DraftResult {
  const taken = new Set<string>(opts.unavailable ?? []);
  const bans: Record<Side, string[]> = { blue: [], red: [] };
  const picks: Record<Side, Partial<Record<Position, string>>> = { blue: {}, red: {} };
  const steps: DraftStep[] = [];
  const pool = [...u.champions.values()];

  // side 팀이 champ를 pos에 쓸 때의 가치
  const value = (side: Side, champ: Champion, pos: Position): number => {
    const share = champ.positions[pos] ?? 0;
    if (share < MIN_ROLE_SHARE) return -Infinity;
    const player = lineups[side].players[pos];
    let v = p.draftMeta * champ.meta + p.draftMastery * mastery(player, champ.id) + 0.3 * share;
    const enemy = picks[other(side)][pos];
    if (enemy) v += matchupGd15(u, pos, champ.id, enemy) / 500;
    if (pos === "bot" && picks[side].sup) v += 2 * duoBonus(u, champ.id, picks[side].sup!);
    if (pos === "sup" && picks[side].bot) v += 2 * duoBonus(u, picks[side].bot!, champ.id);
    return v;
  };

  // side 팀이 지금 고를 수 있는 최선의 (챔피언, 포지션)
  const best = (side: Side, noisy: boolean): { champ: Champion; pos: Position; v: number } | null => {
    const open = POSITIONS.filter((pos) => !picks[side][pos]);
    let top: { champ: Champion; pos: Position; v: number } | null = null;
    for (const champ of pool) {
      if (taken.has(champ.id)) continue;
      for (const pos of open) {
        let v = value(side, champ, pos);
        if (v === -Infinity) continue;
        if (noisy) v += p.draftNoise * gumbel(rng);
        if (!top || v > top.v) top = { champ, pos, v };
      }
    }
    return top;
  };

  for (const [kind, side] of DRAFT_ORDER) {
    if (kind === "ban") {
      // 상대가 가장 원할 챔피언을 밴
      const target = best(other(side), true);
      if (!target) continue;
      taken.add(target.champ.id);
      bans[side].push(target.champ.id);
      steps.push({ kind, side, champion: target.champ.id });
    } else {
      const choice = best(side, true) ?? fallback(pool, taken, picks[side]);
      taken.add(choice.champ.id);
      picks[side][choice.pos] = choice.champ.id;
      steps.push({ kind, side, champion: choice.champ.id, position: choice.pos });
    }
  }
  return { bans, picks: picks as Record<Side, Record<Position, string>>, steps };
}

// 포지션에 맞는 챔피언이 다 빠졌을 때 (피어리스 후반 세트): 아무 남은 챔피언
function fallback(pool: Champion[], taken: Set<string>, mine: Partial<Record<Position, string>>) {
  const pos = POSITIONS.find((x) => !mine[x])!;
  const champ = pool.filter((c) => !taken.has(c.id)).sort((a, b) => (b.positions[pos] ?? 0) - (a.positions[pos] ?? 0))[0];
  return { champ, pos, v: 0 };
}

const gumbel = (rng: Rng): number => -Math.log(-Math.log(rng.next() || 1e-12));
