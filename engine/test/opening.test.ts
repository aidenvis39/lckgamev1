// 커리어 시작: 2025 시즌이 끝난 스토브리그. AI만 진행하면 실제 2026 로스터·팀워크가 그대로 나와야 한다 (첫 시즌 캘리브레이션 유지)
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAcademy, loadCareerParams, loadParams, loadRaw, loadStart2025, loadUniverse, loadWorldTargets } from "../src/data.ts";
import { aiOpening } from "../src/career/play.ts";
import { beginOpening } from "../src/career/opening.ts";
import { isPreAgreed } from "../src/career/market.ts";
import { marketRound, openMarket } from "../src/career/userMarket.ts";
import { finishOffseason } from "../src/career/rollover.ts";
import { initWorld, mainRoster, toUniverse, validateWorld, worldParams } from "../src/career/world.ts";
import { emptyStats } from "../src/career/types.ts";
import { salaryDemand } from "../src/career/value.ts";
import { createRng } from "../src/rng.ts";
import { POSITIONS } from "../src/types.ts";
import { applyLeagueOffsets } from "../src/universe.ts";

const raw = loadRaw();
const academy = loadAcademy();
const params = loadParams();
const base = loadUniverse();
const start = loadStart2025();
const opening = (seed = 1) => initWorld({ ...raw, academy, params, world: loadWorldTargets(), start, cp: loadCareerParams(), seed });

test("start2025: 2026 세계 선수 전원이 항목을 갖고, 실제 행선지가 2026 팀과 같다", () => {
  for (const p of [...raw.players, ...academy]) {
    const e = start.entries[p.id];
    assert.ok(e, p.id);
    assert.equal(e.dest, p.team, p.id);
  }
  const ids = [...Object.keys(start.entries), ...start.extra.map((x) => x.id)];
  assert.equal(new Set(ids).size, ids.length, "중복 id");
  const teams = new Set(raw.teams.map((t) => t.id));
  for (const x of start.extra) assert.ok(teams.has(x.team), x.id);
  assert.deepEqual(start.history.champions, { LCK: "GEN", MSI: "GEN", WORLDS: "T1" });
});

test("시작 세계: 2025 시즌, 한 선수는 한 곳에, FA는 계약 없음, 옮긴 선수는 2025 만료 + 실제 팀과 사전 합의", () => {
  const w = opening();
  assert.equal(w.season, 2025);
  const where = new Map<string, string>();
  for (const t of Object.values(w.teams))
    for (const id of [...mainRoster(t), ...t.academy]) {
      assert.ok(!where.has(id), `${id}: ${where.get(id)} / ${t.id}`);
      where.set(id, t.id);
      assert.equal(w.players[id].contract?.team, t.id, id);
    }
  for (const id of w.freeAgents) assert.equal(w.players[id].contract, null, id);
  // Gumayusi: 2025 T1 → 실제 2026 HLE
  assert.equal(w.players.gumayusi.contract?.team, "T1");
  assert.equal(w.players.gumayusi.contract?.endSeason, 2025);
  assert.ok(isPreAgreed(w, "gumayusi", "HLE"));
  assert.equal(w.players.faker.contract?.team, "T1");
  assert.ok(w.players.faker.careerTitles.includes("2025 월즈"));
  assert.equal(w.history[0].champions.WORLDS, "T1");
  const { expiring } = beginOpening(w);
  assert.ok(expiring.T1.includes("gumayusi"));
  assert.ok(Object.values(expiring).flat().every((id) => w.players[id].contract!.endSeason === 2025));
});

