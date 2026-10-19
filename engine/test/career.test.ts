import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAcademy, loadCareerParams, loadParams, loadRaw, loadStart2025, loadUniverse, loadWorldTargets } from "../src/data.ts";
import { CHECKPOINTS, crossedCheckpoints, type Checkpoint } from "../src/career/develop.ts";
import { aiOffseason, aiOpening, newYearFor, playCareerSeason } from "../src/career/play.ts";
import { canAfford, completeBid, playerAcceptsMove, sellerVerdict, type Bid } from "../src/career/market.ts";
import { initWorld, mainRoster, validateWorld } from "../src/career/world.ts";
import { applyTrade, bidFor, demote, evaluateTrade, promote, resignMine, salaryNeeded, setStarter, toggleFocus } from "../src/career/userMarket.ts";
import { overall, salaryDemand, transferFee } from "../src/career/value.ts";
import { endDay, recordResult, todayMatches } from "../src/competition/year.ts";
import { hashSeed } from "../src/rng.ts";
import { POSITIONS } from "../src/types.ts";

const base = loadUniverse();
const params = loadParams();
// 2025 시즌 끝 세계 (첫 스토브리그 전)와, AI가 첫 스토브리그를 마친 2026 시즌 시작 세계
const opening = (seed = 1) => initWorld({ ...loadRaw(), academy: loadAcademy(), params, world: loadWorldTargets(), start: loadStart2025(), cp: loadCareerParams(), seed });
const fresh = (seed = 1) => aiOpening(opening(seed), base);

test("커리어 시작: 로스터 불변식, 세계 공통 능력치, 2군 포함, 연봉 합 ≤ 상한", () => {
  const w = fresh();
  assert.deepEqual(validateWorld(w), []);
  assert.ok(Object.values(w.players).every((p) => p.ratingLeague === "GLOBAL" && (p.retired || p.contract || w.freeAgents.includes(p.id))));
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
      assert.equal(w.history.length, i + 2); // 2025 실제 기록 + 치른 시즌
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

test("사용자 시장: 재계약 최소 연봉, 트레이드 평가·적용, 2군 승격·강등, 집중 육성 2명", () => {
  const w = fresh();
  // 재계약: 필요한 연봉보다 낮으면 거절, 이상이면 수락
  const keria = w.players[w.teams.T1.starters.sup];
  const need = salaryNeeded(w, keria, "T1", "starter");
  assert.equal(resignMine(w, keria.id, Math.max(0.3, need - 0.5), 2).ok, need - 0.5 < 0.3);
  const re = resignMine({ ...w, teams: { ...w.teams, T1: { ...w.teams.T1, cap: 200 } } }, keria.id, need, 2);
  assert.ok(re.ok, re.reason);
  assert.equal(re.world.players[keria.id].contract!.endSeason, w.season + 2);
  // 트레이드: 같은 포지션 1:1, 가치가 모자라면 거절 이유, 넉넉하면 수락 후 주전 자리가 채워짐
  const give = w.teams.DNS.starters.top;
  const get = w.teams.GEN.starters.top; // Kiin
  const low = evaluateTrade(w, { from: "DNS", to: "GEN", give: [give], get: [get], fee: 0 });
  assert.equal(low.ok, false);
  assert.match(low.reason, /가치|상한|예산/);
  const rich = { ...w, teams: { ...w.teams, DNS: { ...w.teams.DNS, transferBudget: 500, cap: 500 } } };
  const big = applyTrade(rich, { from: "DNS", to: "GEN", give: [give], get: [get], fee: 60 });
  assert.ok(big.ok, big.reason);
  assert.equal(big.world.players[get].contract!.team, "DNS");
  assert.equal(big.world.players[give].contract!.team, "GEN");
  assert.deepEqual(validateWorld(big.world), []);
  assert.ok(POSITIONS.every((pos) => big.world.teams.GEN.starters[pos] && big.world.teams.DNS.starters[pos]));
  // 2군 승격 → 주전 → 강등은 후보만
  const acad = w.teams.T1.academy[0];
  const pos = w.players[acad].position;
  const t1 = { ...w, teams: { ...w.teams, T1: { ...w.teams.T1, cap: 200, bench: w.teams.T1.bench.slice(0, 2) } } };
  const cut = w.teams.T1.bench.slice(2);
  const t1w = { ...t1, players: { ...t1.players, ...Object.fromEntries(cut.map((id) => [id, { ...t1.players[id], contract: null }])) }, freeAgents: [...t1.freeAgents, ...cut] };
  const up = promote(t1w, "T1", acad);
  assert.ok(up.ok, up.reason);
  const st = setStarter(up.world, "T1", pos, acad);
  assert.ok(st.ok, st.reason);
  assert.equal(demote(st.world, "T1", acad).ok, false); // 주전은 못 내림
  assert.deepEqual(validateWorld(st.world), []);
  // 집중 육성은 2명까지
  let f = toggleFocus(w, "T1", w.teams.T1.starters.top).world;
  f = toggleFocus(f, "T1", w.teams.T1.starters.mid).world;
  assert.equal(toggleFocus(f, "T1", w.teams.T1.starters.bot).ok, false);
  assert.ok(bidFor(w, { team: "T1", player: w.teams.T1.starters.mid, fee: 1, salary: 1, years: 1, role: "starter" }).reason.includes("이미 우리 선수"));
});
