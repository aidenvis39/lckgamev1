import assert from "node:assert/strict";
import { test } from "node:test";
import { loadUniverse } from "../src/data.ts";
import { hashSeed } from "../src/rng.ts";
import type { Match, Outcome } from "../src/competition/types.ts";
import {
  champion,
  choose,
  createYear,
  endDay,
  OVERSEAS,
  pendingChoice,
  recordResult,
  RULES,
  swissTable,
  teamsByLeague,
  todayMatches,
  type YearState,
} from "../src/competition/year.ts";

// 대진 구조만 보는 테스트라 경기는 동전 던지기로 정한다 (경기 id로 결정되어 재현 가능)
const coin = (seed: number, m: Match): Outcome => {
  const h = hashSeed(seed, m.id);
  const need = Math.ceil(m.bestOf / 2);
  const homeWins = h % 2 === 0;
  const other = (h >>> 1) % need;
  return { winner: homeWins ? m.home : m.away, score: homeWins ? [need, other] : [other, need] };
};

const leagues = teamsByLeague(loadUniverse().teams.values());

function run(seed: number, userTeam: string | null = null, onChoice?: (st: YearState) => YearState): YearState {
  let st = createYear(leagues, seed, userTeam);
  while (st.phase !== "DONE") {
    if (pendingChoice(st)) {
      st = onChoice ? onChoice(st) : choose(st, pendingChoice(st)!.id, pendingChoice(st)!.options[0]);
      continue;
    }
    for (const m of todayMatches(st)) if (!st.results[m.id]) st = recordResult(st, m.id, coin(seed, m));
    st = endDay(st);
  }
  return st;
}

const count = (st: YearState, event: string, stage?: string) => st.matches.filter((m) => m.event === event && (!stage || m.stage === stage)).length;

test("한 해 대진 수: LCK 130 + RTM 5 + MSI 20 + LCK 포스트시즌 13 + 월즈 46, 해외 리그는 팀당 전·후반 더블 라운드로빈", () => {
  for (let seed = 0; seed < 15; seed++) {
    const st = run(seed);
    assert.equal(count(st, "LCK"), 130);
    assert.equal(count(st, "RTM"), 5);
    assert.equal(count(st, "MSI", "PI"), 6);
    assert.equal(count(st, "MSI", "BR"), 14);
    assert.equal(count(st, "LCKPO", "PI"), 3);
    assert.equal(count(st, "LCKPO", "PO"), 10);
    assert.equal(count(st, "WORLDS", "PI"), 6);
    assert.equal(count(st, "WORLDS", "SW"), 33);
    assert.equal(count(st, "WORLDS", "KO"), 7);
    for (const lg of OVERSEAS) {
      const n = leagues[lg].length;
      assert.equal(count(st, lg), 2 * n * (n - 1), lg);
    }
    const bo = (b: number) => st.matches.filter((m) => m.event === "WORLDS" && m.bestOf === b).length;
    assert.deepEqual([bo(1), bo(3), bo(5)], [20, 13, 13]);
    assert.equal(Object.keys(st.results).length, st.matches.length);
  }
});

test("출전권: MSI 11팀, 월즈 19팀, 리그별 수가 규칙대로이고 중복 없음. 우승팀은 각각 한 팀", () => {
  for (let seed = 0; seed < 15; seed++) {
    const st = run(seed);
    const msi = st.qualified.msi;
    assert.equal(msi.length, 11);
    assert.equal(new Set(msi.map((e) => e.team)).size, 11);
    const worlds = st.qualified.worlds;
    assert.equal(worlds.length, 19);
    assert.equal(new Set(worlds.map((e) => e.team)).size, 19);
    for (const [lg, n] of Object.entries(RULES.worldsSlots)) {
      const list = worlds.filter((e) => e.league === lg);
      assert.equal(list.length, n, lg);
      assert.ok(list.every((e) => leagues[lg].includes(e.team)));
    }
    for (const ev of ["LCK", "MSI", "WORLDS", "RTM"]) assert.equal(st.finals[ev].filter(([p]) => p === 1).length, 1, ev);
    assert.equal(st.finals.WORLDS.length, 19);
    assert.equal(new Set(st.finals.LCK.map(([, t]) => t)).size, 10);
    // LCK 월즈 시드 = 플레이오프 1~4위
    assert.deepEqual(worlds.filter((e) => e.league === "LCK").map((e) => e.team), st.finals.LCK.slice(0, 4).map(([, t]) => t));
    // LCK MSI 시드 = Road to MSI 1시드 결정전 승자, 2시드 결정전 승자
    const rtm = (key: string) => st.results[`RTM:${key}`].winner;
    assert.deepEqual(msi.filter((e) => e.league === "LCK").map((e) => e.team), [rtm("R3"), rtm("R5")]);
    assert.ok(champion(st, "WORLDS"));
  }
});