test("AI만 진행한 첫 스토브리그 = 실제 2026 로스터·팀워크 (첫 시즌 캘리브레이션과 같은 Universe)", () => {
  const w = aiOpening(opening(3), base);
  assert.equal(w.season, 2026);
  assert.equal(w.opening, null);
  assert.deepEqual(validateWorld(w), []);
  let same = 0;
  for (const t of raw.teams) for (const pos of POSITIONS) same += Number(w.teams[t.id].starters[pos] === t.starters[pos]);
  assert.ok(same >= 0.95 * raw.teams.length * 5, `주전 일치 ${same}/${raw.teams.length * 5}`);
  for (const a of academy) assert.ok(w.teams[a.team].academy.includes(a.id), `2군 ${a.id}`);
  // 경기에 쓰이는 것: 주전·능력치·운영 기여·챔피언 풀·팀워크가 지금 2026 데이터와 같아야 한다
  const real = applyLeagueOffsets(base, params.leagueOffset);
  const u = toUniverse(w, base);
  const wp = worldParams(w, params);
  for (const t of raw.teams) {
    assert.deepEqual(u.teams.get(t.id)!.starters, real.teams.get(t.id)!.starters, t.id);
    assert.equal(wp.teamwork[t.id], params.teamwork[t.id] ?? 0, t.id);
    for (const pos of POSITIONS) {
      const id = t.starters[pos];
      const [a, b] = [u.players.get(id)!, real.players.get(id)!];
      for (const k of ["laning", "teamfight", "vision", "survival"] as const) assert.ok(Math.abs(a.ratings[k] - b.ratings[k]) < 0.051, `${id} ${k}`);
      assert.equal(a.intangible, b.intangible, id);
      assert.deepEqual(a.champions, b.champions, id);
    }
  }
});

test("사용자가 사전 합의 선수를 뺏으면: 내 팀으로 오고, 원래 팀은 다른 선수로 메우고 팀워크가 줄어든다", () => {
  let w = opening(5);
  const peyz = w.players.peyz;
  assert.ok(isPreAgreed(w, "peyz", "T1"));
  // DNS(명성 낮음)가 요구의 1.8배 제안 (상한 넉넉하게)
  w = { ...w, teams: { ...w.teams, DNS: { ...w.teams.DNS, cap: 300 } } };
  const begun = beginOpening(w);
  let m = openMarket(begun.world, begun.expiring, "DNS", createRng(1));
  const offer = { team: "DNS", player: "peyz", salary: Math.round(salaryDemand(peyz) * 1.8 * 10) / 10, years: 2, role: "starter" as const };
  for (let r = 0; r < 4; r++) m = marketRound(m, "DNS", r === 0 ? [offer] : [], r === 3, createRng(r + 2)).world;
  assert.equal(m.players.peyz.contract?.team, "DNS");
  const done = finishOffseason(m, emptyStats(), base.champions, "DNS");
  assert.deepEqual(validateWorld(done), []);
  assert.ok(done.teams.T1.starters.bot && done.teams.T1.starters.bot !== "peyz");
  const tuned = params.teamwork.T1 ?? 0;
  if (tuned > 0) assert.ok(Math.abs(done.teams.T1.teamwork - tuned * 0.8) < 1e-9, `T1 팀워크 ${done.teams.T1.teamwork}`);
});

test("첫 스토브리그는 같은 시드면 같은 결과", () => {
  assert.deepEqual(aiOpening(opening(9), base), aiOpening(opening(9), base));
});

test("v3 저장 세계 올리기: 통산 경기·실제 우승을 채우고 조절값을 새로", async () => {
  const { upgradeWorld } = await import("../src/career/migrate.ts");
  const w = aiOpening(opening(2), base);
  const old = { ...w, opening: undefined, players: Object.fromEntries(Object.values(w.players).map((p) => [p.id, { ...p, careerGames: undefined, careerTitles: [] }])) } as unknown as typeof w;
  const up = upgradeWorld(old, start, loadCareerParams());
  assert.equal(up.opening, null);
  assert.equal(up.players.faker.careerGames, start.entries.faker.careerGames);
  assert.ok(up.players.faker.careerTitles.includes("2025 월즈"));
  assert.deepEqual(validateWorld(up), []);
});
