// 커리어 상태 (v3, 여러 시즌). 선수·팀·계약은 엔진 WorldState, 한 해 대진·순위·출전권은 YearState가 맡고,
// 여기선 내 팀·세트 기록·진행 중 시리즈·성장 리포트·스토브리그 진행을 더한다.
// 한 해: LCK 1~2라운드 → Road to MSI → MSI → LCK 3~4라운드 → LCK 플레이인·플레이오프 → 월즈 → 스토브리그 → 다음 해
import {
  acceptance,
  applyTrade,
  baseUniverse,
  beginOffseason,
  bidFor,
  capRoom,
  checkOffer,
  choose,
  cloneStats,
  closeSeason,
  createRng,
  crossedCheckpoints,
  developAt,
  emptyStats,
  endDay,
  fillStarters,
  finishOffseason,
  goalsFor,
  hashSeed,
  mainRoster,
  makeRookie,
  MAX_MAIN_ROSTER,
  marketRound,
  newWorld,
  newYearFor,
  openMarket,
  OVERSEAS,
  overall,
  params,
  pendingChoice,
  phaseName,
  positionTop,
  POSITIONS,
  recordResult,
  recordSeries,
  registrationIssues,
  resignMine,
  seedPool,
  setStarter,
  signNow,
  simulateMatch,
  todayMatches,
  toUniverse,
  worldParams,
  type Ability,
  type Bid,
  type DraftResult,
  type GameResult,
  type Goal,
  type Match,
  type Offer,
  type Params,
  type Position,
  type Result,
  type SeasonStats,
  type SeriesResult,
  type Side,
  type TradeProposal,
  type Universe,
  type WorldState,
  type YearState,
} from "../engine.ts";

export interface GameRecord {
  blue: string;
  red: string;
  winner: string; // 팀 약칭
  duration: number;
  kills: [number, number]; // [블루, 레드]
  gd15: number; // 블루 기준
  picks: Record<Side, Record<Position, string>>;
}

// LCK·국제대회 시리즈의 세트 기록 (해외 리그 경기는 점수만 남긴다)
export interface SeriesRecord {
  games: GameRecord[];
  auto?: boolean; // 내 경기를 AI에게 맡겼는지
}

// 진행 중인 내 시리즈. 세트가 끝날 때마다 저장해서 나갔다 와도 이어서 한다
export interface PlayedGame {
  blue: string;
  red: string;
  draft: DraftResult;
  result: GameResult;
}
export interface SeriesProgress {
  matchId: string;
  games: PlayedGame[];
  next: { blue: string; red: string } | null; // null이면 진 팀이 진영을 골라야 함
}

// 성장 시점 하나에서 내 팀 선수 변화 (홈 성장 리포트)
export interface GrowthNote {
  season: number;
  checkpoint: string;
  label: string;
  changes: Record<string, Partial<Record<Ability, number>>>;
}

// 스토브리그: 결산 → 재계약 → FA 시장(4라운드, 이적료 영입·트레이드 가능) → 등록 → 새 시즌
export type OffseasonStage = "review" | "resign" | "market" | "register";
export interface Offseason {
  stage: OffseasonStage;
  expiring: Record<string, string[]>; // 팀 → 이번에 계약 끝나는 선수
  round: number; // FA 라운드 (0부터)
  offers: Offer[]; // 이번 라운드에 넣은 내 FA 제안
  log: string[]; // 시장 소식 (최근이 앞)
  retired: string[]; // 이번에 은퇴한 내 팀 선수
}
export const FA_ROUNDS = 4;

export interface Career {
  version: 3;
  teamId: string;
  seed: number;
  world: WorldState;
  year: YearState;
  stats: SeasonStats; // 이번 시즌 출전 기록 (성장 출전 비율·챔피언 풀)
  records: Record<string, SeriesRecord>;
  progress: SeriesProgress | null;
  goals: Goal[]; // 구단주 목표 (시즌 시작 때 정해짐)
  growth: GrowthNote[]; // 이번 시즌 내 팀 성장 기록
  growthSeen: number; // 홈에서 확인한 성장 리포트 수
  offseason: Offseason | null;
}

const DETAILED = new Set(["LCK", "RTM", "MSI", "LCKPO", "WORLDS"]);
export const isOverseasLeague = (m: Match) => OVERSEAS.includes(m.event);

