// 선수 가치: 운영 기여(공개 추정치)·우승 경력이 연봉에 들어가고, 숨은 운영 능력은 뛸수록 드러난다
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAcademy, loadCareerParams, loadParams, loadRaw, loadStart2025, loadWorldTargets } from "../src/data.ts";
import { seasonMacro } from "../src/career/macro.ts";
import { makeRookie } from "../src/career/rookies.ts";
import { emptyStats } from "../src/career/types.ts";
import { effective, fame, famePremium, marketRating, overall, salaryDemand } from "../src/career/value.ts";
import { initWorld } from "../src/career/world.ts";
import { createRng } from "../src/rng.ts";

const w = initWorld({ ...loadRaw(), academy: loadAcademy(), params: loadParams(), world: loadWorldTargets(), start: loadStart2025(), cp: loadCareerParams(), seed: 1 });

test("Faker: 운영 기여만큼 실효 실력이 높고, 우승 경력으로 인지도 할증, 요구 연봉이 경기 능력만 볼 때보다 크다", () => {
  const f = w.players.faker;
  assert.ok(effective(w, f) > overall(f.ratings) + 15);
  assert.ok(marketRating(w, f) - overall(f.ratings) <= w.cp.macro.priceCap + 1e-9);
  assert.ok(fame(w, f) > 2 && famePremium(w, f) > 0.2);
  assert.ok(salaryDemand(w, f) >= 4, `${salaryDemand(w, f)}`);
  // 우승 경력이 없는 선수는 할증 없음
  const none = Object.values(w.players).find((p) => !p.careerTitles.length)!;
  assert.equal(famePremium(w, none), 0);
});

test("숨은 운영 능력: 신인은 리그 평균에서 시작하고, 시즌마다 뛴 만큼 추정치가 진짜 값에 다가간다", () => {
  const rng = createRng(3);
  const rookies = Array.from({ length: 400 }, () => makeRookie(w, "LCK", "mid", null, false, rng));
  const mean = rookies.reduce((s, p) => s + p.macroTrue, 0) / rookies.length;
  const sd = Math.sqrt(rookies.reduce((s, p) => s + (p.macroTrue - mean) ** 2, 0) / rookies.length);
  assert.ok(Math.abs(mean - w.cp.macro.newMean.LCK) < 0.02, `평균 ${mean}`);
  assert.ok(Math.abs(sd - w.cp.macro.newSd) < 0.02, `퍼짐 ${sd}`);
  assert.ok(rookies.every((p) => p.intangible === w.cp.macro.newMean.LCK && !p.intangibleKnown));
  // 한 신인을 20시즌 뛰게 하면 추정 불확실성이 줄고 진짜 값에 수렴
  const r = { ...rookies[0], id: "test-rookie", careerGames: 1000 }; // 경험 성장 없이 관찰만
  let x = { ...w, players: { ...w.players, [r.id]: r } };
  const stats = { ...emptyStats(), games: { [r.id]: 80 } };
  let se = r.intangibleSe;
  for (let s = 0; s < 20; s++) {
    x = seasonMacro({ ...x, season: 2026 + s }, stats);
    assert.ok(x.players[r.id].intangibleSe < se + 1e-9);
    se = x.players[r.id].intangibleSe;
  }
  assert.ok(Math.abs(x.players[r.id].intangible - r.macroTrue) < 0.06, `추정 ${x.players[r.id].intangible} / 진짜 ${r.macroTrue}`);
  assert.ok(x.players[r.id].intangibleKnown);
});

test("경험이 쌓이는 동안 진짜 운영 능력이 오른다 (learnGames 세트까지)", () => {
  const r = { ...makeRookie(w, "LCK", "jng", null, false, createRng(9)), id: "learner", careerGames: 0, macroTrue: 0 }; // 상한(maxAbs)에 안 걸리게
  let x = { ...w, players: { ...w.players, [r.id]: r } };
  for (let s = 0; s < 6; s++) x = seasonMacro({ ...x, season: 2026 + s }, { ...emptyStats(), games: { [r.id]: 100 } });
  const gained = x.players[r.id].macroTrue - r.macroTrue;
  assert.ok(Math.abs(gained - w.cp.macro.learn) < 0.002, `${gained}`);
  assert.equal(x.players[r.id].careerGames, 600);
});
