// 세계 상태 만들기, 엔진 Universe로 바꾸기, 로스터 검사.
import type { Params } from "../params.ts";
import { createRng, hashSeed, type Rng } from "../rng.ts";
import type { WorldTargets } from "../targets.ts";
import type { Champion, Player, Ratings, TeamInfo, Universe } from "../types.ts";
import { POSITIONS } from "../types.ts";
import { DEFAULT_CAREER_PARAMS, knot, type CareerParams } from "./params.ts";
import type { PlayerState, PreAgreement, SeasonStats, Start2025, StartEntry, TeamState, WorldState } from "./types.ts";
import { contractYears, payroll, salaryDemand } from "./value.ts";

export const OPENING_SEASON = 2025; // 커리어는 2025 시즌이 끝난 스토브리그에서 시작
export const FIRST_SEASON = 2026; // 처음 치르는 시즌
export const MAX_MAIN_ROSTER = 10; // 1군 최대 인원 (2026 실제 로스터 최대치)
// 리그별 연봉 상한 최소치 (C)
const CAP_FLOOR: Record<string, number> = { LCK: 18, LPL: 18, LEC: 14, LCS: 14, LCP: 10, CBLOL: 10 };

// 나이별 잠재력 여유 평균 (경기 능력 평균 기준 점수)
export const headroomMean = (cp: CareerParams, age: number) => knot(cp.potential.headroom, age);

