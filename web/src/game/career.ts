// 커리어(한 해 진행) 상태. 대진·순위·출전권은 엔진의 YearState가 맡고, 여기선 내 팀·세트 기록·진행 중 시리즈를 더한다.
// 한 해: LCK 1~2라운드 → Road to MSI → MSI → LCK 3~4라운드 → LCK 플레이인·플레이오프 → 월즈 (해외 5개 리그는 뒤에서 같이 진행)
import {
  baseUniverse,
  createRng,
  createYear,
  endDay,
  hashSeed,
  OVERSEAS,
  params,
  pendingChoice,
  phaseName,
  POSITIONS,
  recordResult,
  simulateMatch,
  teamsByLeague,
  todayMatches,
  choose,
  type DraftResult,
  type GameResult,
  type Match,
  type Outcome,
  type Position,
  type SeriesResult,
  type Side,
  type Universe,
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

export interface Career {
  version: 2;
  teamId: string;
  seed: number;
  season: number;
  year: YearState;
  records: Record<string, SeriesRecord>;
  starters: Record<Position, string>; // 내 팀 주전 (로스터 화면에서 바꿀 수 있음)
  progress: SeriesProgress | null;
}

export const LCK_TEAMS = [...baseUniverse.teams.values()].filter((t) => t.league === "LCK").map((t) => t.id);
const DETAILED = new Set(["LCK", "RTM", "MSI", "LCKPO", "WORLDS"]);
export const isOverseasLeague = (m: Match) => OVERSEAS.includes(m.event);

export function newCareer(teamId: string, seed = Math.floor(Math.random() * 1e9), season = 2026): Career {
  return {
    version: 2,
    teamId,
    seed,
    season,
    year: createYear(teamsByLeague(baseUniverse.teams.values()), seed, teamId, season),
    records: {},
    starters: { ...baseUniverse.teams.get(teamId)!.starters },
    progress: null,
  };
}

export function universeFor(c: Career): Universe {
  const teams = new Map(baseUniverse.teams);
  teams.set(c.teamId, { ...teams.get(c.teamId)!, starters: c.starters });
  return { ...baseUniverse, teams };
}

export const isMine = (c: Career, m: Match) => m.home === c.teamId || m.away === c.teamId;
export const today = (c: Career) => todayMatches(c.year);
export const myMatchToday = (c: Career) => today(c).find((m) => isMine(c, m) && !c.year.results[m.id]) ?? null;
export const myPendingChoice = (c: Career) => pendingChoice(c.year);
export const seasonOver = (c: Career) => c.year.phase === "DONE";
export const seriesRng = (c: Career, m: Match, salt = "") => createRng(hashSeed(c.seed, m.id, salt));

// "LCK 1~2라운드 3일차", "MSI 브래킷 2일차" 같은 오늘 이름
export function dayLabel(c: Career): string {
  const y = c.year;
  if (y.phase === "DONE") return `${c.season} 시즌 종료`;
  const start = y.phaseStart[y.phase] ?? y.day;
  return `${phaseName(y.phase)} ${y.day - start + 1}일차`;
}

export const matchById = (c: Career, id: string) => c.year.matches.find((m) => m.id === id) ?? null;

function toRecord(games: Array<{ blue: string; red: string; draft: { picks: Record<Side, Record<Position, string>> }; result: GameResult }>, auto = false): SeriesRecord {
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

// 경기 난수는 (커리어 시드, 경기 id)로 고정. 내 팀은 로스터 화면에서 바꾼 주전으로 뛴다
const simulate = (c: Career, u: Universe, m: Match): { outcome: Outcome; series: SeriesResult } => simulateMatch(u, params, c.seed, m);

// 직접 치른 내 시리즈 결과를 넣는다
export function recordMine(c: Career, matchId: string, games: PlayedGame[]): Career {
  const m = matchById(c, matchId)!;
  const score: [number, number] = [0, 0];
  for (const g of games) score[(g.result.winner === "blue" ? g.blue : g.red) === m.home ? 0 : 1]++;
  const winner = score[0] > score[1] ? m.home : m.away;
  return {
    ...c,
    year: recordResult(c.year, m.id, { winner, score }),
    records: { ...c.records, [m.id]: toRecord(games) },
    progress: null,
  };
}

// 오늘 남은 경기를 모두 시뮬하고 다음 날로. 내 경기가 남아 있으면 AI가 대신 치른다
export function finishDay(c: Career): Career {
  const u = universeFor(c);
  let year = c.year;
  const records = { ...c.records };
  for (const m of todayMatches(year)) {
    if (year.results[m.id]) continue;
    const r = simulate(c, u, m);
    year = recordResult(year, m.id, r.outcome);
    if (DETAILED.has(m.event)) records[m.id] = toRecord(r.series.games, isMine(c, m));
  }
  const progress = c.progress && year.results[c.progress.matchId] ? null : c.progress;
  return { ...c, year: endDay(year), records, progress };
}

// 내 경기나 내 지목 차례가 올 때까지 (또는 시즌 끝까지) 하루씩 넘긴다
export function advanceToMine(c: Career, limit = 200): Career {
  let next = c;
  for (let i = 0; i < limit && !seasonOver(next); i++) {
    next = finishDay(next);
    if (myMatchToday(next) || myPendingChoice(next)) break;
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

export function swapStarter(c: Career, position: Position, playerId: string): Career {
  return { ...c, starters: { ...c.starters, [position]: playerId } };
}

export function rosterOf(c: Career): { starters: Record<Position, string>; bench: string[] } {
  const all = [...baseUniverse.players.values()].filter((p) => p.team === c.teamId).map((p) => p.id);
  const starterIds = new Set(POSITIONS.map((pos) => c.starters[pos]));
  return { starters: c.starters, bench: all.filter((id) => !starterIds.has(id)) };
}

// 저장: v2. 예전(v1, 정규시즌만 있던 버전) 저장은 새 형식과 맞지 않아 버린다
const KEY = "lck-manager:career:v2";
const OLD_KEY = "lck-manager:career:v1";

export function loadCareer(): { career: Career | null; droppedOld: boolean } {
  try {
    const droppedOld = localStorage.getItem(OLD_KEY) !== null;
    if (droppedOld) localStorage.removeItem(OLD_KEY);
    const raw = localStorage.getItem(KEY);
    const c = raw ? (JSON.parse(raw) as Career) : null;
    return { career: c && c.version === 2 ? c : null, droppedOld };
  } catch {
    return { career: null, droppedOld: false };
  }
}

export function saveCareer(c: Career | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 창 등)에선 저장 없이 진행
  }
}
