// 커리어(시즌 진행) 상태. 순수 함수로만 바꾸고, 화면은 새 Career를 받아 다시 그린다.
// 정규시즌: 1~2라운드 18일(10팀 더블 라운드로빈) → 3~4라운드 10일(레전드·라이즈 그룹별 더블 라운드로빈). 전부 BO3.
import {
  baseUniverse,
  createRng,
  hashSeed,
  lineupOf,
  params,
  playSeries,
  POSITIONS,
  type Position,
  type Side,
  type Universe,
} from "../engine.ts";

export type Stage = "R12" | "R34L" | "R34R";

export interface GameRecord {
  blue: string;
  red: string;
  winner: string; // 팀 약칭
  duration: number;
  kills: [number, number]; // [블루, 레드]
  gd15: number; // 블루 기준
  picks: Record<Side, Record<Position, string>>;
}

export interface SeriesRecord {
  id: string;
  matchday: number;
  stage: Stage;
  home: string; // 1세트 블루
  away: string;
  score?: [number, number]; // [home, away]
  winner?: string;
  games?: GameRecord[];
  auto?: boolean; // 내 경기를 AI에게 맡겼는지
}

export interface Career {
  version: 1;
  teamId: string;
  seed: number;
  season: number;
  matchday: number; // 다음에 치를 날 (0부터)
  series: SeriesRecord[];
  groups: { legend: string[]; rise: string[] } | null;
  starters: Record<Position, string>; // 내 팀 주전 (로스터 화면에서 바꿀 수 있음)
}

export interface Standing {
  team: string;
  sw: number;
  sl: number;
  gw: number;
  gl: number;
  form: Array<"W" | "L">; // 최근 5시리즈, 오래된 것부터
}

export const R12_DAYS = 18;
export const TOTAL_DAYS = 28;
export const TEAM_IDS = [...baseUniverse.teams.keys()];

export function newCareer(teamId: string, seed = Math.floor(Math.random() * 1e9), season = 2026): Career {
  const rng = createRng(hashSeed(seed, "schedule"));
  const order = [...TEAM_IDS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    version: 1,
    teamId,
    seed,
    season,
    matchday: 0,
    series: doubleRoundRobin(order, "R12", 0),
    groups: null,
    starters: { ...baseUniverse.teams.get(teamId)!.starters },
  };
}

// 원형 배치법. 홀수 팀이면 매 라운드 한 팀이 쉰다.
function roundRobin(list: string[]): Array<Array<[string, string]>> {
  const t = [...list];
  if (t.length % 2) t.push("");
  const rounds: Array<Array<[string, string]>> = [];
  for (let r = 0; r < t.length - 1; r++) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < t.length / 2; i++) {
      const [a, b] = [t[i], t[t.length - 1 - i]];
      if (a && b) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    t.splice(1, 0, t.pop()!);
  }
  return rounds;
}

function doubleRoundRobin(teams: string[], stage: Stage, firstDay: number): SeriesRecord[] {
  const legs = roundRobin(teams);
  const rounds = [...legs, ...legs.map((r) => r.map(([a, b]) => [b, a] as [string, string]))];
  return rounds.flatMap((pairs, i) =>
    pairs.map(([home, away]) => ({ id: `${stage}-${firstDay + i}-${home}-${away}`, matchday: firstDay + i, stage, home, away })),
  );
}

export function universeFor(c: Career): Universe {
  const teams = new Map(baseUniverse.teams);
  teams.set(c.teamId, { ...teams.get(c.teamId)!, starters: c.starters });
  return { ...baseUniverse, teams };
}

export const seriesOn = (c: Career, day: number) => c.series.filter((s) => s.matchday === day);
export const isMine = (c: Career, s: SeriesRecord) => s.home === c.teamId || s.away === c.teamId;
export const mySeriesOn = (c: Career, day: number) => seriesOn(c, day).find((s) => isMine(c, s)) ?? null;
export const seasonOver = (c: Career) => c.matchday >= TOTAL_DAYS;
export const seriesRng = (c: Career, s: SeriesRecord, salt = "") => createRng(hashSeed(c.seed, s.id, salt));

