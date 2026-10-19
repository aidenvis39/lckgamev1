import assert from "node:assert/strict";
import { test } from "node:test";
import { loadParams, loadUniverse } from "../src/data.ts";
import { applyChoice, currentTurn, newDraft, rankOptions, runDraft } from "../src/draft.ts";
import { lineupOf, swapPlayers } from "../src/lineup.ts";
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

test("맞트레이드: 소속·주전 자리가 바뀌고 원본은 그대로", () => {
  const after = swapPlayers(u, "faker", "clozer");
  assert.equal(lineupOf(after, "T1").players.mid.id, "clozer");
  assert.equal(lineupOf(after, "DNS").players.mid.id, "faker");
  assert.equal(after.players.get("faker")!.team, "DNS");
  assert.equal(lineupOf(u, "T1").players.mid.id, "faker");
  assert.throws(() => swapPlayers(u, "faker", "keria"));
});

test("시즌: 1~2라운드 90시리즈 + 그룹별 3~4라운드 40시리즈, 승패 합계가 맞다", () => {
  const s = playSeason(u, p, createRng(1));
  assert.equal(s.series.length, 130);
  assert.equal(s.standings.reduce((n, t) => n + t.seriesWins, 0), 130);
  assert.equal(s.standings.reduce((n, t) => n + t.seriesLosses, 0), 130);
  // 3~4라운드는 같은 그룹끼리만
  const group = new Map<string, string>([...s.groups!.legend.map((t) => [t, "L"] as const), ...s.groups!.rise.map((t) => [t, "R"] as const)]);
  for (const x of s.series.slice(90)) assert.equal(group.get(x.teams[0]), group.get(x.teams[1]));
  for (const t of s.standings) assert.equal(t.seriesWins + t.seriesLosses, 26);
});

test("밴픽 단계 API: 사람이 한쪽을 맡아도 규칙이 지켜진다", () => {
  const ctx = { u, lineups, p };
  let s = newDraft(["Vi"]);
  assert.throws(() => applyChoice(s, { kind: "ban", side: "blue", champion: "Vi" })); // 피어리스로 막힘
  assert.throws(() => applyChoice(s, { kind: "pick", side: "blue", champion: "Azir", position: "mid" })); // 지금은 밴 차례
  while (currentTurn(s)) {
    const [kind, side] = currentTurn(s)!;
    const opt = rankOptions(ctx, s, side)[0];
    s = applyChoice(s, kind === "ban" ? { kind, side, champion: opt.champion } : { kind, side, champion: opt.champion, position: opt.position });
  }
  assert.equal(s.steps.length, 20);
  assert.ok(!s.taken.has("Vi") || s.unavailable.has("Vi"));
});

test("타임라인: 킬 수와 용 수가 결과와 맞는다", () => {
  const rng = createRng(3);
  const r = simulateGame(u, lineups, runDraft(u, lineups, p, rng.fork("d")), p, rng.fork("g"));
  const count = (kind: string, side: Side) => r.timeline.filter((e) => e.kind === kind && e.side === side).reduce((n, e) => n + (e.count ?? 1), 0);
  assert.equal(count("kill", "blue"), r.kills.blue);
  assert.equal(count("dragon", "red"), r.dragons.red);
  assert.equal(count("tower", "blue"), r.towers.blue);
  assert.equal(count("tower", "red"), r.towers.red);
});
