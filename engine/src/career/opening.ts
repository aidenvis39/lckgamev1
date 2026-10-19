// 첫 스토브리그 (2025 시즌 끝 → 2026). 능력치는 이미 2026 값이라 시즌 결산 성장·나이·신인·메타 변화는 없다.
// AI 팀은 실제 2026 이적을 재현한다 (market.ts의 사전 합의). 사용자가 끼어들지 않으면 2026 로스터가 실제와 같아진다.
import type { Champion, Position } from "../types.ts";
import { POSITIONS } from "../types.ts";
import { fillRosters, release } from "./market.ts";
import type { SeasonStats, TeamState, WorldState } from "./types.ts";
import { effective } from "./value.ts";
import { FIRST_SEASON, mainRoster, MAX_MAIN_ROSTER } from "./world.ts";
import { createRng, hashSeed } from "../rng.ts";

// 팀별 이번 스토브리그에 계약이 끝나는 선수 (1군·2군)
export function expiringOf(world: WorldState): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of Object.values(world.teams))
    out[t.id] = [...mainRoster(t), ...t.academy].filter((id) => (world.players[id].contract?.endSeason ?? 0) <= world.season);
  return out;
}

// 실제 은퇴만 처리하고 계약 만료 목록을 돌려준다
export function beginOpening(world: WorldState): { world: WorldState; expiring: Record<string, string[]> } {
  let w = world;
  for (const id of w.opening?.retire ?? []) {
    if (w.players[id].contract) w = release(w, id);
    w = { ...w, players: { ...w.players, [id]: { ...w.players[id], retired: true, contract: null } }, freeAgents: w.freeAgents.filter((x) => x !== id) };
  }
  return { world: w, expiring: expiringOf(w) };
}

// AI 팀 주전: 실제 2026 주전이 팀에 있으면 그 선수, 아니면 그 포지션에서 가장 잘하는 선수
function openingLineups(world: WorldState, userTeam: string | null): WorldState {
  let w = world;
  for (const t0 of Object.values(w.teams)) {
    if (t0.id === userTeam) continue;
    let t = t0;
    for (const pos of POSITIONS) {
      const real = w.opening!.realStarters[t.id]?.[pos];
      const pool = [...mainRoster(t), ...t.academy].filter((id) => w.players[id].position === pos);
      const pick = real && pool.includes(real) ? real : pool.sort((a, b) => effective(w, w.players[b]) - effective(w, w.players[a]))[0];
      if (!pick || t.starters[pos] === pick) continue;
      const cur = t.starters[pos];
      const fromAcademy = t.academy.includes(pick);
      t = {
        ...t,
        starters: { ...t.starters, [pos]: pick },
        bench: [...t.bench.filter((x) => x !== pick), ...(cur ? [cur] : [])],
        academy: t.academy.filter((x) => x !== pick),
      };
      if (fromAcademy) {
        const p = w.players[pick];
        w = { ...w, players: { ...w.players, [pick]: { ...p, academy: false, contract: { ...p.contract!, salary: Math.max(p.contract!.salary, 0.6), role: "starter" } } } };
      }
    }
    // 1군 인원이 넘치면 가치 낮은 후보를 2군(LCK) 또는 방출
    while (mainRoster(t).length > MAX_MAIN_ROSTER) {
      const cut = [...t.bench].sort((a, b) => effective(w, w.players[a]) - effective(w, w.players[b]))[0];
      if (t.league === "LCK") {
        t = { ...t, bench: t.bench.filter((x) => x !== cut), academy: [...t.academy, cut] };
        w = { ...w, players: { ...w.players, [cut]: { ...w.players[cut], academy: true } } };
      } else {
        w = { ...w, teams: { ...w.teams, [t.id]: t } };
        w = release(w, cut);
        t = w.teams[t.id];
      }
    }
    w = { ...w, teams: { ...w.teams, [t.id]: t } };
  }
  return w;
}

// 첫 스토브리그 마무리 → 2026 시즌 시작. 챔피언 풀은 그대로 (2026 출전 기록을 이미 담고 있어서 줄이면 캘리브레이션이 깨짐)
export function finishOpening(world: WorldState, _stats: SeasonStats, champions: Map<string, Champion>, userTeam: string | null, positionTop: (c: Map<string, Champion>, m: Record<string, number>) => Record<Position, string[]>): WorldState {
  const rng = createRng(hashSeed(world.seed, world.season, "finish-opening"));
  let w = fillRosters(world, rng, positionTop(champions, world.champMeta));
  w = openingLineups(w, userTeam);
  const opening = w.opening!;
  const players = { ...w.players };
  for (const p of Object.values(players)) if (!p.retired) players[p.id] = { ...p, faSeasons: p.contract ? 0 : p.faSeasons + 1, starter: false };
  // 팀워크: 실제 2026 주전을 지킨 비율만큼 튜닝값을 유지. 음수 팀워크는 선수를 잃어도 좋아지지 않게 그대로
  const teams = Object.fromEntries(
    Object.values(w.teams).map((t): [string, TeamState] => {
      const now = POSITIONS.map((pos) => t.starters[pos]);
      const real = POSITIONS.map((pos) => opening.realStarters[t.id]?.[pos]);
      const kept = now.filter((id) => real.includes(id)).length / 5;
      const tuned = opening.tunedTeamwork[t.id] ?? 0;
      for (const id of now) players[id] = { ...players[id], starter: true };
      return [t.id, { ...t, teamwork: tuned > 0 ? tuned * kept : tuned, seasonStarters: now, focus: [] }];
    }),
  );
  return { ...w, players, teams, season: FIRST_SEASON, opening: null };
}
