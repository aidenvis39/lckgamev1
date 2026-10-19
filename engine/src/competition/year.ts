// 한 해 일정 (게임용 2026 규칙). 상태는 JSON 객체 하나이고, 결과를 넣고 하루를 넘기는 함수로만 바꾼다.
//   LCK 1~2라운드 18일 (해외 5개 리그 전반이 같은 기간에 진행)
//   → Road to MSI → MSI 플레이인 → MSI 브래킷
//   → LCK 3~4라운드 10일 (해외 후반) → LCK 플레이인 → LCK 플레이오프
//   → 월즈 플레이인 → 월즈 스위스 → 월즈 녹아웃
// 해외 리그는 전반·후반 각각 더블 라운드로빈 BO3. MSI 대표는 전반 순위, 월즈 대표는 전·후반 합산 순위로 뽑는다.
import { createRng, hashSeed, type Rng } from "../rng.ts";
import { BRACKETS, isComplete, openChoices, placements, readyMatches, type BracketView } from "./bracket.ts";
import { doubleRoundRobin } from "./roundRobin.ts";
import { standings, type Standing } from "./standings.ts";
import { isActive, swissPairings, swissRecords, type SwissRecord, type SwissTeam } from "./swiss.ts";
import { loserOf, type Entrant, type Match, type Outcome, type Results } from "./types.ts";

export const LEAGUES = ["LCK", "LPL", "LEC", "LCS", "LCP", "CBLOL"];
export const OVERSEAS = ["LPL", "LEC", "LCS", "LCP", "CBLOL"];

export type PhaseId = "SPRING" | "RTM" | "MSI_PI" | "MSI_BR" | "SUMMER" | "LCK_PI" | "LCK_PO" | "WLD_PI" | "WLD_SW" | "WLD_KO" | "DONE";

export const PHASES: Array<{ id: PhaseId; name: string }> = [
  { id: "SPRING", name: "LCK 1~2라운드" },
  { id: "RTM", name: "Road to MSI" },
  { id: "MSI_PI", name: "MSI 플레이인" },
  { id: "MSI_BR", name: "MSI 브래킷" },
  { id: "SUMMER", name: "LCK 3~4라운드" },
  { id: "LCK_PI", name: "LCK 플레이인" },
  { id: "LCK_PO", name: "LCK 플레이오프" },
  { id: "WLD_PI", name: "월즈 플레이인" },
  { id: "WLD_SW", name: "월즈 스위스" },
  { id: "WLD_KO", name: "월즈 녹아웃" },
  { id: "DONE", name: "시즌 종료" },
];
export const phaseName = (id: PhaseId) => PHASES.find((p) => p.id === id)!.name;

type Seat = [string, number]; // [리그, 지역 시드]

// 2026 출전권 (게임용)
// 월즈: 기본 17장 + MSI 성적으로 2장. MSI 우승팀은 자국 플레이오프에 들면 직행(그 지역 +1), 그다음으로 잘한 다른 지역도 +1.
export const RULES = {
  springDays: 18,
  summerDays: 10,
  msiPlayIn: [["LCK", 2], ["LEC", 2], ["LCS", 2], ["LCP", 2]] as Seat[],
  msiPoolA: [["LPL", 1], ["LCK", 1], ["LEC", 1], ["LCS", 1]] as Seat[],
  msiPoolB: [["LPL", 2], ["LCP", 1], ["CBLOL", 1]] as Seat[], // + 플레이인 승자
  msiOverseas: { LPL: 2, LEC: 2, LCS: 2, LCP: 2, CBLOL: 1 } as Record<string, number>,
  worldsBase: { LCK: 3, LPL: 3, LEC: 3, LCS: 3, LCP: 3, CBLOL: 2 } as Record<string, number>,
  swissBase: { LCK: 3, LPL: 3, LEC: 2, LCS: 2, LCP: 2, CBLOL: 1 } as Record<string, number>, // 나머지 기본 자리는 플레이인
  msiBonusSlots: 2,
  // MSI 우승팀 직행 조건: 자국 최종 순위가 이 안 (LCK는 플레이오프 6팀, 해외는 게임용 기준)
  playoffLine: { LCK: 6, LPL: 8, LEC: 6, LCS: 6, LCP: 6, CBLOL: 6 } as Record<string, number>,
  // 스위스 풀. BONUS = MSI로 얻은 자리(각 지역의 스위스 기본 자리 다음 시드), PI = 플레이인 승자
  worldsPools: [
    [["LCK", 1], ["LPL", 1], ["LCS", 1], ["LEC", 1]],
    [["CBLOL", 1], ["LCP", 1], ["LCK", 2], ["LPL", 2]],
    [["LCS", 2], ["LEC", 2], ["LCK", 3], ["LPL", 3]],
    [["LCP", 2], ["BONUS", 1], ["BONUS", 2], ["PI", 1]],
  ] as Seat[][],
};

