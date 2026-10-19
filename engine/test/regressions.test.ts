import assert from "node:assert/strict";
import { test } from "node:test";
import { loadParams, loadUniverse } from "../src/data.ts";
import { runDraft } from "../src/draft.ts";
import { lineupOf, swapPlayers } from "../src/lineup.ts";
import { simulateGame } from "../src/match.ts";
import { createRng } from "../src/rng.ts";
import { playSeries } from "../src/series.ts";
import { buildDraftPool } from "../src/tune.ts";
import { POSITIONS, SIDES, other, type GameResult, type Side, type Position } from "../src/types.ts";
import { leagueUniverse } from "../src/universe.ts";

const u = leagueUniverse(loadUniverse(), "LCK");
const p = loadParams();
const lineups = { blue: lineupOf(u, "GEN"), red: lineupOf(u, "T1") };

test("캐시 피어리스: 진영 변경과 BO5 4·5세트에도 실제 이력을 지킨다", () => {
  const draft = buildDraftPool(u, p, 42);
  let flipped = false;
  let fifth = false;
  for (let seed = 0; seed < 100; seed++) {
    const series = playSeries(u, lineups.blue, lineups.red, p, createRng(seed), { bestOf: 5, draft });
    const used = new Set<string>();
    fifth ||= series.games.length === 5;
    for (let i = 0; i < series.games.length; i++) {
      const g = series.games[i];
      flipped ||= i > 0 && g.blue !== series.games[i - 1].blue;
      for (const step of g.draft.steps) assert.ok(!used.has(step.champion), `seed ${seed}, game ${i + 1}: ${step.champion}`);
      for (const s of SIDES) for (const pos of POSITIONS) used.add(g.draft.picks[s][pos]);
    }
  }
  assert.ok(flipped && fifth, "진영 변경 및 5세트 분기를 실제로 검사해야 함");
});

test("교전 킬 수는 상대 선수 수를 넘지 않는다", () => {
  const d = runDraft(u, lineups, p, createRng(42));
  for (let seed = 0; seed < 100; seed++) {
    const r = simulateGame(u, lineups, d, p, createRng(seed));
    const counts = new Map<string, number>();
    for (const e of r.timeline) {
      if (e.kind !== "kill" || e.t <= 15) continue;
      const key = `${e.t}|${e.side}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      assert.ok(counts.get(key)! <= 5, `seed ${seed}: ${key}`);
    }
  }
});

test("드래프트 캐시는 실제 금지 목록, 선수 교체, 숙련도 변경을 구별한다", () => {
  const draft = buildDraftPool(u, p, 42);
  const call = (blocked: Set<string>, roster = lineups) => draft(1, roster, blocked, createRng(0));
  const first = call(new Set());
  const blocked = new Set(Object.values(first.picks.blue));
  const next = call(blocked);
  for (const step of next.steps) assert.ok(!blocked.has(step.champion));
  assert.strictEqual(next, call(new Set([...blocked].reverse())), "삽입 순서가 달라도 캐시 재사용");
  assert.strictEqual(first, call(new Set()), "피어리스 해제 시 이전 이력이 남지 않음");

  const traded = swapPlayers(u, "faker", "clozer");
  const roster = { ...lineups, red: lineupOf(traded, "T1") };
  const changed = call(new Set(), roster);
  assert.notStrictEqual(first, changed);
  assert.strictEqual(changed, call(new Set(), roster));
  const trained = structuredClone(roster);
  trained.red.players.mid.champions.Azir = 100;
  assert.notStrictEqual(changed, call(new Set(), trained));
});

test("드래프트 결과는 캐시 깊이와 호출 순서에 영향을 받지 않는다", () => {
  const cached = buildDraftPool(u, p, 73, 5);
  const uncached = buildDraftPool(u, p, 73, 0);
  const used = new Set<string>();
  for (let g = 0; g < 5; g++) {
    const roster = g % 2 ? { blue: lineups.red, red: lineups.blue } : lineups;
    const d = cached(g, roster, used, createRng(g));
    assert.deepEqual(d, uncached(g, roster, used, createRng(999)));
    for (const s of SIDES) for (const pos of POSITIONS) used.add(d.picks[s][pos]);
  }
  const fresh = buildDraftPool(u, p, 73, 5);
  assert.deepEqual(cached(0, lineups, new Set(), createRng(0)), fresh(0, lineups, new Set(), createRng(1)));
});

function checkCombat(r: GameResult): void {
  const until = { blue: {} as Record<Position, number>, red: {} as Record<Position, number> };
  const lines = Object.fromEntries(SIDES.map((s) => [s, Object.fromEntries(POSITIONS.map((pos) =>
    [pos, { kills: 0, deaths: 0, assists: 0 }]))])) as GameResult["lines"];
  const counts = new Map<number, Record<Side, number>>();
  for (const e of r.timeline) {
    if (e.kind !== "kill") continue;
    assert.ok(e.kill, "킬 사건에 참여자 기록이 있어야 함");
    const { killer, victim, assists, respawnAt } = e.kill;
    const alive = (s: Side, pos: Position) => e.t >= (until[s][pos] ?? 0);
    assert.ok(alive(e.side, killer), "사망자가 킬을 기록함");
    assert.ok(alive(other(e.side), victim), "부활 전 중복 사망");
    assert.ok(assists.every((pos) => pos !== killer && alive(e.side, pos)), "사망자 또는 킬 주체의 어시스트");
    assert.equal(new Set(assists).size, assists.length);
    assert.ok(respawnAt > e.t);
    until[other(e.side)][victim] = respawnAt;
    lines[e.side][killer].kills++;
    lines[other(e.side)][victim].deaths++;
    for (const pos of assists) lines[e.side][pos].assists++;
    const at = counts.get(e.t) ?? { blue: 0, red: 0 };
    at[e.side]++;
    counts.set(e.t, at);
    assert.ok(at[e.side] <= 5, "같은 시각에 6킬 이상");
  }
  assert.deepEqual(lines, r.lines, "타임라인을 재생한 KDA가 최종 기록과 같아야 함");
  for (const s of SIDES) assert.equal(POSITIONS.reduce((n, pos) => n + lines[s][pos].kills, 0), r.kills[s]);
  for (const e of r.events) {
    const score = e.text.match(/^교전 승리 (\d+):(\d+)/);
    if (!score) continue;
    assert.ok(e.side);
    const at = counts.get(Math.round(e.t * 10) / 10) ?? { blue: 0, red: 0 };
    assert.equal(Number(score[1]), at[e.side]);
    assert.equal(Number(score[2]), at[other(e.side)]);
  }
}

test("1,000경기: 생존·부활, 킬·데스·어시스트, 중계 점수 일치", () => {
  const d = runDraft(u, lineups, p, createRng(42));
  for (let seed = 0; seed < 1000; seed++) checkCombat(simulateGame(u, lineups, d, p, createRng(seed), { log: true }));
});

test("같은 시각에 킬이 몰려도 중복 사망하지 않고 이후 부활한다", () => {
  const d = runDraft(u, lineups, p, createRng(42));
  const rng = { ...createRng(1), next: () => 0.5, normal: () => 0, poisson: () => 50 };
  const r = simulateGame(u, lineups, d, p, rng, { log: true });
  checkCombat(r);
  assert.ok(r.timeline.filter((e) => e.kind === "kill" && e.t < 15).length <= 9);
  assert.ok(SIDES.some((s) => POSITIONS.some((pos) => r.lines[s][pos].deaths > 1)), "다른 교전에는 부활 후 다시 참가");
});
