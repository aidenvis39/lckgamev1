// 선수·챔피언·조합을 숫자로 바꾸는 공용 함수 (드래프트 AI와 경기 시뮬이 같이 쓴다)
import type { Params } from "./params.ts";
import type { Champion, Player, Position, Universe } from "./types.ts";

export const z = (rating: number): number => (rating - 70) / 17;

// 챔피언 숙련도 0~1. 많이 해본 챔피언일수록 1에 가깝고,
// 한 번도 안 해본 챔피언은 챔프폭 능력치에 따라 0.15~0.4
export function mastery(player: Player, championId: string): number {
  const games = player.champions[championId] ?? 0;
  const floor = 0.15 + 0.25 * (player.ratings.champPool / 100);
  return Math.max(floor, 1 - Math.exp(-games / 6));
}

// 맞대결 15분 골드차 (블루 챔피언 기준). 표본이 적으면 0 쪽으로 당긴다.
export function matchupGd15(u: Universe, pos: Position, champ: string, opp: string): number {
  const m = u.matchups.lane.get(`${pos}|${champ}|${opp}`);
  return m ? (m.gd15 * m.n) / (m.n + 20) : 0;
}

export function duoBonus(u: Universe, bot: string, sup: string): number {
  const d = u.matchups.duo.get(`${bot}|${sup}`);
  return d ? ((d.winrate - 0.5) * d.n) / (d.n + 30) : 0;
}

// 조합 점수: 앞라인 유무, 물리/마법 딜 비율, 바텀 조합
export function compScore(u: Universe, picks: Record<Position, string>, p: Params): number {
  const champs = Object.values(picks).map((id) => u.champions.get(id)!);
  const front = (["top", "jng", "sup"] as Position[]).some((pos) => {
    const c = u.champions.get(picks[pos])!;
    return c.tags.includes("Tank") || c.toughness >= 6;
  });
  const phys = champs.reduce((s, c) => s + c.damage.physical, 0);
  const magic = champs.reduce((s, c) => s + c.damage.magic, 0);
  const apShare = magic / Math.max(1, phys + magic);
  const skew = Math.max(0, Math.abs(apShare - 0.45) - 0.2);
  return (front ? 0 : -p.compFront) - p.compDamage * skew + p.compDuo * duoBonus(u, picks.bot, picks.sup);
}

// 한 선수의 교전 전투력 (z 단위). t = 경기 시간(분)
export function fighterPower(player: Player, champ: Champion, t: number, p: Params): number {
  const r = player.ratings;
  const curve = Math.max(-1, Math.min(1, (t - 25) / 10)); // 25분 전엔 초반형, 후엔 후반형 챔피언이 유리
  return (
    0.55 * z(r.teamfight) +
    0.25 * z(r.vision) +
    0.2 * z(r.survival) +
    p.champMeta * (champ.meta - 0.5) +
    p.champMastery * (mastery(player, champ.id) - 0.5) +
    p.champLate * champ.late * curve
  );
}
