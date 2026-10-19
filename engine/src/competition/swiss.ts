// 월즈 스위스 스테이지: 16팀, 3승 진출 / 3패 탈락.
// 1라운드: 1풀 대 4풀, 2풀 대 3풀, 같은 리그끼리는 피함. 2라운드부터: 같은 승패끼리, 이미 만난 팀은 다시 안 만남.
// 진출이나 탈락이 걸린 경기(어느 팀이든 2승 또는 2패)는 BO3, 나머지는 BO1.
// 추첨은 후보 순서를 섞은 뒤 전체 대진이 성립할 때까지 되돌아가며 찾는다 (앞에서 아무나 묶으면 끝에 재대결만 남을 수 있음).
import type { Rng } from "../rng.ts";
import type { BestOf, Match, Results } from "./types.ts";

export interface SwissTeam {
  team: string;
  league: string;
  seed: number; // 지역 시드: 홈(1세트 블루)은 지역 시드가 높은 팀
  pool: number; // 1~4
}

export interface SwissRecord {
  w: number;
  l: number;
  opponents: string[];
}

export const WINS_TO_ADVANCE = 3;
export const LOSSES_TO_EXIT = 3;

export function swissRecords(teams: SwissTeam[], matches: Match[], results: Results): Map<string, SwissRecord> {
  const rec = new Map(teams.map((t) => [t.team, { w: 0, l: 0, opponents: [] as string[] }]));
  for (const m of matches) {
    const o = results[m.id];
    if (!o) continue;
    for (const [me, opp] of [[m.home, m.away], [m.away, m.home]]) {
      const r = rec.get(me)!;
      r.opponents.push(opp);
      o.winner === me ? r.w++ : r.l++;
    }
  }
  return rec;
}

export const isActive = (r: SwissRecord) => r.w < WINS_TO_ADVANCE && r.l < LOSSES_TO_EXIT;

function shuffle<T>(list: T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 모든 팀을 짝지을 수 있는 조합을 되돌아가며 찾는다. 불가능하면 null
function pairUp(list: string[], ok: (a: string, b: string) => boolean, rng: Rng): Array<[string, string]> | null {
  if (list.length === 0) return [];
  const [a, ...rest] = list;
  for (const b of shuffle(rest, rng)) {
    if (!ok(a, b)) continue;
    const sub = pairUp(rest.filter((x) => x !== b), ok, rng);
    if (sub) return [[a, b], ...sub];
  }
  return null;
}

function pairAcross(left: string[], right: string[], ok: (a: string, b: string) => boolean, rng: Rng): Array<[string, string]> | null {
  if (left.length === 0) return [];
  const [a, ...rest] = left;
  for (const b of shuffle(right, rng)) {
    if (!ok(a, b)) continue;
    const sub = pairAcross(rest, right.filter((x) => x !== b), ok, rng);
    if (sub) return [[a, b], ...sub];
  }
  return null;
}

export interface SwissPairing {
  home: string;
  away: string;
  bestOf: BestOf;
  record: string; // "1-0" 같은 조 이름
  rematch: boolean; // 재대결 말고는 대진이 안 나올 때만 true (테스트로 0건 확인)
}

export function swissPairings(teams: SwissTeam[], records: Map<string, SwissRecord>, round: number, rng: Rng): SwissPairing[] {
  const info = new Map(teams.map((t) => [t.team, t]));
  const home = (a: string, b: string): [string, string] => {
    const [x, y] = [info.get(a)!.seed, info.get(b)!.seed];
    if (x !== y) return x < y ? [a, b] : [b, a];
    return rng.next() < 0.5 ? [a, b] : [b, a];
  };
  const make = (pairs: Array<[string, string]>, rematch = false): SwissPairing[] =>
    pairs.map(([a, b]) => {
      const ra = records.get(a)!;
      const rb = records.get(b)!;
      const decisive = [ra, rb].some((r) => r.w === WINS_TO_ADVANCE - 1 || r.l === LOSSES_TO_EXIT - 1);
      const [h, aw] = home(a, b);
      return { home: h, away: aw, bestOf: decisive ? 3 : 1, record: `${ra.w}-${ra.l}`, rematch };
    });

  if (round === 1) {
    const pool = (n: number) => shuffle(teams.filter((t) => t.pool === n).map((t) => t.team), rng);
    const diffLeague = (a: string, b: string) => info.get(a)!.league !== info.get(b)!.league;
    const out: SwissPairing[] = [];
    for (const [x, y] of [[1, 4], [2, 3]]) {
      const pairs = pairAcross(pool(x), pool(y), diffLeague, rng) ?? pairAcross(pool(x), pool(y), () => true, rng)!;
      out.push(...make(pairs));
    }
    return out;
  }

  const groups = new Map<string, string[]>();
  for (const t of teams) {
    const r = records.get(t.team)!;
    if (!isActive(r)) continue;
    const key = `${r.w}-${r.l}`;
    groups.set(key, [...(groups.get(key) ?? []), t.team]);
  }
  const out: SwissPairing[] = [];
  for (const key of [...groups.keys()].sort().reverse()) {
    const list = shuffle(groups.get(key)!, rng);
    const fresh = pairUp(list, (a, b) => !records.get(a)!.opponents.includes(b), rng);
    out.push(...(fresh ? make(fresh) : make(pairUp(list, () => true, rng)!, true)));
  }
  return out;
}