export function newCareer(teamId: string, seed = Math.floor(Math.random() * 1e9)): Career {
  const world = newWorld(seed);
  return {
    version: 3,
    teamId,
    seed,
    world,
    year: newYearFor(world, teamId),
    stats: emptyStats(),
    records: {},
    progress: null,
    goals: goalsFor(world, teamId),
    growth: [],
    growthSeen: 0,
    offseason: null,
  };
}

// 화면 여러 곳에서 같은 세계로 Universe를 만들어서 마지막 것을 기억해 둔다
let cached: { world: WorldState; stats: SeasonStats; u: Universe; p: Params } | null = null;
function built(c: Career) {
  if (!cached || cached.world !== c.world || cached.stats !== c.stats)
    cached = { world: c.world, stats: c.stats, u: toUniverse(c.world, baseUniverse, c.stats), p: worldParams(c.world, params) };
  return cached;
}
export const universeFor = (c: Career): Universe => built(c).u;
export const paramsFor = (c: Career): Params => built(c).p; // 세계의 팀워크가 들어간 엔진 조절값

export const seasonOf = (c: Career) => c.world.season;
export const isMine = (c: Career, m: Match) => m.home === c.teamId || m.away === c.teamId;
export const today = (c: Career) => todayMatches(c.year);
export const myMatchToday = (c: Career) => today(c).find((m) => isMine(c, m) && !c.year.results[m.id]) ?? null;
export const myPendingChoice = (c: Career) => pendingChoice(c.year);
export const seasonOver = (c: Career) => c.year.phase === "DONE";
// 경기 난수는 (그 해 시드, 경기 id)로 고정. 해마다 경기 id가 같아도 시드가 달라 다른 경기가 된다
export const seriesRng = (c: Career, m: Match, salt = "") => createRng(hashSeed(c.year.seed, m.id, salt));
export const myTeam = (c: Career) => c.world.teams[c.teamId];
export const myPlayers = (c: Career) => [...mainRoster(myTeam(c)), ...myTeam(c).academy];

// "LCK 1~2라운드 3일차", "MSI 브래킷 2일차" 같은 오늘 이름
export function dayLabel(c: Career): string {
  const y = c.year;
  if (c.offseason) return `${seasonOf(c)} 스토브리그`;
  if (y.phase === "DONE") return `${seasonOf(c)} 시즌 종료`;
  const start = y.phaseStart[y.phase] ?? y.day;
  return `${phaseName(y.phase)} ${y.day - start + 1}일차`;
}

export const matchById = (c: Career, id: string) => c.year.matches.find((m) => m.id === id) ?? null;

function toRecord(games: PlayedGame[], auto = false): SeriesRecord {
  return {
    auto,
    games: games.map((g) => ({
      blue: g.blue,
      red: g.red,
      winner: g.result.winner === "blue" ? g.blue : g.red,
      duration: g.result.duration,
      kills: [g.result.kills.blue, g.result.kills.red],
      gd15: g.result.gd15,
      picks: g.draft.picks,
    })),
  };
}

// 성장 시점을 지나면 세계 전체가 크고, 내 팀 변화만 리포트로 남긴다 (세계의 전체 변화 기록은 저장 용량 때문에 버림)
function grow(c: Career, world: WorldState, prev: YearState, next: YearState, stats: SeasonStats): { world: WorldState; growth: GrowthNote[] } {
  let w = world;
  const growth = [...c.growth];
  for (const cp of crossedCheckpoints(prev, next)) {
    w = developAt(w, cp, stats, next);
    const note = noteFor(w, c.teamId);
    if (note) growth.push(note);
    w = { ...w, lastGrowth: null };
  }
  return { world: w, growth };
}

function noteFor(w: WorldState, teamId: string): GrowthNote | null {
  const g = w.lastGrowth;
  if (!g) return null;
  const t = w.teams[teamId];
  const ids = [...mainRoster(t), ...t.academy];
  const changes = Object.fromEntries(ids.filter((id) => g.changes[id] && Object.keys(g.changes[id]).length).map((id) => [id, g.changes[id]]));
  return Object.keys(changes).length ? { season: g.season, checkpoint: g.checkpoint, label: g.label, changes } : null;
}

