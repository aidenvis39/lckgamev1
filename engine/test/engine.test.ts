import assert from "node:assert/strict";
import { test } from "node:test";
import { loadParams, loadUniverse } from "../src/data.ts";
import { applyChoice, currentTurn, newDraft, rankOptions, runDraft } from "../src/draft.ts";
import { lineupOf, swapPlayers } from "../src/lineup.ts";
import { deathTimer, simulateGame } from "../src/match.ts";
import { createRng } from "../src/rng.ts";
import { buildDraftPool } from "../src/tune.ts";
import { playSeason } from "../src/season.ts";
import { playSeries } from "../src/series.ts";
import { POSITIONS, type Position, type Side } from "../src/types.ts";
import { leagueUniverse } from "../src/universe.ts";

const world = loadUniverse();
const u = leagueUniverse(world, "LCK");
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

// 시리즈 안에서 앞 세트에 나온 챔피언을 다시 고른 시리즈 수
const fearlessRepeats = (series: Array<{ games: Array<{ draft: { picks: Record<Side, Record<Position, string>> } }> }>) =>
  series.filter((s) => {
    const seen = new Set<string>();
    return s.games.some((g) => {
      const picks = (["blue", "red"] as Side[]).flatMap((side) => POSITIONS.map((pos) => g.draft.picks[side][pos]));
      const dup = picks.some((c) => seen.has(c));
      picks.forEach((c) => seen.add(c));
      return dup;
    });
  }).length;

test("피어리스: 튜닝용 드래프트 캐시를 써도 진영이 바뀐 세트에서 이전 챔피언을 다시 안 고른다", () => {
  const draft = buildDraftPool(u, p, 5);
  for (let i = 0; i < 3; i++) assert.equal(fearlessRepeats(playSeason(u, p, createRng(i), { draft }).series), 0);
  const bo5 = Array.from({ length: 30 }, (_, i) => playSeries(u, lineups.blue, lineups.red, p, createRng(100 + i), { bestOf: 5, draft }));
  assert.equal(fearlessRepeats(bo5), 0);
  // 캐시는 호출 순서와 무관: 새 캐시로 같은 시즌을 돌리면 같은 결과
  assert.deepEqual(playSeason(u, p, createRng(9), { draft: buildDraftPool(u, p, 5) }).standings, playSeason(u, p, createRng(9), { draft }).standings);
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

test("교전: 죽은 선수는 부활 전까지 다시 죽거나 킬을 내지 않고, 한 교전에서 한쪽 킬은 5 이하", () => {
  const rng = createRng(11);
  for (let i = 0; i < 300; i++) {
    const kills: Array<{ t: number; side: Side; killer: Position; victim: Position }> = [];
    const r = simulateGame(u, lineups, runDraft(u, lineups, p, rng.fork(`d${i}`)), p, rng.fork(`g${i}`), {
      onKill: (t, side, killer, victim) => kills.push({ t, side, killer, victim }),
    });
    const deadUntil = new Map<string, number>();
    for (const k of kills) {
      const enemy = k.side === "blue" ? "red" : "blue";
      assert.ok((deadUntil.get(`${k.side}|${k.killer}`) ?? -1) <= k.t, `${i}경기 ${k.t}분: 죽은 ${k.killer}가 킬`);
      assert.ok((deadUntil.get(`${enemy}|${k.victim}`) ?? -1) <= k.t, `${i}경기 ${k.t}분: 죽은 ${k.victim}가 또 죽음`);
      deadUntil.set(`${enemy}|${k.victim}`, k.t + deathTimer(k.t));
    }
    // 15분 이후 30초 구간마다 한쪽 킬 5 이하
    for (const a of kills.filter((k) => k.t >= 15)) assert.ok(kills.filter((k) => k.side === a.side && k.t >= a.t && k.t < a.t + 0.5).length <= 5);
    for (const s of ["blue", "red"] as Side[]) {
      const enemy = s === "blue" ? "red" : "blue";
      assert.equal(kills.filter((k) => k.side === s).length, r.kills[s]);
      assert.equal(POSITIONS.reduce((n, pos) => n + r.lines[enemy][pos].deaths, 0), r.kills[s]);
    }
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

test("세계 데이터: 56팀 모두 주전 5명이 자기 팀 소속, 선수는 한 팀에만", () => {
  assert.equal(world.teams.size, 56);
  assert.equal(u.teams.size, 10);
  const seen = new Set<string>();
  for (const t of world.teams.values()) {
    for (const id of [...Object.values(t.starters), ...t.bench]) {
      const pl = world.players.get(id);
      assert.ok(pl, `${t.id} ${id}`);
      assert.equal(pl.team, t.id);
      assert.ok(!seen.has(id), `중복 ${id}`);
      seen.add(id);
    }
    for (const pos of POSITIONS) assert.equal(world.players.get(t.starters[pos])!.position, pos);
  }
  assert.equal(seen.size, world.players.size);
});