// 한 해 국제대회 출전권 수 (화면·튜닝용): 기본 + MSI 보너스가 걸린 지역은 1장 더
export const worldsSlotsOf = (st: YearState | null, league: string) =>
  RULES.worldsBase[league] + (st?.worldsBonus?.leagues.includes(league) ? 1 : 0);
export const worldsBonusDecided = (st: YearState) => Boolean(st.worldsBonus);

// 대진표 단계 → 대진표 정의, 대회, 화면 이름
const BRACKET_PHASES: Partial<Record<PhaseId, { def: string; event: string; stage: string }>> = {
  RTM: { def: "RTM", event: "RTM", stage: "RTM" },
  MSI_PI: { def: "DE4", event: "MSI", stage: "PI" },
  MSI_BR: { def: "DE8", event: "MSI", stage: "BR" },
  LCK_PI: { def: "LCK_PI", event: "LCKPO", stage: "PI" },
  LCK_PO: { def: "LCK_PO", event: "LCKPO", stage: "PO" },
  WLD_PI: { def: "DE4", event: "WORLDS", stage: "PI" },
  WLD_KO: { def: "SE8", event: "WORLDS", stage: "KO" },
};

export interface YearState {
  version: 1;
  seed: number;
  season: number;
  userTeam: string | null; // 지목 차례에서 멈출 팀 (CLI는 null)
  leagues: Record<string, string[]>;
  day: number; // 지금 치를 날
  phase: PhaseId;
  phaseStart: Partial<Record<PhaseId, number>>;
  matches: Match[];
  results: Results;
  seeds: Partial<Record<PhaseId, string[]>>; // 대진표 단계별 시드 순서
  choices: Record<string, string>; // "LCK_PO:C1" → 지목한 팀
  groups: { legend: string[]; rise: string[] } | null;
  swiss: SwissTeam[] | null;
  qualified: { msi: Entrant[]; worlds: Entrant[] };
  // MSI 성적으로 정해지는 월즈 보너스 (월즈 플레이인 시작 때 확정)
  worldsBonus: { leagues: string[]; champion: string | null; championEligible: boolean } | null;
  finals: Record<string, Array<[number, string]>>; // 대회·리그별 최종 순위
}

// ── 만들기 ─────────────────────────────────────────────

export function createYear(leagues: Record<string, string[]>, seed: number, userTeam: string | null = null, season = 2026): YearState {
  const st: YearState = {
    version: 1,
    seed,
    season,
    userTeam,
    leagues: Object.fromEntries(LEAGUES.map((lg) => [lg, [...(leagues[lg] ?? [])].sort()])),
    day: 0,
    phase: "SPRING",
    phaseStart: {},
    matches: [],
    results: {},
    seeds: {},
    choices: {},
    groups: null,
    swiss: null,
    qualified: { msi: [], worlds: [] },
    worldsBonus: null,
    finals: {},
  };
  return settle(startPhase(st, "SPRING"));
}

const rngFor = (st: YearState, ...salt: Array<string | number>): Rng => createRng(hashSeed(st.seed, ...salt));

