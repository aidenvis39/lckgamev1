// 운영 기여(콜·운영)의 시즌 변화: 뛴 세트만큼 공개 추정치가 진짜 값에 다가가고(베이즈 갱신), 경험이 쌓일 때까지 진짜 값이 조금 오른다.
// 실제 선수의 데이터 추정치도 회귀분석에서 표본 크기만큼 0 쪽으로 당겨진 값이라, 같은 방식으로 다루면 신인은 '모름'에서 시작한다.
import { createRng, hashSeed } from "../rng.ts";
import type { SeasonStats, WorldState } from "./types.ts";

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function seasonMacro(world: WorldState, stats: SeasonStats): WorldState {
  const m = world.cp.macro;
  const rng = createRng(hashSeed(world.seed, world.season, "macro"));
  const players = { ...world.players };
  for (const p of Object.values(players)) {
    if (p.retired) continue;
    const n = stats.games[p.id] ?? 0;
    if (!n) continue;
    let truth = p.macroTrue ?? p.intangible;
    // 관찰: 이번 시즌 n세트로 본 운영 능력 (세트가 많을수록 정확)
    const y = truth + (m.obsSd / Math.sqrt(n)) * rng.normal();
    const se = Math.max(0.02, p.intangibleSe || m.newSd);
    const prec = 1 / se ** 2 + n / m.obsSd ** 2;
    const est = (p.intangible / se ** 2 + (n * y) / m.obsSd ** 2) / prec;
    const se2 = 1 / Math.sqrt(prec);
    // 경험: learnGames 세트까지 고르게 learn만큼 오른다
    const games = p.careerGames ?? 0;
    if (games < m.learnGames) truth = Math.min(m.maxAbs, truth + (m.learn * Math.min(n, m.learnGames - games)) / m.learnGames);
    players[p.id] = { ...p, macroTrue: r3(truth), intangible: r3(est), intangibleSe: r3(se2), intangibleKnown: se2 <= m.knownSe, careerGames: games + n };
  }
  return { ...world, players };
}
