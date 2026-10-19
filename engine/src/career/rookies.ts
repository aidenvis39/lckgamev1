// 신인: 커리어 시드로 만드는 가상 선수. 실존 선수가 아니라는 표시(virtual)를 단다.
// 능력은 리그 수준보다 낮게, 잠재력 여유는 크게 시작한다. 세계 평균이 해마다 오르지 않게 능력 분포에 상한을 둔다.
import type { Rng } from "../rng.ts";
import type { Position } from "../types.ts";
import type { PlayerState, WorldState } from "./types.ts";
import { rollPotential } from "./world.ts";

const SYL = ["Ha", "Jin", "Seo", "Min", "Do", "Ri", "Kai", "Ren", "Yul", "On", "Ga", "Ra", "Bin", "Hyun", "Sol", "Ji", "Woo", "Tae", "Ian", "Lu", "Nox", "Vey", "Zen", "Ark", "Eon", "Kyo", "Mir", "Ryu", "Sora", "Tal", "Vin", "Yen", "Juno", "Pax", "Rin", "Sae", "Teo", "Uno", "Vale", "Wren"];
const TAIL = ["", "", "", "n", "x", "o", "e", "a", "is", "on"];

export const REGION_NATION: Record<string, string> = {
  LCK: "South Korea",
  LPL: "China",
  LEC: "Europe",
  LCS: "United States",
  LCP: "Vietnam",
  CBLOL: "Brazil",
};

// 리그별 신인 평균 능력은 CareerParams.rookies (2026 각 리그 주전 평균보다 15~20점 낮게)

function rookieName(world: WorldState, rng: Rng): string {
  const taken = new Set(Object.values(world.players).map((p) => p.name.toLowerCase()));
  for (let i = 0; i < 50; i++) {
    const name = SYL[rng.int(SYL.length)] + SYL[rng.int(SYL.length)].toLowerCase() + TAIL[rng.int(TAIL.length)];
    if (name.length <= 9 && !taken.has(name.toLowerCase())) return name;
  }
  return `Rookie${world.nextRookie}`;
}

// replacement: 신인 대신 하부 리그(2군·ERL·LDL 등)에서 데려오는 '대체 선수 수준' 선수. 나이가 더 많고 능력이 리그 주전 평균 − 8 근처
export function makeRookie(
  world: WorldState,
  league: string,
  position: Position,
  team: string | null,
  academy: boolean,
  rng: Rng,
  opts: { replacement?: boolean; salary?: number } = {},
): PlayerState {
  const rk = world.cp.rookies;
  const age = opts.replacement ? 18 + rng.int(4) : 17 + rng.int(3);
  // 2군 신인도 대체 선수 수준을 따라 오르내린다 (세계 수준 유지 보정이 신인에게도 걸림)
  const drift = (world.replacement[league] ?? 0) - ((world.baseline[league] ?? 0) - world.cp.replacement.gap);
  const mean = opts.replacement ? (world.replacement[league] ?? 60) : Math.min(rk.cap, (rk.mean[league] ?? 50) + rk.meanShift + drift);
  const r = () => Math.round(Math.min(mean + 12, Math.max(35, mean + (opts.replacement ? rk.replacementSd : rk.sd) * rng.normal())) * 10) / 10;
  const ratings = { laning: r(), teamfight: r(), vision: r(), survival: r(), champPool: Math.round(45 + 15 * rng.next()) };
  // 운영 능력: 진짜 값은 뽑아 두고(숨김), 공개 추정치는 리그 평균에서 시작해 뛸수록 드러난다
  const mc = world.cp.macro;
  const prior = mc.newMean[league] ?? 0;
  const macroTrue = Math.round(Math.max(-mc.maxAbs, Math.min(mc.maxAbs, prior + mc.newSd * rng.normal())) * 1000) / 1000;
  // 포지션 메타 상위 챔피언 몇 개를 조금 해본 상태로 시작
  const id = `rk${world.season + 1}-${world.nextRookie}`;
  return {
    id,
    name: rookieName(world, rng),
    team: team ?? "",
    position,
    age,
    birthDate: null,
    nationality: REGION_NATION[league] ?? null,
    contractEnd: null,
    games2026: 0,
    starter: false,
    ratingLeague: "GLOBAL",
    lowSample: true,
    ratings,
    intangible: prior,
    intangibleSe: mc.newSd,
    intangibleKnown: false,
    macroTrue,
    champions: {},
    potential: rollPotential(world.cp, ratings, age, rng, Math.max(0, drift) + rk.extra),
    contract: team ? { team, endSeason: world.season + 2, salary: opts.salary ?? (academy ? 0.3 : 0.6), role: "bench", generated: true } : null,
    academy,
    virtual: true,
    faSeasons: 0,
    retired: false,
    careerTitles: [],
    careerGames: 0,
  };
}

// 챔피언 풀이 비어 있으면 그 포지션 메타 상위 챔피언으로 채운다 (밴픽 숙련도가 0이 되지 않게)
export function seedPool(p: PlayerState, positionTop: string[], rng: Rng): PlayerState {
  if (Object.keys(p.champions).length) return p;
  const pool: Record<string, number> = {};
  for (const c of positionTop.slice(0, 8)) if (rng.next() < 0.6) pool[c] = 1 + rng.int(5);
  return { ...p, champions: pool };
}