export function dayLabel(day: number): string {
  if (day >= TOTAL_DAYS) return "정규시즌 종료";
  return day < R12_DAYS ? `1~2라운드 ${day + 1}일차` : `3~4라운드 ${day - R12_DAYS + 1}일차`;
}

export function standings(c: Career): Standing[] {
  const table = new Map<string, Standing>(TEAM_IDS.map((t) => [t, { team: t, sw: 0, sl: 0, gw: 0, gl: 0, form: [] }]));
  for (const s of c.series) {
    if (!s.score || !s.winner) continue;
    const [h, a] = [table.get(s.home)!, table.get(s.away)!];
    h.gw += s.score[0];
    h.gl += s.score[1];
    a.gw += s.score[1];
    a.gl += s.score[0];
    for (const t of [h, a]) {
      const won = s.winner === t.team;
      won ? t.sw++ : t.sl++;
      t.form = [...t.form, won ? ("W" as const) : ("L" as const)].slice(-5);
    }
  }
  return [...table.values()].sort((x, y) => y.sw - x.sw || y.gw - y.gl - (x.gw - x.gl) || y.gw - x.gw);
}

// 엔진 시리즈 결과 → 저장용 기록
function recordOf(s: SeriesRecord, games: Array<{ blue: string; red: string; draft: { picks: Record<Side, Record<Position, string>> }; result: { winner: Side; duration: number; kills: Record<Side, number>; gd15: number } }>, score: [number, number], winner: string, auto = false): SeriesRecord {
  return {
    ...s,
    score,
    winner,
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

export function simulateSeries(c: Career, s: SeriesRecord, auto = false): SeriesRecord {
  const u = universeFor(c);
  const r = playSeries(u, lineupOf(u, s.home), lineupOf(u, s.away), params, seriesRng(c, s), { bestOf: 3 });
  return recordOf(s, r.games, r.score, r.winner, auto);
}

export function recordUserSeries(s: SeriesRecord, games: Parameters<typeof recordOf>[1], score: [number, number]): SeriesRecord {
  return recordOf(s, games, score, score[0] > score[1] ? s.home : s.away);
}

// 그날의 남은 경기를 모두 시뮬하고 다음 날로. 1~2라운드가 끝나면 3~4라운드 그룹 일정을 만든다.
export function finishDay(c: Career, mine?: SeriesRecord): Career {
  const day = c.matchday;
  let series = c.series.map((s) => (mine && s.id === mine.id ? mine : s));
  const next = { ...c, series };
  series = series.map((s) => (s.matchday === day && !s.score ? simulateSeries(next, s, isMine(c, s)) : s));
  let result: Career = { ...c, series, matchday: day + 1 };
  if (result.matchday === R12_DAYS && !result.groups) {
    const order = standings(result).map((s) => s.team);
    const groups = { legend: order.slice(0, 5), rise: order.slice(5) };
    result = {
      ...result,
      groups,
      series: [...result.series, ...doubleRoundRobin(groups.legend, "R34L", R12_DAYS), ...doubleRoundRobin(groups.rise, "R34R", R12_DAYS)],
    };
  }
  return result;
}

export function swapStarter(c: Career, position: Position, playerId: string): Career {
  return { ...c, starters: { ...c.starters, [position]: playerId } };
}

export function rosterOf(c: Career): { starters: Record<Position, string>; bench: string[] } {
  const all = [...baseUniverse.players.values()].filter((p) => p.team === c.teamId).map((p) => p.id);
  const starterIds = new Set(POSITIONS.map((pos) => c.starters[pos]));
  return { starters: c.starters, bench: all.filter((id) => !starterIds.has(id)) };
}

// ── 저장 ────────────────────────────────────────────────
const KEY = "lck-manager:career:v1";

export function loadCareer(): Career | null {
  try {
    const raw = localStorage.getItem(KEY);
    const c = raw ? (JSON.parse(raw) as Career) : null;
    return c?.version === 1 ? c : null;
  } catch {
    return null;
  }
}

export function saveCareer(c: Career | null): void {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    // 저장소를 못 쓰는 환경(시크릿 창 등)에선 저장 없이 진행
  }
}
