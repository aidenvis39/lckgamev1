// 사용자 팀의 시장 행동: 재계약, FA 제안, 이적료 영입, 트레이드, 시즌 중 FA 계약, 로스터 관리.
// 결과는 항상 { world, ok, reason } 형태로 돌려줘서 화면이 거절 이유를 그대로 보여줄 수 있게 한다.
import type { Rng } from "../rng.ts";
import type { Position } from "../types.ts";
import { POSITIONS } from "../types.ts";
import {
  ACCEPT,
  ACCEPT_LAST,
  aiBuyouts,
  aiOffers,
  aiResign,
  canAfford,
  capRoom,
  completeBid,
  extend,
  offerUtility,
  playerAcceptsMove,
  release,
  resolveOffers,
  sellerVerdict,
  sign,
  type Bid,
  type Offer,
} from "./market.ts";
import type { PlayerState, WorldState } from "./types.ts";
import { effective, payroll, playerValue } from "./value.ts";
import { mainRoster, MAX_MAIN_ROSTER } from "./world.ts";

export interface Result {
  world: WorldState;
  ok: boolean;
  reason: string;
}
const fail = (world: WorldState, reason: string): Result => ({ world, ok: false, reason });
const round1 = (x: number) => Math.round(x * 10) / 10;

// 이 제안을 선수가 받아들일까 (화면 미리보기용). 스토브리그 마지막 라운드·시즌 중엔 기준이 낮다
export function acceptance(world: WorldState, o: Offer, last = false): { utility: number; need: number; likely: boolean } {
  const u = offerUtility(world, world.players[o.player], o);
  const need = last ? ACCEPT_LAST : ACCEPT;
  return { utility: Math.round(u * 100) / 100, need, likely: u >= need };
}

// ── 재계약 (스토브리그 첫 단계) ──────────────────────
// AI 팀은 요구 연봉 그대로 재계약한다. 사용자 재계약은 명성·주전·같은 지역·원소속 우대만큼 조금 깎을 수 있다
// (명성 높은 팀 주전 ≈ 요구의 80%, 보통 팀 주전 ≈ 90%, 후보는 요구 이상)
const RESIGN_ACCEPT = ACCEPT + 0.4;

export function resignMine(world: WorldState, id: string, salary: number, years: number): Result {
  const p = world.players[id];
  const team = p.contract?.team;
  if (!team) return fail(world, "계약이 없는 선수");
  if (!p.academy && salary > capRoom(world, team, [id]) + 0.05) return fail(world, `연봉 상한 초과 (여유 ${capRoom(world, team, [id])}C)`);
  const role = world.teams[team].starters[p.position] === id ? "starter" : "bench";
  const u = offerUtility(world, p, { team, player: id, salary, years, role });
  if (u < RESIGN_ACCEPT) return fail(world, `선수가 거절 (연봉 ${salaryNeeded(world, p, team, role)}C 이상이면 남음)`);
  return { world: extend(world, id, salary, years), ok: true, reason: "" };
}

// 재계약에 필요한 최소 연봉 (효용 기준을 넘기는 연봉)
export function salaryNeeded(world: WorldState, p: PlayerState, team: string, role: "starter" | "bench"): number {
  for (let s = 0.3; s <= 20; s += 0.1) if (offerUtility(world, p, { team, player: p.id, salary: s, years: 1, role }) >= RESIGN_ACCEPT) return round1(s);
  return 20;
}

// ── 시장 진행 ─────────────────────────────────────────
// 스토브리그 시장 시작: AI 팀 재계약 + AI 이적료 영입 (사용자 팀 계약 끝난 선수 중 재계약 안 한 선수는 FA로)
export function openMarket(world: WorldState, expiring: Record<string, string[]>, userTeam: string, rng: Rng): WorldState {
  let w = world;
  for (const id of expiring[userTeam] ?? []) if ((w.players[id].contract?.endSeason ?? 0) <= w.season) w = release(w, id);
  for (const teamId of Object.keys(w.teams)) if (teamId !== userTeam) w = aiResign(w, teamId, expiring[teamId] ?? [], rng);
  return aiBuyouts(w, rng, userTeam).world;
}

// FA 라운드 하나: AI 제안 + 사용자 제안을 모아 선수들이 고른다
export function marketRound(world: WorldState, userTeam: string, userOffers: Offer[], last: boolean, rng: Rng): { world: WorldState; signed: Offer[] } {
  const offers = [...Object.keys(world.teams).filter((id) => id !== userTeam).flatMap((id) => aiOffers(world, id, rng)), ...userOffers];
  return resolveOffers(world, offers, last);
}