// 직접 치른 내 시리즈 결과를 넣는다
export function recordMine(c: Career, matchId: string, games: PlayedGame[]): Career {
  const m = matchById(c, matchId)!;
  const score: [number, number] = [0, 0];
  for (const g of games) score[(g.result.winner === "blue" ? g.blue : g.red) === m.home ? 0 : 1]++;
  const winner = score[0] > score[1] ? m.home : m.away;
  const stats = cloneStats(c.stats);
  recordSeries(stats, universeFor(c), { games } as unknown as SeriesResult);
  return {
    ...c,
    stats,
    year: recordResult(c.year, m.id, { winner, score }),
    records: { ...c.records, [m.id]: toRecord(games) },
    progress: null,
  };
}

// 오늘 남은 경기를 모두 시뮬하고 다음 날로. 내 경기가 남아 있으면 AI가 대신 치른다. 성장 시점을 지나면 성장
export function finishDay(c: Career): Career {
  const u = universeFor(c);
  const p = paramsFor(c);
  const stats = cloneStats(c.stats);
  let year = c.year;
  const records = { ...c.records };
  for (const m of todayMatches(year)) {
    if (year.results[m.id]) continue;
    const r = simulateMatch(u, p, year.seed, m);
    year = recordResult(year, m.id, r.outcome);
    recordSeries(stats, u, r.series);
    if (DETAILED.has(m.event)) records[m.id] = toRecord(r.series.games, isMine(c, m));
  }
  const next = endDay(year);
  const { world, growth } = grow(c, c.world, year, next, stats);
  const progress = c.progress && next.results[c.progress.matchId] ? null : c.progress;
  return { ...c, world, growth, stats, year: next, records, progress };
}

// 내 경기·내 지목 차례·내 팀 성장이 올 때까지 (또는 시즌 끝까지) 하루씩 넘긴다
export function advanceToMine(c: Career, limit = 200): Career {
  let next = c;
  for (let i = 0; i < limit && !seasonOver(next); i++) {
    next = finishDay(next);
    if (myMatchToday(next) || myPendingChoice(next) || next.growth.length > c.growth.length) break;
  }
  return next;
}

// 플레이오프에서 내 팀이 상대를 지목
export function pickOpponent(c: Career, id: string, team: string): Career {
  return { ...c, year: choose(c.year, id, team) };
}

export function saveProgress(c: Career, progress: SeriesProgress | null): Career {
  return { ...c, progress };
}

export const markGrowthSeen = (c: Career): Career => ({ ...c, growthSeen: c.growth.length });

// ── 세계를 바꾸는 행동 (로스터·시장) ──────────────────
export interface Outcome {
  career: Career;
  ok: boolean;
  reason: string;
}
const withWorld = (c: Career, r: Result): Outcome => ({ career: r.ok ? { ...c, world: r.world } : c, ok: r.ok, reason: r.reason });
const refuse = (c: Career, reason: string): Outcome => ({ career: c, ok: false, reason });

// 이적 창: 스토브리그 시장·등록 단계, 시즌 중엔 Road to MSI~MSI 기간. FA는 시즌 중 언제든 바로 계약
export type Window = { fa: "offer" | "now" | null; transfers: boolean; label: string };
const MIDSEASON = new Set(["RTM", "MSI_PI", "MSI_BR"]);
export function marketWindow(c: Career): Window {
  const o = c.offseason;
  if (o?.stage === "market") return { fa: "offer", transfers: true, label: `스토브리그 FA ${o.round + 1}/${FA_ROUNDS}라운드` };
  if (o?.stage === "register") return { fa: "now", transfers: true, label: "스토브리그 등록 기간" };
  if (o) return { fa: null, transfers: false, label: "재계약을 마치고 시장을 열면 영입할 수 있음" };
  if (seasonOver(c)) return { fa: null, transfers: false, label: "스토브리그를 시작하면 시장이 열림" };
  if (MIDSEASON.has(c.year.phase)) return { fa: "now", transfers: true, label: "시즌 중 이적 창 (Road to MSI~MSI)" };
  return { fa: "now", transfers: false, label: "이적 창은 Road to MSI~MSI 기간과 스토브리그. FA는 지금도 계약 가능" };
}

export function signFreeAgent(c: Career, o: Offer): Outcome {
  if (marketWindow(c).fa !== "now") return refuse(c, "지금은 바로 계약할 수 없음");
  const r = withWorld(c, signNow(c.world, o));
  return r.ok ? { ...r, career: log(r.career, `${name(c, o.player)} FA 계약 (${o.salary}C · ${o.years}년)`) } : r;
}