// extra: 신인·유망주에게 더 주는 여유 (세계 수준 유지 보정). 일부는 '재능형'으로 여유가 크게 붙는다 (스타가 나올 꼬리)
export function rollPotential(cp: CareerParams, r: Ratings, age: number, rng: Rng, extra = 0): Ratings {
  const pt = cp.potential;
  const prodigy = extra > 0 || age <= pt.prodigyMaxAge ? (rng.next() < pt.prodigyP ? pt.prodigyMin + pt.prodigyRange * rng.next() : 0) : 0;
  const h = Math.max(0, headroomMean(cp, age) + pt.sd * rng.normal() + prodigy + extra);
  const up = () => h * (0.7 + 0.6 * rng.next());
  return {
    laning: r.laning + up(),
    teamfight: r.teamfight + up(),
    vision: r.vision + up(),
    survival: r.survival + up(),
    champPool: r.champPool + 0.5 * up(),
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const shiftRatings = (r: Ratings, d: number): Ratings => ({
  laning: round1(r.laning + d),
  teamfight: round1(r.teamfight + d),
  vision: round1(r.vision + d),
  survival: round1(r.survival + d),
  champPool: r.champPool,
});

export interface WorldInput {
  players: Player[]; // 실제 2026 1군 (능력치·챔피언 풀은 2026 값)
  academy: Player[]; // 실제 2026 2군
  teams: TeamInfo[]; // 실제 2026 로스터 (첫 스토브리그 AI 목표, 세계 수준 기준선)
  champions: Champion[];
  params: Params;
  world: WorldTargets;
  start: Start2025; // 2025 시즌 끝 소속·계약·실제 이적
  seed: number;
  cp?: CareerParams; // 커리어 조절값 (없으면 기본값)
}

// 커리어 시작 = 2025 시즌이 끝난 스토브리그. 능력치는 2026 값 그대로라 첫 시즌(2026) 캘리브레이션이 유지된다.
// 계약이 끝난 선수(실제로 팀을 옮긴 선수)는 이번 스토브리그에 FA가 되고, 실제 2026 팀과 사전 합의한 상태다.
export function initWorld(input: WorldInput): WorldState {
  const cp = input.cp ?? DEFAULT_CAREER_PARAMS;
  const st = input.start;
  const rng = createRng(hashSeed(input.seed, "world-init"));
  const offset = (lg: string) => (lg === "LCKCL" ? input.world.academyOffset : (input.params.leagueOffset[lg] ?? 0));
  const players: Record<string, PlayerState> = {};
  const ctx = { macroWeight: input.params.macroWeight, cp, season: OPENING_SEASON };
  const pre: Record<string, PreAgreement> = {};
  const retire: string[] = [];
  const add = (p: Player, e: StartEntry) => {
    const age = p.age ?? 22;
    const ratings = shiftRatings(p.ratings, offset(p.ratingLeague));
    const base: PlayerState = {
      ...p,
      team: e.team ?? "",
      age,
      ratings,
      ratingLeague: "GLOBAL",
      potential: rollPotential(cp, ratings, age, rng),
      contract: null,
      academy: Boolean(e.team) && e.academy,
      virtual: false,
      faSeasons: 0,
      retired: false,
      careerTitles: [...e.titles],
      careerGames: e.careerGames,
      // 운영 기여: 진짜 값 = 데이터 추정치. 공개 추정치도 같고, 추정이 없는 선수(해외)는 '모름'(불확실성 큼)
      macroTrue: p.intangible,
      intangibleSe: p.intangibleKnown ? p.intangibleSe : cp.macro.newSd,
    };
    if (e.team) {
      const stays = e.team === e.dest;
      const end = e.contractEnd == null ? FIRST_SEASON + rng.int(2) : stays ? Math.max(FIRST_SEASON, e.contractEnd) : e.contractEnd;
      base.contract = { team: e.team, endSeason: end, salary: base.academy ? 0.3 : salaryDemand(ctx, base), role: e.starter ? "starter" : "bench", generated: e.contractEnd == null };
    }
    if (e.dest && e.dest !== e.team)
      pre[p.id] = { team: e.dest, academy: e.destAcademy, starter: e.destStarter, years: Math.min(3, Math.max(1, e.destYears ?? contractYears(age))) };
    if (e.retire) retire.push(p.id);
    players[p.id] = base;
  };
  for (const p of [...input.players, ...input.academy]) add(p, st.entries[p.id]);
  // 2025에만 뛴 선수: 2026엔 실제로 1부 리그 로스터에 없었다. 무소속 한 시즌을 이미 보낸 셈으로 둬서 이번에도 못 뛰면 은퇴
  for (const x of st.extra) {
    const { academy, dest, destAcademy, destStarter, destYears, retire: r, titles, careerGames, contractEnd, ageEstimated: _, ...p } = x;
    add({ ...p, contractEnd } as Player, { team: p.team || null, academy, starter: p.starter, contractEnd, dest, destAcademy, destStarter, destYears, retire: r, titles, careerGames });
    if (!r) players[p.id].faSeasons = 1;
  }

  // 실제 2026 로스터: 세계 수준 기준선, 연봉 상한(실제 영입이 상한 안에 들게), 첫 스토브리그 목표
  const realTeams: Record<string, TeamState> = {};
  const teams: Record<string, TeamState> = {};
  for (const t of input.teams) {
    const r = st.teams[t.id];
    const main2025 = [...POSITIONS.map((pos) => r.starters[pos]), ...r.bench].filter(Boolean);
    const main2026 = [...POSITIONS.map((pos) => t.starters[pos]), ...t.bench];
    const real = Math.round(main2026.reduce((sum, id) => sum + salaryDemand(ctx, players[id]), 0) * 10) / 10;
    const cap = Math.max(CAP_FLOOR[t.league] ?? 10, Math.ceil(Math.max(payroll(players, main2025), real) * 1.1));
    const state: TeamState = {
      id: t.id,
      name: t.name,
      league: t.league,
      starters: { ...r.starters },
      bench: [...r.bench],
      academy: [...r.academy],
      cap,
      transferBudget: Math.round(cap * 0.3),
      teamwork: input.params.teamwork[t.id] ?? 0,
      prestige: Math.round((r.winrate2025 ?? 0.4) * 100) / 100,
      seasonStarters: POSITIONS.map((pos) => r.starters[pos]).filter(Boolean),
      focus: [],
    };
    teams[t.id] = state;
    realTeams[t.id] = { ...state, starters: { ...t.starters }, bench: [...t.bench] };
  }
  const meta = Object.fromEntries(input.champions.map((c) => [c.id, c.meta]));
  const baseline = starterMeans(players, realTeams, input.params.macroWeight);
  const replacement = Object.fromEntries(Object.entries(baseline).map(([lg, m]) => [lg, Math.round((m - cp.replacement.gap) * 10) / 10]));
  const freeAgents = Object.values(players).filter((p) => !p.contract).map((p) => p.id);
  return {
    version: 1,
    seed: input.seed,
    season: OPENING_SEASON,
    players,
    teams,
    freeAgents,
    champMeta: { ...meta },
    baseMeta: meta,
    history: [{ ...st.history, places: {}, moves: [] }],
    lastGrowth: null,
    nextRookie: 1,
    replacement,
    baseline,
    macroWeight: input.params.macroWeight,
    cp,
    opening: {
      pre,
      retire,
      realStarters: Object.fromEntries(input.teams.map((t) => [t.id, { ...t.starters }])),
      tunedTeamwork: Object.fromEntries(input.teams.map((t) => [t.id, input.params.teamwork[t.id] ?? 0])),
    },
  };
}

// 리그별 주전 평균 '실효' 실력 = 경기 능력 평균 + 팀 운영 기여를 능력 점수로 바꾼 값.
// 운영 기여(팀 합 × macroWeight)는 팀 전투력에 바로 더해지는데, 전투력 1 = 주전 5명 능력 17점과 같다.
// LCK 선수에게만 운영 추정치가 있어서, 이걸 빼면 LCK 수준이 실제보다 낮게 잡히고 은퇴로 사라지는 몫을 못 메운다
export function starterMeans(players: Record<string, PlayerState>, teams: Record<string, TeamState>, macroWeight: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const lg of new Set(Object.values(teams).map((t) => t.league))) {
    const list = Object.values(teams).filter((t) => t.league === lg);
    let sum = 0;
    for (const t of list) {
      const ids = POSITIONS.map((pos) => t.starters[pos]).filter((id) => players[id]);
      const r = (id: string) => players[id].ratings;
      const ovr = ids.reduce((s, id) => s + (r(id).laning + r(id).teamfight + r(id).vision + r(id).survival) / 4, 0) / Math.max(1, ids.length);
      const macro = macroWeight * ids.reduce((s, id) => s + (players[id].macroTrue ?? players[id].intangible ?? 0), 0);
      sum += ovr + 17 * macro;
    }
    out[lg] = Math.round((sum / list.length) * 10) / 10;
  }
  return out;
}

// 세계 수준 유지: 리그 주전 평균이 2026보다 떨어지면 새로 들어오는 선수(대체 선수·유망주·신인) 수준을 올리고, 오르면 내린다
export function retuneReplacement(world: WorldState): WorldState {
  const now = starterMeans(world.players, world.teams, world.macroWeight);
  const r = world.cp.replacement;
  const replacement = Object.fromEntries(
    Object.entries(world.baseline).map(([lg, base]) => [lg, Math.round((base - r.gap + r.gain * Math.max(r.lo, Math.min(r.hi, base - (now[lg] ?? base)))) * 10) / 10]),
  );
  return { ...world, replacement };
}

export const mainRoster = (t: TeamState) => [...POSITIONS.map((pos) => t.starters[pos]), ...t.bench].filter(Boolean); // 빈 주전 자리("")는 뺀다

// 엔진이 쓰는 Universe: 챔피언 메타는 이번 시즌 값, 선수 챔피언 풀은 지난 기록 + 이번 시즌 출전
export function toUniverse(world: WorldState, base: Universe, stats?: SeasonStats): Universe {
  const champions = new Map([...base.champions].map(([id, c]) => [id, { ...c, meta: world.champMeta[id] ?? c.meta }]));
  const players = new Map<string, Player>();
  for (const p of Object.values(world.players)) {
    if (p.retired) continue;
    const extra = stats?.picks[p.id];
    const pool = extra ? { ...p.champions } : p.champions;
    if (extra) for (const [c, n] of Object.entries(extra)) pool[c] = (pool[c] ?? 0) + n;
    players.set(p.id, { ...p, champions: pool, team: p.contract?.team ?? "", intangible: p.macroTrue ?? p.intangible }); // 경기엔 진짜 운영 능력
  }
  const teams = new Map<string, TeamInfo>(
    Object.values(world.teams).map((t) => [t.id, { id: t.id, name: t.name, league: t.league, starters: { ...t.starters }, bench: [...t.bench] }]),
  );
  return { players, champions, teams, matchups: base.matchups };
}

// 엔진 조절값에 세계의 팀워크를 넣는다 (능력치는 이미 세계 공통이라 리그 보정은 0)
export function worldParams(world: WorldState, p: Params): Params {
  return { ...p, teamwork: Object.fromEntries(Object.values(world.teams).map((t) => [t.id, t.teamwork])), leagueOffset: {} };
}

// 로스터 불변식: 한 선수는 한 곳(1군·2군·FA)에만, 주전 5포지션, 계약 팀 일치, 1군 인원.
// 연봉 상한은 새 계약에만 걸린다 (성적이 나빠 상한이 줄어도 기존 계약은 유효) → overCapTeams로 따로 본다
export function validateWorld(world: WorldState): string[] {
  const errors: string[] = [];
  const where = new Map<string, string>();
  const place = (id: string, at: string) => {
    if (where.has(id)) errors.push(`${id}: ${where.get(id)} 와 ${at} 에 동시 소속`);
    where.set(id, at);
    if (!world.players[id]) errors.push(`${id}: 없는 선수 (${at})`);
    else if (world.players[id].retired) errors.push(`${id}: 은퇴 선수가 ${at} 에 있음`);
  };
  for (const t of Object.values(world.teams)) {
    for (const pos of POSITIONS) {
      const id = t.starters[pos];
      if (!id) errors.push(`${t.id}: ${pos} 주전 없음`);
      else if (world.players[id]?.position !== pos) errors.push(`${t.id}: ${pos} 주전 ${id} 포지션이 ${world.players[id]?.position}`);
    }
    const main = mainRoster(t);
    if (main.length > MAX_MAIN_ROSTER) errors.push(`${t.id}: 1군 ${main.length}명 (최대 ${MAX_MAIN_ROSTER})`);
    for (const id of main) place(id, `${t.id} 1군`);
    for (const id of t.academy) place(id, `${t.id} 2군`);
    for (const id of [...main, ...t.academy]) if (world.players[id]?.contract?.team !== t.id) errors.push(`${id}: 계약 팀이 ${world.players[id]?.contract?.team}인데 ${t.id} 소속`);
  }
  for (const id of world.freeAgents) {
    place(id, "FA");
    if (world.players[id]?.contract) errors.push(`${id}: FA인데 계약이 있음`);
  }
  for (const p of Object.values(world.players)) if (!p.retired && !where.has(p.id)) errors.push(`${p.id}: 어디에도 없음`);
  return errors;
}

export const overCapTeams = (world: WorldState) =>
  Object.values(world.teams).filter((t) => payroll(world.players, mainRoster(t)) > t.cap + 0.05).map((t) => t.id);
