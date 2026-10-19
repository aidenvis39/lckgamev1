import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAcademy, loadParams, loadRaw, loadTargets, loadUniverse, loadWorldTargets } from "../src/data.ts";
import { CHECKPOINTS, crossedCheckpoints, type Checkpoint } from "../src/career/develop.ts";
import { aiOffseason, newYearFor, playCareerSeason } from "../src/career/play.ts";
import { canAfford, completeBid, playerAcceptsMove, sellerVerdict, type Bid } from "../src/career/market.ts";
import { initWorld, mainRoster, validateWorld } from "../src/career/world.ts";
import { overall, salaryDemand, transferFee } from "../src/career/value.ts";
import { endDay, recordResult, todayMatches } from "../src/competition/year.ts";
import { hashSeed } from "../src/rng.ts";
import { POSITIONS } from "../src/types.ts";

const base = loadUniverse();
const params = loadParams();
const fresh = (seed = 1) => initWorld({ ...loadRaw(), academy: loadAcademy(), params, world: loadWorldTargets(), targets: loadTargets("2026"), seed });

test("커리어 시작: 로스터 불변식, 세계 공통 능력치, 2군 포함, 연봉 합 ≤ 상한", () => {
  const w = fresh();
  assert.deepEqual(validateWorld(w), []);
  assert.ok(Object.values(w.players).every((p) => p.ratingLeague === "GLOBAL" && p.contract));
  assert.ok(Object.values(w.teams).filter((t) => t.league === "LCK").every((t) => t.academy.length > 0));
  // LCK 2군 선수는 LCK CL 보정만큼 낮아짐
  const acad = Object.values(w.players).filter((p) => p.academy);
  assert.ok(acad.length > 40);
});

test("성장 시점: 한 해 동안 1~2R 중간·끝, MSI 끝, 3~4R 중간·끝, 월즈 끝을 한 번씩 지난다", () => {
  let y = newYearFor(fresh());
  const seen: Checkpoint[] = [];
  while (y.phase !== "DONE") {
    for (const m of todayMatches(y)) {
      const need = Math.ceil(m.bestOf / 2);
      y = recordResult(y, m.id, { winner: m.home, score: [need, 0] });
    }
    const next = endDay(y);
    seen.push(...crossedCheckpoints(y, next));
    y = next;
  }
  assert.deepEqual(seen, ["SPRING_MID", "SPRING_END", "MSI_END", "SUMMER_MID", "SUMMER_END", "WORLDS_END"]);
  assert.equal(Object.values(CHECKPOINTS).reduce((s, c) => s + (c.who === "all" ? c.share : 0), 0), 1);
});

test("두 시즌 진행: 시즌마다 로스터 불변식 유지, 나이 +1, 계약 끝난 선수는 재계약 또는 FA, 같은 시드면 같은 결과", () => {
  const run = () => {
    let w = fresh(7);
    const snapshots = [];
    for (let i = 0; i < 2; i++) {
      const before = w;
      const r = playCareerSeason(w, base, params);
      // 시즌 중 성장이 실제로 일어났다
      const grew = Object.values(r.world.players).filter((p) => overall(p.ratings) !== overall(before.players[p.id].ratings)).length;
      assert.ok(grew > 100, `시즌 중 성장한 선수 ${grew}`);
      w = aiOffseason(r.world, r.year, r.stats, base);
      assert.deepEqual(validateWorld(w), [], `${w.season} 시즌 시작 로스터`);
      assert.equal(w.season, before.season + 1);
      for (const p of Object.values(w.players)) {
        const old = before.players[p.id];
        if (!old || p.retired) continue;
        assert.equal(p.age, (old.age ?? 22) + 1, p.id);
        if (p.contract) assert.ok(p.contract.endSeason >= w.season, `${p.id} 계약 ${p.contract.endSeason} < ${w.season}`);
      }
      assert.equal(w.history.length, i + 1);
      snapshots.push(w);
    }
    return snapshots[1];
  };
  const a = run();
  assert.deepEqual(a, run());
});

test("이적료 영입 규칙: 몸값 미만이면 거절, 대체 없는 주전은 1.3배, 예산·상한 검사, 확정 시 이적료가 오간다", () => {
  const w = fresh();
  const p = w.players[w.teams.T1.starters.mid]; // Faker
  const buyer = "DNS";
  const fee = transferFee(p, w.season);
  const bid = (f: number): Bid => ({ team: buyer, player: p.id, fee: f, salary: salaryDemand(p), years: 1, role: "starter" });
  assert.equal(sellerVerdict(w, bid(fee * 0.9)).ok, false);
  const t1 = w.teams.T1;
  const cover = [...t1.bench, ...t1.academy].some((id) => w.players[id].position === "mid");
  assert.equal(sellerVerdict(w, bid(fee)).ok, cover);
  assert.equal(sellerVerdict(w, bid(fee * 1.31)).ok, true);
  // 예산 넉넉하게 주고 확정
  // DNS는 1군이 이미 10명(상한)이라 후보 둘만 남긴 상태로 시험 (빠진 후보는 FA로)
  const dns = w.teams[buyer];
  const cut = dns.bench.slice(2);
  const players = { ...w.players, ...Object.fromEntries(cut.map((id) => [id, { ...w.players[id], contract: null }])) };
  const rich = { ...w, players, freeAgents: [...w.freeAgents, ...cut], teams: { ...w.teams, [buyer]: { ...dns, bench: dns.bench.slice(0, 2), transferBudget: 100, cap: 100 } } };
  assert.equal(canAfford(w, { ...bid(fee), fee: 0, salary: 0 }).ok, false); // 1군 인원 초과
  assert.equal(canAfford(rich, bid(fee * 1.31)).ok, true);
  const after = completeBid(rich, bid(fee * 1.31));
  assert.equal(after.players[p.id].contract!.team, buyer);
  assert.equal(after.teams[buyer].starters.mid, p.id);
  assert.ok(!mainRoster(after.teams.T1).includes(p.id));
  assert.ok(Math.abs(after.teams.T1.transferBudget - (w.teams.T1.transferBudget + fee * 1.31)) < 0.11);
  assert.equal(typeof playerAcceptsMove(w, bid(fee)), "boolean");
  assert.ok(POSITIONS.every((pos) => after.teams.T1.starters[pos] !== p.id));
  assert.ok(hashSeed(1) > 0);
});