export function placeBid(c: Career, bid: Bid): Outcome {
  if (!marketWindow(c).transfers) return refuse(c, "이적 창이 닫혀 있음");
  const from = c.world.players[bid.player]?.contract?.team ?? "";
  const r = withWorld(c, bidFor(c.world, bid));
  return r.ok ? { ...r, career: log(r.career, `${name(c, bid.player)} 영입 (${from}에 이적료 ${bid.fee}C)`) } : r;
}

export function proposeTrade(c: Career, tp: TradeProposal): Outcome {
  if (!marketWindow(c).transfers) return refuse(c, "이적 창이 닫혀 있음");
  const r = withWorld(c, applyTrade(c.world, tp));
  const names = (ids: string[]) => ids.map((id) => name(c, id)).join("·") || "없음";
  return r.ok ? { ...r, career: log(r.career, `${tp.to}와 트레이드: ${names(tp.give)} ↔ ${names(tp.get)}${tp.fee ? ` (+${tp.fee}C)` : ""}`) } : r;
}

// 로스터 화면 행동 (setStarter·promote·demote·releaseMine·toggleFocus)을 그대로 감싼다
export const rosterAction = (c: Career, fn: (w: WorldState) => Result): Outcome => withWorld(c, fn(c.world));

const name = (c: Career, id: string) => c.world.players[id]?.name ?? id;
function log(c: Career, line: string): Career {
  return c.offseason ? { ...c, offseason: { ...c.offseason, log: [line, ...c.offseason.log].slice(0, 80) } } : c;
}

// 다른 팀 주요 이동 (LCK가 끼었거나 실력 75 이상)
function movesBetween(before: WorldState, after: WorldState, skip: string): string[] {
  const out: Array<[number, string]> = [];
  for (const p of Object.values(after.players)) {
    const old = before.players[p.id];
    const from = old?.contract?.team ?? null;
    const to = p.contract?.team ?? null;
    if (!to || from === to || to === skip) continue;
    const lck = after.teams[to]?.league === "LCK" || (from && after.teams[from]?.league === "LCK");
    const ovr = overall(p.ratings);
    if (!lck && ovr < 75) continue;
    out.push([ovr, `${p.name}: ${from ?? "FA"} → ${to}`]);
  }
  return out.sort((a, b) => b[0] - a[0]).map(([, s]) => s);
}

// ── 스토브리그 ────────────────────────────────────────
const offRng = (c: Career, salt: string | number) => createRng(hashSeed(c.world.seed, c.world.season, "user-market", salt));

// 월즈가 끝나면: 시즌 기록·구단주 평가 → 시즌 끝 성장·노쇠·은퇴·2군 신인 → 계약 끝나는 선수 목록
export function startOffseason(c: Career): Career {
  if (!seasonOver(c) || c.offseason) return c;
  const closed = closeSeason(c.world, c.year, { team: c.teamId, goals: c.goals });
  const mine = myPlayers(c);
  const { world, expiring } = beginOffseason(closed, c.stats, baseUniverse.champions);
  const note = noteFor(world, c.teamId);
  const retired = mine.filter((id) => world.players[id].retired);
  return {
    ...c,
    world: { ...world, lastGrowth: null },
    growth: note ? [...c.growth, note] : c.growth,
    offseason: { stage: "review", expiring, round: 0, offers: [], log: [], retired },
  };
}

// 재계약할 수 있는 내 선수 (계약이 이번 시즌에 끝나고 아직 팀에 있음)
export function myExpiring(c: Career): string[] {
  const o = c.offseason;
  if (!o) return [];
  const ids = new Set(myPlayers(c));
  return (o.expiring[c.teamId] ?? []).filter((id) => ids.has(id) && (c.world.players[id].contract?.endSeason ?? 0) <= c.world.season);
}

export function toResign(c: Career): Career {
  return c.offseason?.stage === "review" ? { ...c, offseason: { ...c.offseason, stage: "resign" } } : c;
}

export function resign(c: Career, id: string, salary: number, years: number): Outcome {
  const r = withWorld(c, resignMine(c.world, id, salary, years));
  return r.ok ? { ...r, career: log(r.career, `${name(c, id)} 재계약 (${salary}C · ${years}년)`) } : r;
}