// 사용자 FA 제안 검사 (라운드 끝에 처리됨)
export function checkOffer(world: WorldState, o: Offer, pending: Offer[]): { ok: boolean; reason: string } {
  const p = world.players[o.player];
  if (!world.freeAgents.includes(o.player)) return { ok: false, reason: "FA가 아님" };
  if (o.academy) return world.teams[o.team].league === "LCK" ? { ok: true, reason: "" } : { ok: false, reason: "2군은 LCK 팀만" }; // 2군 계약은 1군 인원·상한 밖
  const committed = pending.filter((x) => x.team === o.team && x.player !== o.player).reduce((s, x) => s + x.salary, 0);
  if (o.salary + committed > capRoom(world, o.team) + 0.05) return { ok: false, reason: `연봉 상한 초과 (여유 ${round1(capRoom(world, o.team) - committed)}C)` };
  if (mainRoster(world.teams[o.team]).length + pending.filter((x) => x.team === o.team && x.player !== o.player).length >= MAX_MAIN_ROSTER)
    return { ok: false, reason: `1군 최대 ${MAX_MAIN_ROSTER}명` };
  if (o.years < 1 || o.years > 3) return { ok: false, reason: "계약 기간은 1~3년" };
  return { ok: true, reason: p ? "" : "없는 선수" };
}

// 시즌 중 FA 즉시 계약 (이적 창이 아니어도 가능)
export function signNow(world: WorldState, o: Offer): Result {
  const c = checkOffer(world, o, []);
  if (!c.ok) return fail(world, c.reason);
  if (!acceptance(world, o, true).likely) return fail(world, "선수가 거절 (연봉을 올려 봐)");
  return { world: sign(world, o), ok: true, reason: "" };
}

// ── 이적료 영입 ───────────────────────────────────────
export function bidFor(world: WorldState, bid: Bid): Result {
  const p = world.players[bid.player];
  if (!p?.contract) return fail(world, "계약 중인 선수가 아님 (FA는 제안으로)");
  if (p.contract.team === bid.team) return fail(world, "이미 우리 선수");
  if (p.academy) return fail(world, "2군 선수는 데려올 수 없음");
  const a = canAfford(world, bid);
  if (!a.ok) return fail(world, a.reason);
  const s = sellerVerdict(world, bid);
  if (!s.ok) return fail(world, `${p.contract.team} 거절: ${s.reason}`);
  if (!playerAcceptsMove(world, bid)) return fail(world, `${p.name} 거절: 지금 계약보다 나은 조건이어야 함 (연봉을 올려 봐)`);
  return { world: completeBid(world, bid), ok: true, reason: "" };
}

// ── 트레이드 ──────────────────────────────────────────
export interface TradeProposal {
  from: string; // 사용자 팀
  to: string; // 상대 AI 팀
  give: string[]; // 우리가 주는 선수
  get: string[]; // 받는 선수
  fee: number; // 우리가 더 얹는 이적료 (받으면 음수)
}

const coversAll = (world: WorldState, teamId: string, out: string[], inc: string[]) => {
  const t = world.teams[teamId];
  const ids = [...mainRoster(t), ...t.academy].filter((id) => !out.includes(id)).concat(inc);
  return POSITIONS.filter((pos) => !ids.some((id) => world.players[id].position === pos));
};

// 팀이 낼 수 있는 가장 강한 주전 5명의 평균 실력 (포지션별 최고)
function bestLineup(world: WorldState, ids: string[]): number {
  return (
    POSITIONS.reduce((s, pos) => s + Math.max(0, ...ids.filter((id) => world.players[id].position === pos).map((id) => effective(world, world.players[id]))), 0) /
    POSITIONS.length
  );
}