test("스위스: 1라운드 같은 리그 없음, 재대결 없음, 3-0 둘·3-1 셋·3-2 셋 진출, 진출·탈락전만 BO3", () => {
  for (let seed = 0; seed < 40; seed++) {
    const st = run(seed);
    const sw = st.matches.filter((m) => m.stage === "SW" && m.event === "WORLDS");
    const league = new Map(st.swiss!.map((t) => [t.team, t.league]));
    for (const m of sw.filter((x) => x.round === 1)) assert.notEqual(league.get(m.home), league.get(m.away));
    const seen = new Set<string>();
    for (const m of sw) {
      const key = [m.home, m.away].sort().join("|");
      assert.ok(!seen.has(key), `재대결 ${key} (seed ${seed})`);
      seen.add(key);
    }
    const table = swissTable(st);
    const q = (l: number) => table.filter((t) => t.w === 3 && t.l === l).length;
    assert.deepEqual([q(0), q(1), q(2)], [2, 3, 3]);
    assert.equal(table.filter((t) => t.l === 3).length, 8);
    const rounds = [1, 2, 3, 4, 5].map((r) => sw.filter((m) => m.round === r).length);
    assert.deepEqual(rounds, [8, 8, 8, 6, 3]);
    // 8강: 3-0 팀은 3-2 팀과 붙는다
    const rec = new Map(table.map((t) => [t.team, `${t.w}-${t.l}`]));
    for (const key of ["Q1", "Q3"]) {
      const m = st.matches.find((x) => x.id === `WLD_KO:${key}`)!;
      assert.deepEqual([rec.get(m.home), rec.get(m.away)], ["3-0", "3-2"]);
    }
  }
});

test("같은 시드면 같은 한 해", () => {
  assert.deepEqual(run(3), run(3));
});

test("LCK 플레이오프 지목: 사용자 팀이 1·3시드면 멈추고, 고른 팀과 붙는다", () => {
  const seed = 5;
  const base = run(seed);
  const poSeeds = base.seeds.LCK_PO!;
  for (const [user, choiceKey] of [[poSeeds[2], "LCK_PO:C1"], [poSeeds[0], "LCK_PO:C2"]] as const) {
    const seen: { asked?: { id: string; options: string[] } } = {};
    const st = run(seed, user, (s) => {
      const p = pendingChoice(s)!;
      if (p.id === choiceKey) seen.asked = p;
      return choose(s, p.id, p.options[p.options.length - 1]); // 일부러 AI와 다른(높은 시드) 쪽도 고를 수 있게 마지막 후보
    });
    const asked = seen.asked;
    assert.ok(asked, `${user} ${choiceKey}`);
    const picked = st.choices[choiceKey];
    assert.equal(picked, asked.options[asked.options.length - 1]);
    const matchKey = choiceKey === "LCK_PO:C1" ? "LCK_PO:U1A" : "LCK_PO:U2A";
    const m = st.matches.find((x) => x.id === matchKey)!;
    assert.deepEqual(new Set([m.home, m.away]), new Set([user, picked]));
  }
});

test("결과 검증: 참가팀이 아니거나 점수가 BO와 안 맞으면 거부", () => {
  const st = createYear(leagues, 1);
  const m = todayMatches(st)[0];
  assert.throws(() => recordResult(st, m.id, { winner: "XXX", score: [2, 0] }));
  assert.throws(() => recordResult(st, m.id, { winner: m.home, score: [3, 0] }));
  assert.throws(() => recordResult(st, m.id, { winner: m.home, score: [0, 2] }));
  assert.throws(() => endDay(st));
  const ok = recordResult(st, m.id, { winner: m.away, score: [1, 2] });
  assert.throws(() => recordResult(ok, m.id, { winner: m.away, score: [1, 2] }));
});