// 재계약 안 한 내 선수는 FA로, AI 팀 재계약·이적료 영입이 끝나고 FA 1라운드 시작
export function openStoveMarket(c: Career): Career {
  const o = c.offseason;
  if (o?.stage !== "resign") return c;
  const leaving = myExpiring(c);
  const world = openMarket(c.world, o.expiring, c.teamId, offRng(c, "open"));
  const lines = [...movesBetween(c.world, world, c.teamId), ...leaving.map((id) => `${name(c, id)} 계약 만료로 FA`)];
  return { ...c, world, offseason: { ...o, stage: "market", log: [...lines.reverse(), ...o.log] } };
}

// 이번 라운드 FA 제안 넣기·빼기 (라운드를 진행할 때 선수들이 고른다)
export function addOffer(c: Career, offer: Offer): Outcome {
  const o = c.offseason;
  if (o?.stage !== "market") return refuse(c, "FA 제안은 스토브리그 시장에서");
  const check = checkOffer(c.world, offer, o.offers);
  if (!check.ok) return refuse(c, check.reason);
  const offers = [...o.offers.filter((x) => x.player !== offer.player), offer];
  return { career: { ...c, offseason: { ...o, offers } }, ok: true, reason: "" };
}
export function removeOffer(c: Career, player: string): Career {
  const o = c.offseason;
  return o ? { ...c, offseason: { ...o, offers: o.offers.filter((x) => x.player !== player) } } : c;
}

export function playMarketRound(c: Career): Career {
  const o = c.offseason;
  if (o?.stage !== "market") return c;
  const last = o.round === FA_ROUNDS - 1;
  const res = marketRound(c.world, c.teamId, o.offers, last, offRng(c, o.round));
  const lines: string[] = [];
  for (const offer of o.offers) {
    const p = res.world.players[offer.player];
    const to = p.contract?.team;
    lines.push(to === c.teamId ? `✔ ${p.name} 영입 (${offer.salary}C · ${offer.years}년)` : to ? `✘ ${p.name}: ${to} 선택` : `✘ ${p.name}: 제안 거절 (다음 라운드에 다시)`);
  }
  lines.push(...movesBetween(c.world, res.world, c.teamId));
  const round = o.round + 1;
  const header = `── FA ${round}라운드 ──`;
  return {
    ...c,
    world: res.world,
    offseason: { ...o, round, offers: [], stage: round >= FA_ROUNDS ? "register" : "market", log: [header, ...lines, ...o.log].slice(0, 120) },
  };
}

// 남은 라운드를 내 제안 없이 끝까지
export function finishMarket(c: Career): Career {
  let next = c;
  while (next.offseason?.stage === "market") next = playMarketRound(next);
  return next;
}

export const rosterIssues = (c: Career) => registrationIssues(c.world, c.teamId);

// 빈 주전 자리 자동 채우기: 1군 후보·2군에서 먼저, 없으면 남은 FA 중 연봉 상한 안에서 올 선수 가운데 가장 잘하는 선수,
// 그것도 없으면 AI 팀처럼 하부 리그 대체 선수(가상)를 최저 연봉으로 데려온다
export function autoFill(c: Career): Outcome {
  let w = fillStarters(c.world, c.teamId);
  const signed: string[] = [];
  for (const pos of POSITIONS) {
    if (w.teams[c.teamId].starters[pos]) continue;
    const room = capRoom(w, c.teamId);
    const cands = w.freeAgents
      .map((id) => w.players[id])
      .filter((p) => p.position === pos)
      .sort((a, b) => overall(b.ratings) - overall(a.ratings));
    for (const p of cands) {
      let offer: Offer | null = null;
      for (let s = 0.3; s <= room + 0.001 && !offer; s = Math.round((s + 0.1) * 10) / 10) {
        const o: Offer = { team: c.teamId, player: p.id, salary: s, years: 1, role: "starter" };
        if (acceptance(w, o, true).likely) offer = o;
      }
      const r = offer ? signNow(w, offer) : null;
      if (r?.ok) {
        w = r.world;
        signed.push(`${p.name} FA 계약 (${offer!.salary}C · 1년)`);
        break;
      }
    }
    const t = w.teams[c.teamId];
    if (t.starters[pos] || mainRoster(t).length >= MAX_MAIN_ROSTER) continue;
    const salary = Math.max(0.1, Math.min(0.6, capRoom(w, c.teamId)));
    const rng = createRng(hashSeed(w.seed, w.season, "auto-fill", pos));
    const top = positionTop(baseUniverse.champions, w.champMeta)[pos];
    const rookie = seedPool(makeRookie(w, t.league, pos, c.teamId, false, rng, { replacement: true, salary }), top, rng);
    w = { ...w, players: { ...w.players, [rookie.id]: rookie }, teams: { ...w.teams, [c.teamId]: { ...t, starters: { ...t.starters, [pos]: rookie.id } } }, nextRookie: w.nextRookie + 1 };
    signed.push(`${rookie.name} 대체 선수 영입 (하부 리그, ${rookie.contract?.salary ?? salary}C)`);
  }
  const next = signed.reduce((acc, line) => log(acc, line), { ...c, world: w });
  const left = registrationIssues(w, c.teamId);
  return { career: next, ok: left.length === 0, reason: left.length ? `못 채운 자리: ${left.join(", ")} (연봉 여유가 모자람. 후보를 방출해 봐)` : "" };
}