export function evaluateTrade(world: WorldState, tp: TradeProposal): { ok: boolean; reason: string; valueIn: number; valueOut: number } {
  const v = (ids: string[]) => Math.round(ids.reduce((s, id) => s + playerValue(world, world.players[id]), 0) * 10) / 10;
  // 상대 팀 입장: 주전 전력이 약해지면 그만큼 더 받아야 한다 (평균 1점 = 가치 2)
  const theirs = [...mainRoster(world.teams[tp.to]), ...world.teams[tp.to].academy];
  const after = theirs.filter((id) => !tp.get.includes(id)).concat(tp.give);
  const drop = Math.max(0, bestLineup(world, theirs) - bestLineup(world, after));
  const valueIn = round1(v(tp.give) + 0.6 * tp.fee);
  const valueOut = round1(v(tp.get) + 2 * drop);
  const res = (ok: boolean, reason: string) => ({ ok, reason, valueIn, valueOut });
  if (!tp.give.length && !tp.get.length) return res(false, "선수를 골라야 함");
  if (tp.give.some((id) => world.players[id].contract?.team !== tp.from || world.players[id].academy)) return res(false, "우리 1군 선수만 줄 수 있음");
  if (tp.get.some((id) => world.players[id].contract?.team !== tp.to || world.players[id].academy)) return res(false, "상대 1군 선수만 받을 수 있음");
  if (tp.fee > world.teams[tp.from].transferBudget + 0.05) return res(false, `이적 예산 부족 (남은 ${world.teams[tp.from].transferBudget}C)`);
  if (tp.fee < 0 && -tp.fee > world.teams[tp.to].transferBudget + 0.05) return res(false, `${tp.to} 이적 예산 부족`);
  for (const [team, out, inc] of [[tp.from, tp.give, tp.get], [tp.to, tp.get, tp.give]] as const) {
    const gap = coversAll(world, team, out, inc);
    if (gap.length) return res(false, `${team} ${gap.join("·")} 공백`);
    const t = world.teams[team];
    if (mainRoster(t).length - out.length + inc.length > MAX_MAIN_ROSTER) return res(false, `${team} 1군 ${MAX_MAIN_ROSTER}명 초과`);
    const payBefore = payroll(world.players, mainRoster(t));
    const payAfter = round1(payBefore - payroll(world.players, out) + payroll(world.players, inc));
    if (payAfter > t.cap + 0.05 && payAfter > payBefore) return res(false, `${team} 연봉 상한 초과 (${payAfter}/${t.cap}C)`);
  }
  if (valueIn < valueOut * 1.05) return res(false, `${tp.to} 거절: 가치 ${round1(valueOut * 1.05 - valueIn)} 부족 (받는 쪽 ${valueIn} / 주는 쪽 ${valueOut})`);
  return res(true, "");
}

// 선수 맞바꾸기: 계약(연봉·기간)은 그대로 팀만 바뀐다. 빈 주전 자리는 같은 포지션으로 채운다
export function applyTrade(world: WorldState, tp: TradeProposal): Result {
  const e = evaluateTrade(world, tp);
  if (!e.ok) return fail(world, e.reason);
  let w = world;
  const move = (id: string, to: string) => {
    const p = w.players[id];
    const contract = p.contract!;
    w = release(w, id);
    w = sign(w, { team: to, player: id, salary: contract.salary, years: Math.max(1, contract.endSeason - w.season), role: "bench" });
    w = { ...w, players: { ...w.players, [id]: { ...w.players[id], contract: { ...contract, team: to } } } };
  };
  for (const id of tp.give) move(id, tp.to);
  for (const id of tp.get) move(id, tp.from);
  w = {
    ...w,
    teams: {
      ...w.teams,
      [tp.from]: { ...w.teams[tp.from], transferBudget: round1(w.teams[tp.from].transferBudget - tp.fee) },
      [tp.to]: { ...w.teams[tp.to], transferBudget: round1(w.teams[tp.to].transferBudget + tp.fee) },
    },
  };
  w = fillStarters(w, tp.from);
  w = fillStarters(w, tp.to);
  return { world: w, ok: true, reason: "" };
}

// 빈 주전 자리를 1군 후보 → 2군 순으로 가장 잘하는 같은 포지션 선수로 채운다
export function fillStarters(world: WorldState, teamId: string): WorldState {
  let w = world;
  for (const pos of POSITIONS) {
    const t = w.teams[teamId];
    if (t.starters[pos]) continue;
    const pick = [...t.bench, ...t.academy]
      .filter((id) => w.players[id].position === pos)
      .sort((a, b) => playerValue(w, w.players[b]) - playerValue(w, w.players[a]))[0];
    if (!pick) continue;
    w = setStarter(w, teamId, pos, pick).world;
  }
  return w;
}