function shuffled<T>(list: T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 동률일 때 쓰는 고정 추첨 순서 (시즌 시작에 정해짐)
export const lottery = (st: YearState, key: string, teams: string[]) => shuffled([...teams].sort(), rngFor(st, "lottery", key));

// 라운드로빈 일정을 days일에 나눠 배치한다. 라운드 수가 날짜보다 많으면 하루에 두 라운드를 치른다
function scheduleRoundRobin(st: YearState, event: string, stage: string, label: string, teams: string[], firstDay: number, days: number): Match[] {
  const rounds = doubleRoundRobin(shuffled(teams, rngFor(st, "schedule", event, stage)));
  return rounds.flatMap((pairs, r) =>
    pairs.map(([home, away]) => ({
      id: `${event}:${stage}:${r}:${home}-${away}`,
      event,
      stage,
      label,
      day: firstDay + Math.floor((r * days) / rounds.length),
      home,
      away,
      bestOf: 3 as const,
      round: r + 1,
    })),
  );
}

// ── 순위 ───────────────────────────────────────────────

const lckRegular = (st: YearState) => st.matches.filter((m) => m.event === "LCK");

export function lckSpringStandings(st: YearState): Standing[] {
  const teams = st.leagues.LCK;
  return standings(teams, lckRegular(st).filter((m) => m.stage === "R12"), st.results, lottery(st, "LCK", teams));
}

// 그룹이 나뉜 뒤엔 그룹 안에서 전체 성적(1~4라운드)으로 순위를 낸다. 그룹 소속은 1~2라운드 결과로 고정
export function lckGroupStandings(st: YearState): { legend: Standing[]; rise: Standing[] } | null {
  if (!st.groups) return null;
  const all = lckRegular(st);
  const lot = lottery(st, "LCK", st.leagues.LCK);
  return {
    legend: standings(st.groups.legend, all, st.results, lot),
    rise: standings(st.groups.rise, all, st.results, lot),
  };
}

export function leagueStandings(st: YearState, league: string, half: "H1" | "all" = "all"): Standing[] {
  if (league === "LCK") {
    const g = lckGroupStandings(st);
    return g && half === "all" ? [...g.legend, ...g.rise] : lckSpringStandings(st);
  }
  const teams = st.leagues[league];
  const ms = st.matches.filter((m) => m.event === league && (half === "all" || m.stage === "H1"));
  return standings(teams, ms, st.results, lottery(st, league, teams));
}

export function swissTable(st: YearState): Array<SwissTeam & SwissRecord> {
  if (!st.swiss) return [];
  const rec = swissRecords(st.swiss, st.matches.filter((m) => m.event === "WORLDS" && m.stage === "SW"), st.results);
  return st.swiss
    .map((t) => ({ ...t, ...rec.get(t.team)! }))
    .sort((a, b) => b.w - a.w || a.l - b.l || a.pool - b.pool || a.seed - b.seed);
}

// ── 대진표 ─────────────────────────────────────────────

export function bracketView(st: YearState, phase: PhaseId): BracketView {
  const byId = new Map(st.matches.map((m) => [m.id, m]));
  return {
    seeds: st.seeds[phase] ?? [],
    result: (key) => {
      const m = byId.get(`${phase}:${key}`);
      const o = m && st.results[m.id];
      return m && o ? { winner: o.winner, loser: loserOf(m, o) } : null;
    },
    choice: (key) => st.choices[`${phase}:${key}`] ?? null,
  };
}

export const bracketDefOf = (phase: PhaseId) => {
  const b = BRACKET_PHASES[phase];
  return b ? BRACKETS[b.def] : null;
};

const entrant = (list: Entrant[], league: string, seed: number) => list.find((e) => e.league === league && e.seed === seed)!;

// ── 단계 시작·마무리 ───────────────────────────────────

function startPhase(st: YearState, phase: PhaseId): YearState {
  const s: YearState = { ...st, phase, phaseStart: { ...st.phaseStart, [phase]: st.day } };
  const day = st.day;
  switch (phase) {
    case "SPRING": {
      const ms = [
        ...scheduleRoundRobin(s, "LCK", "R12", "LCK 1~2라운드", s.leagues.LCK, day, RULES.springDays),
        ...OVERSEAS.flatMap((lg) => scheduleRoundRobin(s, lg, "H1", `${lg} 전반`, s.leagues[lg], day, RULES.springDays)),
      ];
      return { ...s, matches: [...s.matches, ...ms] };
    }
    case "SUMMER": {
      const g = s.groups!;
      const ms = [
        ...scheduleRoundRobin(s, "LCK", "R34L", "LCK 3~4라운드 레전드 그룹", g.legend, day, RULES.summerDays),
        ...scheduleRoundRobin(s, "LCK", "R34R", "LCK 3~4라운드 라이즈 그룹", g.rise, day, RULES.summerDays),
        ...OVERSEAS.flatMap((lg) => scheduleRoundRobin(s, lg, "H2", `${lg} 후반`, s.leagues[lg], day, RULES.summerDays)),
      ];
      return { ...s, matches: [...s.matches, ...ms] };
    }
    case "RTM":
      return { ...s, seeds: { ...s.seeds, RTM: lckSpringStandings(s).slice(0, 6).map((x) => x.team) } };
    case "MSI_PI": {
      const teams = RULES.msiPlayIn.map(([lg, n]) => entrant(s.qualified.msi, lg, n).team);
      return { ...s, seeds: { ...s.seeds, MSI_PI: shuffled(teams, rngFor(s, "draw", "MSI_PI")) } };
    }
    case "MSI_BR": {
      const piWinner = placements(BRACKETS.DE4, bracketView(s, "MSI_PI")).find(([p]) => p === 1)![1];
      const a = RULES.msiPoolA.map(([lg, n]) => entrant(s.qualified.msi, lg, n));
      const b = [...RULES.msiPoolB.map(([lg, n]) => entrant(s.qualified.msi, lg, n)), s.qualified.msi.find((e) => e.team === piWinner)!];
      return { ...s, seeds: { ...s.seeds, MSI_BR: drawEight(s, a, b) } };
    }
    case "LCK_PI": {
      const g = lckGroupStandings(s)!;
      return { ...s, seeds: { ...s.seeds, LCK_PI: [g.legend[4].team, ...g.rise.slice(0, 3).map((x) => x.team)] } };
    }
    case "LCK_PO": {
      const g = lckGroupStandings(s)!;
      const pi = placements(BRACKETS.LCK_PI, bracketView(s, "LCK_PI"));
      const at = (p: number) => pi.find(([x]) => x === p)![1];
      return { ...s, seeds: { ...s.seeds, LCK_PO: [...g.legend.slice(0, 4).map((x) => x.team), at(1), at(2)] } };
    }
    case "WLD_PI": {
      const a = allocateWorlds(s);
      const teams = a.entrants.filter((e) => e.stage === "PI").map((e) => e.team);
      return {
        ...s,
        worldsBonus: a.bonus,
        qualified: { ...s.qualified, worlds: a.entrants },
        seeds: { ...s.seeds, WLD_PI: shuffled(teams, rngFor(s, "draw", "WLD_PI")) },
      };
    }
    case "WLD_SW": {
      const piWinner = placements(BRACKETS.DE4, bracketView(s, "WLD_PI")).find(([p]) => p === 1)![1];
      // 이 규칙 전에 저장된 해(월즈 진행 중)는 LCK4·LPL4가 4풀이었다
      const marked = s.qualified.worlds.filter((e) => e.bonusSeat);
      const bonusSeats = marked.length ? marked : [entrant(s.qualified.worlds, "LCK", 4), entrant(s.qualified.worlds, "LPL", 4)];
      const swiss: SwissTeam[] = RULES.worldsPools.flatMap((pool, i) =>
        pool.map(([lg, n]) => {
          const e =
            lg === "PI" ? s.qualified.worlds.find((x) => x.team === piWinner)! : lg === "BONUS" ? bonusSeats[n - 1] : entrant(s.qualified.worlds, lg, n);
          return { team: e.team, league: e.league, seed: e.seed, pool: i + 1 };
        }),
      );
      return { ...s, swiss };
    }
    case "WLD_KO":
      return { ...s, seeds: { ...s.seeds, WLD_KO: knockoutPositions(s) } };
    case "DONE":
      return s;
  }
}

// 월즈 출전 팀 정하기 (월즈 플레이인 시작 때, 모든 자국 리그가 끝난 뒤)
//  1) MSI 최종 순위를 1위부터 보며 아직 보너스를 안 받은 지역에 1장씩, 2지역까지.
//     1위(우승팀) 몫은 우승팀이 자국 플레이오프선 안일 때만 준다. 아니면 다음 순위 지역으로.
//  2) 지역별 = 기본 + 보너스 장수만큼 자국 최종 순위 상위 팀. 직행 자격이 있는 MSI 우승팀은 순위가 밀려도 마지막 자리를 가진다.
//  3) 지역 안 시드 순서대로 스위스 기본 자리 → (보너스면) 스위스 4풀 자리 → 플레이인 자리.
export function allocateWorlds(st: YearState): { bonus: NonNullable<YearState["worldsBonus"]>; entrants: Entrant[] } {
  const leagueOf = (t: string) => LEAGUES.find((lg) => st.leagues[lg].includes(t))!;
  const domesticPlace = (t: string) => st.finals[leagueOf(t)]?.find(([, x]) => x === t)?.[0] ?? 99;
  const eligible = (t: string) => domesticPlace(t) <= RULES.playoffLine[leagueOf(t)];
  const msi = [...(st.finals.MSI ?? [])].sort((a, b) => a[0] - b[0]);
  const champion = msi.find(([p]) => p === 1)?.[1] ?? null;
  const championEligible = champion !== null && eligible(champion);
  const leagues: string[] = [];
  for (const [place, t] of msi) {
    const lg = leagueOf(t);
    if (leagues.includes(lg) || (place === 1 && !championEligible)) continue;
    leagues.push(lg);
    if (leagues.length === RULES.msiBonusSlots) break;
  }
  const entrants: Entrant[] = [];
  for (const lg of LEAGUES) {
    const bonus = leagues.includes(lg);
    const count = RULES.worldsBase[lg] + (bonus ? 1 : 0);
    const order = (st.finals[lg] ?? []).map(([, t]) => t);
    let picked = order.slice(0, count);
    if (championEligible && champion && leagueOf(champion) === lg && !picked.includes(champion))
      picked = [...picked.slice(0, count - 1), champion].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const swiss = RULES.swissBase[lg] + (bonus ? 1 : 0);
    picked.forEach((team, i) =>
      entrants.push({
        team,
        league: lg,
        seed: i + 1,
        stage: i < swiss ? "SW" : "PI",
        bonusSeat: bonus && i === RULES.swissBase[lg],
        via:
          team === champion && championEligible
            ? "MSI 우승"
            : bonus && i === count - 1 && !(championEligible && champion && leagueOf(champion) === lg)
              ? "MSI 지역 추가"
              : undefined,
      }),
    );
  }
  return { bonus: { leagues, champion, championEligible }, entrants };
}

// MSI 브래킷 추첨: A풀(LPL1·LCK1·LEC1·LCS1)이 1~4시드, B풀이 5~8시드. 첫 경기(1-8, 4-5, 2-7, 3-6)에 같은 리그가 없게 다시 뽑는다
function drawEight(st: YearState, a: Entrant[], b: Entrant[]): string[] {
  const rng = rngFor(st, "draw", "MSI_BR");
  const pairs = [[1, 8], [4, 5], [2, 7], [3, 6]];
  let seeds: Entrant[] = [];
  for (let tries = 0; tries < 200; tries++) {
    seeds = [...shuffled(a, rng), ...shuffled(b, rng)];
    if (pairs.every(([x, y]) => seeds[x - 1].league !== seeds[y - 1].league)) break;
  }
  return seeds.map((e) => e.team);
}

// 8강 자리: 3-0 두 팀은 3-2 팀과 붙고 서로 반대쪽 절반. 남은 네 팀(3-1 셋 + 3-2 하나)은 추첨
function knockoutPositions(st: YearState): string[] {
  const rng = rngFor(st, "draw", "WLD_KO");
  const table = swissTable(st).filter((t) => t.w === 3);
  const by = (l: number) => shuffled(table.filter((t) => t.l === l).map((t) => t.team), rng);
  const [perfect, one, two] = [by(0), by(1), by(2)];
  const rest = shuffled([...one, ...two.slice(2)], rng);
  return [perfect[0], two[0], rest[0], rest[1], perfect[1], two[1], rest[2], rest[3]];
}

function finishPhase(st: YearState): YearState {
  const s = { ...st };
  const place = (phase: PhaseId) => placements(bracketDefOf(phase)!, bracketView(s, phase));
  switch (st.phase) {
    case "SPRING": {
      const order = lckSpringStandings(s).map((x) => x.team);
      s.groups = { legend: order.slice(0, 5), rise: order.slice(5) };
      const msi = OVERSEAS.flatMap((lg) =>
        leagueStandings(s, lg, "H1")
          .slice(0, RULES.msiOverseas[lg])
          .map((x, i): Entrant => ({ team: x.team, league: lg, seed: i + 1 })),
      );
      s.qualified = { ...s.qualified, msi: [...s.qualified.msi, ...msi] };
      break;
    }
    case "RTM": {
      const p = place("RTM");
      s.finals = { ...s.finals, RTM: p };
      const lck = [1, 2].map((n): Entrant => ({ team: p.find(([x]) => x === n)![1], league: "LCK", seed: n }));
      s.qualified = { ...s.qualified, msi: [...lck, ...s.qualified.msi] };
      break;
    }
    case "MSI_BR": {
      const pi = place("MSI_PI").filter(([p]) => p > 1).map(([p, t]): [number, string] => [p + 7, t]);
      s.finals = { ...s.finals, MSI: [...place("MSI_BR"), ...pi] };
      break;
    }
    case "SUMMER": {
      s.finals = { ...s.finals, ...Object.fromEntries(OVERSEAS.map((lg) => [lg, leagueStandings(s, lg).map((x, i): [number, string] => [i + 1, x.team])])) };
      break;
    }
    case "LCK_PO": {
      const po = place("LCK_PO");
      const pi = place("LCK_PI");
      const rise = lckGroupStandings(s)!.rise;
      const at = (list: Array<[number, string]>, n: number) => list.find(([x]) => x === n)![1];
      s.finals = {
        ...s.finals,
        LCK: [...po, [7, at(pi, 3)], [8, at(pi, 4)], [9, rise[3].team], [10, rise[4].team]],
      };
      break;
    }
    case "WLD_KO": {
      const ko = place("WLD_KO");
      const sw = swissTable(s).filter((t) => t.w < 3);
      const out: Array<[number, string]> = [...ko];
      for (const l of [2, 1, 0]) {
        const placeNo = out.length + 1;
        for (const t of sw.filter((x) => x.w === l)) out.push([placeNo, t.team]);
      }
      const pi = place("WLD_PI").filter(([p]) => p > 1);
      for (const [, t] of pi) out.push([17, t]);
      s.finals = { ...s.finals, WORLDS: out };
      break;
    }
  }
  return s;
}

// ── 하루 진행 ──────────────────────────────────────────

const phaseMatches = (st: YearState, phase: PhaseId = st.phase) => {
  const start = st.phaseStart[phase] ?? 0;
  const b = BRACKET_PHASES[phase];
  if (b) return st.matches.filter((m) => m.id.startsWith(`${phase}:`));
  if (phase === "WLD_SW") return st.matches.filter((m) => m.event === "WORLDS" && m.stage === "SW");
  return st.matches.filter((m) => m.day >= start && (phase === "SPRING" ? m.stage === "R12" || m.stage === "H1" : m.stage.startsWith("R34") || m.stage === "H2"));
};

export const todayMatches = (st: YearState) => st.matches.filter((m) => m.day === st.day);

// 사용자 팀이 지목할 차례면 그 내용을 돌려준다 (다른 팀 지목은 AI가 바로 정함)
export function pendingChoice(st: YearState): { id: string; label: string; options: string[] } | null {
  const def = bracketDefOf(st.phase);
  if (!def || !st.userTeam) return null;
  const c = openChoices(def, bracketView(st, st.phase)).find((x) => x.by === st.userTeam);
  return c ? { id: `${st.phase}:${c.key}`, label: c.label, options: c.options } : null;
}

export function choose(st: YearState, id: string, team: string): YearState {
  const p = pendingChoice(st);
  if (!p || p.id !== id || !p.options.includes(team)) throw new Error(`지목할 수 없음: ${id} ${team}`);
  return materialize({ ...st, choices: { ...st.choices, [id]: team } });
}

export function recordResult(st: YearState, id: string, o: Outcome): YearState {
  const m = st.matches.find((x) => x.id === id);
  if (!m) throw new Error(`없는 경기: ${id}`);
  if (st.results[id]) throw new Error(`이미 끝난 경기: ${id}`);
  if (o.winner !== m.home && o.winner !== m.away) throw new Error(`참가팀이 아님: ${o.winner}`);
  const need = Math.ceil(m.bestOf / 2);
  const [h, a] = o.score;
  if (Math.max(h, a) !== need || Math.min(h, a) >= need || (h > a) !== (o.winner === m.home)) throw new Error(`점수 오류: ${id} ${o.score}`);
  return { ...st, results: { ...st.results, [id]: o } };
}

// 대진표·스위스 단계에서 지금 치를 수 있는 경기를 오늘 일정에 올린다
function materialize(st: YearState): YearState {
  let s = st;
  const b = BRACKET_PHASES[s.phase];
  if (b) {
    const def = BRACKETS[b.def];
    for (const c of openChoices(def, bracketView(s, s.phase))) {
      if (c.by === s.userTeam) continue;
      const seeds = s.seeds[s.phase]!;
      const weaker = [...c.options].sort((x, y) => seeds.indexOf(y) - seeds.indexOf(x))[0]; // AI는 시드가 낮은 팀을 지목
      s = { ...s, choices: { ...s.choices, [`${s.phase}:${c.key}`]: weaker } };
    }
    const have = new Set(s.matches.map((m) => m.id));
    const name = phaseName(s.phase);
    const fresh = readyMatches(def, bracketView(s, s.phase))
      .filter((m) => !have.has(`${s.phase}:${m.key}`))
      .map((m): Match => ({ id: `${s.phase}:${m.key}`, event: b.event, stage: b.stage, label: `${name} ${m.label}`, day: s.day, home: m.home, away: m.away, bestOf: def.bestOf }));
    return fresh.length ? { ...s, matches: [...s.matches, ...fresh] } : s;
  }
  if (s.phase === "WLD_SW") {
    const sw = phaseMatches(s);
    const round = sw.reduce((r, m) => Math.max(r, m.round ?? 0), 0);
    if (sw.some((m) => !s.results[m.id])) return s;
    const rec = swissRecords(s.swiss!, sw, s.results);
    if (![...rec.values()].some(isActive)) return s;
    const pairs = swissPairings(s.swiss!, rec, round + 1, rngFor(s, "swiss", round + 1));
    const fresh = pairs.map((p): Match => ({
      id: `WLD_SW:${round + 1}:${p.home}-${p.away}`,
      event: "WORLDS",
      stage: "SW",
      label: `월즈 스위스 ${round + 1}라운드 (${p.record} 조)`,
      day: s.day,
      home: p.home,
      away: p.away,
      bestOf: p.bestOf,
      round: round + 1,
    }));
    return { ...s, matches: [...s.matches, ...fresh] };
  }
  return s;
}

function phaseComplete(st: YearState): boolean {
  const def = bracketDefOf(st.phase);
  if (def) return isComplete(def, bracketView(st, st.phase));
  if (st.phase === "WLD_SW") {
    const rec = swissRecords(st.swiss!, phaseMatches(st), st.results);
    return ![...rec.values()].some(isActive);
  }
  return phaseMatches(st).every((m) => st.results[m.id]);
}

const NEXT: Record<PhaseId, PhaseId> = {
  SPRING: "RTM",
  RTM: "MSI_PI",
  MSI_PI: "MSI_BR",
  MSI_BR: "SUMMER",
  SUMMER: "LCK_PI",
  LCK_PI: "LCK_PO",
  LCK_PO: "WLD_PI",
  WLD_PI: "WLD_SW",
  WLD_SW: "WLD_KO",
  WLD_KO: "DONE",
  DONE: "DONE",
};

// 오늘 치를 경기나 사용자 지목이 생길 때까지 단계를 넘긴다
function settle(st: YearState): YearState {
  let s = st;
  for (let guard = 0; guard < 1000; guard++) {
    if (s.phase === "DONE") return s;
    s = materialize(s);
    if (todayMatches(s).length || pendingChoice(s)) return s;
    const future = phaseMatches(s).filter((m) => !s.results[m.id] && m.day > s.day);
    if (future.length) {
      s = { ...s, day: Math.min(...future.map((m) => m.day)) };
      continue;
    }
    if (!phaseComplete(s)) throw new Error(`진행이 멈춤: ${s.phase} ${s.day}일`);
    s = startPhase(finishPhase(s), NEXT[s.phase]);
  }
  throw new Error("단계 전환이 끝나지 않음");
}

// 오늘 경기가 모두 끝났으면 다음 날로. 사용자 지목이 남아 있으면 그 경기만 일정에 안 올라가고 기다린다
export function endDay(st: YearState): YearState {
  const open = todayMatches(st).filter((m) => !st.results[m.id]);
  if (open.length) throw new Error(`아직 안 끝난 경기: ${open.map((m) => m.id).join(", ")}`);
  return settle({ ...st, day: st.day + 1 });
}

// ── 화면용 요약 ────────────────────────────────────────

export const champion = (st: YearState, event: string) => st.finals[event]?.find(([p]) => p === 1)?.[1] ?? null;

export function teamsByLeague(teams: Iterable<{ id: string; league: string }>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of teams) (out[t.league] ??= []).push(t.id);
  return out;
}