// 등록 마감 → 로스터 채우기·챔피언 풀·팀워크·메타 변화 → 다음 해
export function startNextSeason(c: Career): Outcome {
  const o = c.offseason;
  if (o?.stage !== "register") return refuse(c, "등록 단계가 아님");
  const issues = rosterIssues(c);
  if (issues.length) return refuse(c, issues.join(", "));
  const moves = o.log.filter((l) => !l.startsWith("──") && !l.startsWith("✘")).slice(0, 12);
  const history = c.world.history.map((h, i, all) => (i === all.length - 1 ? { ...h, moves } : h));
  const world = finishOffseason({ ...c.world, history }, c.stats, baseUniverse.champions, c.teamId);
  return {
    ok: true,
    reason: "",
    career: {
      ...c,
      world,
      year: newYearFor(world, c.teamId),
      stats: emptyStats(),
      records: {},
      progress: null,
      goals: goalsFor(world, c.teamId),
      growth: [],
      growthSeen: 0,
      offseason: null,
    },
  };
}

// ── 저장 ──────────────────────────────────────────────
// v3 = 여러 시즌. v2(한 해) 저장은 2026 세계를 새로 만들어 감싸서 이어 한다. v1(정규시즌만)은 버린다
const KEY = "lck-manager:career:v3";
const V2_KEY = "lck-manager:career:v2";
const V1_KEY = "lck-manager:career:v1";

interface CareerV2 {
  version: 2;
  teamId: string;
  seed: number;
  year: YearState;
  records: Record<string, SeriesRecord>;
  starters: Record<Position, string>;
  progress: SeriesProgress | null;
}

export function fromV2(old: CareerV2): Career {
  let world = newWorld(old.seed);
  for (const pos of POSITIONS) {
    const id = old.starters[pos];
    if (id && world.players[id] && world.teams[old.teamId].starters[pos] !== id) {
      const r = setStarter(world, old.teamId, pos, id);
      if (r.ok) world = r.world;
    }
  }
  return {
    version: 3,
    teamId: old.teamId,
    seed: old.seed,
    world,
    year: old.year,
    stats: emptyStats(),
    records: old.records,
    progress: old.progress,
    goals: goalsFor(world, old.teamId),
    growth: [],
    growthSeen: 0,
    offseason: null,
  };
}

export type LoadNotice = "droppedV1" | "migratedV2" | null;

export function loadCareer(): { career: Career | null; notice: LoadNotice } {
  try {
    let notice: LoadNotice = null;
    if (localStorage.getItem(V1_KEY) !== null) {
      localStorage.removeItem(V1_KEY);
      notice = "droppedV1";
    }
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Career;
      if (c.version === 3) return { career: c, notice };
    }
    const old = localStorage.getItem(V2_KEY);
    if (old) {
      const c2 = JSON.parse(old) as CareerV2;
      if (c2.version === 2) {
        const c = fromV2(c2);
        localStorage.setItem(KEY, JSON.stringify(c));
        localStorage.removeItem(V2_KEY);
        return { career: c, notice: "migratedV2" };
      }
    }
    return { career: null, notice };
  } catch {
    return { career: null, notice: null };
  }
}

export function saveCareer(c: Career | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 창 등)이나 용량 초과면 저장 없이 진행
  }
}