// ── 로스터 관리 ───────────────────────────────────────
export function setStarter(world: WorldState, teamId: string, pos: Position, id: string): Result {
  const t = world.teams[teamId];
  const p = world.players[id];
  if (p.position !== pos) return fail(world, "포지션이 다름");
  if (![...t.bench, ...t.academy, t.starters[pos]].includes(id)) return fail(world, "우리 팀 선수가 아님");
  if (t.starters[pos] === id) return { world, ok: true, reason: "" };
  const fromAcademy = t.academy.includes(id);
  if (fromAcademy && mainRoster(t).length >= MAX_MAIN_ROSTER && !t.starters[pos]) return fail(world, `1군 최대 ${MAX_MAIN_ROSTER}명`);
  const cur = t.starters[pos];
  const bench = [...t.bench.filter((x) => x !== id), ...(cur ? [cur] : [])];
  if (fromAcademy && bench.length + 5 > MAX_MAIN_ROSTER) return fail(world, `1군 최대 ${MAX_MAIN_ROSTER}명 (후보를 2군으로 내려야 함)`);
  const salary = fromAcademy ? Math.max(p.contract!.salary, 0.6) : p.contract!.salary;
  if (fromAcademy && salary - p.contract!.salary > capRoom(world, teamId) + 0.05) return fail(world, "연봉 상한 초과");
  const w: WorldState = {
    ...world,
    teams: { ...world.teams, [teamId]: { ...t, starters: { ...t.starters, [pos]: id }, bench, academy: t.academy.filter((x) => x !== id) } },
    players: { ...world.players, [id]: { ...p, academy: false, contract: { ...p.contract!, salary, role: "starter" } } },
  };
  return { world: w, ok: true, reason: "" };
}

// 2군 ↔ 1군 후보
export function promote(world: WorldState, teamId: string, id: string): Result {
  const t = world.teams[teamId];
  if (!t.academy.includes(id)) return fail(world, "2군 선수가 아님");
  if (mainRoster(t).length >= MAX_MAIN_ROSTER) return fail(world, `1군 최대 ${MAX_MAIN_ROSTER}명`);
  const p = world.players[id];
  const salary = Math.max(p.contract!.salary, 0.6);
  if (salary - p.contract!.salary > capRoom(world, teamId) + 0.05) return fail(world, "연봉 상한 초과");
  return {
    world: {
      ...world,
      teams: { ...world.teams, [teamId]: { ...t, bench: [...t.bench, id], academy: t.academy.filter((x) => x !== id) } },
      players: { ...world.players, [id]: { ...p, academy: false, contract: { ...p.contract!, salary, role: "bench" } } },
    },
    ok: true,
    reason: "",
  };
}

export function demote(world: WorldState, teamId: string, id: string): Result {
  const t = world.teams[teamId];
  if (t.league !== "LCK") return fail(world, "2군은 LCK 팀만");
  if (!t.bench.includes(id)) return fail(world, "1군 후보만 내릴 수 있음 (주전은 먼저 바꿔야 함)");
  return {
    world: {
      ...world,
      teams: { ...world.teams, [teamId]: { ...t, bench: t.bench.filter((x) => x !== id), academy: [...t.academy, id] } },
      players: { ...world.players, [id]: { ...world.players[id], academy: true } },
    },
    ok: true,
    reason: "",
  };
}

export function releaseMine(world: WorldState, teamId: string, id: string): Result {
  const t = world.teams[teamId];
  if (POSITIONS.some((pos) => t.starters[pos] === id)) return fail(world, "주전은 방출할 수 없음 (먼저 다른 선수를 주전으로)");
  if (![...t.bench, ...t.academy].includes(id)) return fail(world, "우리 선수가 아님");
  return { world: release(world, id), ok: true, reason: "" };
}

export function toggleFocus(world: WorldState, teamId: string, id: string): Result {
  const t = world.teams[teamId];
  const on = t.focus.includes(id);
  if (!on && t.focus.length >= 2) return fail(world, "집중 육성은 2명까지");
  if (![...mainRoster(t), ...t.academy].includes(id)) return fail(world, "우리 선수가 아님");
  const focus = on ? t.focus.filter((x) => x !== id) : [...t.focus, id];
  return { world: { ...world, teams: { ...world.teams, [teamId]: { ...t, focus } } }, ok: true, reason: "" };
}

// 등록 마감 검사: 주전 5명, 1군 인원
export function registrationIssues(world: WorldState, teamId: string): string[] {
  const t = world.teams[teamId];
  const out: string[] = [];
  for (const pos of POSITIONS) if (!t.starters[pos]) out.push(`${pos} 주전 없음`);
  if (mainRoster(t).length > MAX_MAIN_ROSTER) out.push(`1군 ${mainRoster(t).length}명 (최대 ${MAX_MAIN_ROSTER})`);
  return out;
}
