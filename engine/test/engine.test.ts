import assert from "node:assert/strict";
import { test } from "node:test";
import { loadParams, loadUniverse } from "../src/data.ts";
import { runDraft } from "../src/draft.ts";
import { lineupOf } from "../src/lineup.ts";
import { simulateGame } from "../src/match.ts";
import { createRng } from "../src/rng.ts";
import { playSeason } from "../src/season.ts";
import { playSeries } from "../src/series.ts";
import { POSITIONS, type Side } from "../src/types.ts";

const u = loadUniverse();
const p = loadParams();
const lineups = { blue: lineupOf(u, "GEN"), red: lineupOf(u, "T1") };

test("같은 시드면 같은 경기 결과", () => {
  const run = () => {
    const rng = createRng(42);
    const d = runDraft(u, lineups, p, rng.fork("d"));
    return simulateGame(u, lineups, d, p, rng.fork("g"), { log: true });
  };
  assert.deepEqual(run(), run());
});

test("드래프트: 밴 10개 + 픽 10개, 중복 없음, 모든 포지션 채움", () => {
  for (let seed = 0; seed < 50; seed++) {
    const d = runDraft(u, lineups, p, createRng(seed));
    const picks = (["blue", "red"] as Side[]).flatMap((s) => POSITIONS.map((pos) => d.picks[s][pos]));
    const all = [...picks, ...d.bans.blue, ...d.bans.red];
    assert.equal(d.bans.blue.length + d.bans.red.length, 10);
    assert.equal(picks.filter(Boolean).length, 10);
    assert.equal(new Set(all).size, 20);
  }
});

test("피어리스: 이전 세트 챔피언은 다시 안 나온다", () => {
  for (let seed = 0; seed < 20; seed++) {
    const s = playSeries(u, lineups.blue, lineups.red, p, createRng(seed), { bestOf: 5 });
    const seen = new Set<string>();
    for (const g of s.games) {
      const picks = (["blue", "red"] as Side[]).flatMap((side) => POSITIONS.map((pos) => g.draft.picks[side][pos]));
      for (const c of picks) assert.ok(!seen.has(c), `${c} 중복`);
      picks.forEach((c) => seen.add(c));
    }
  }
});

test("시리즈 점수: BO3는 2승 먼저, 진 팀이 다음 세트 블루", () => {
  for (let seed = 0; seed < 30; seed++) {
    const s = playSeries(u, lineups.blue, lineups.red, p, createRng(seed), { bestOf: 3 });
    assert.equal(Math.max(...s.score), 2);
    assert.equal(s.games.length, s.score[0] + s.score[1]);
    for (let i = 1; i < s.games.length; i++) {
      const prev = s.games[i - 1];
      const loser = prev.result.winner === "blue" ? prev.red : prev.blue;
      assert.equal(s.games[i].blue, loser);
    }
  }
});

test("경기 결과 값이 말이 되는 범위", () => {
  const rng = createRng(7);
  for (let i = 0; i < 200; i++) {
    const r = simulateGame(u, lineups, runDraft(u, lineups, p, rng.fork(`d${i}`)), p, rng.fork(`g${i}`));
    assert.ok(r.duration > 15 && r.duration < 70);
    assert.ok(r.towers[r.winner] >= 7);
    const k = (s: Side) => POSITIONS.reduce((n, pos) => n + r.lines[s][pos].kills, 0);
    assert.equal(k("blue"), r.kills.blue);
    assert.equal(k("red"), r.kills.red);
  }
});

test("시즌: 10팀 90시리즈, 승패 합계가 맞다", () => {
  const s = playSeason(u, p, createRng(1));
  assert.equal(s.series.length, 90);
  assert.equal(s.standings.reduce((n, t) => n + t.seriesWins, 0), 90);
  assert.equal(s.standings.reduce((n, t) => n + t.seriesLosses, 0), 90);
});
