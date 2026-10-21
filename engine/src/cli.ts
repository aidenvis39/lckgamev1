// 사용법:
//   node src/cli.ts match GEN T1 [--bo 3] [--seed 7] [--no-fearless]
//   node src/cli.ts season [--seed 1] [--runs 200]
//   node src/cli.ts calibrate [--year 2026] [--seasons 30] [--seed 1] [--full-draft]
//   node src/cli.ts tune [--year 2026] [--iters 300] [--seasons 8] [--seed 1]
//   node src/cli.ts transfer faker clozer [--runs 300]   (같은 포지션 두 선수 맞트레이드 전후 비교)
//   node src/cli.ts tune --intl [--seasons 8]           (해외 팀워크 + 리그 보정만 맞춤. LCK 조절값은 그대로)
//   node src/cli.ts calibrate --intl                      (해외 리그 팀 승률 + 국제전 리그 쌍 승률 비교)
//   node src/cli.ts year [--runs 100] [--seed 1]          (LCK·MSI·월즈 한 해 전체. 우승 분포)
//   node src/cli.ts career [--years 10] [--runs 3]        (다년 커리어 AI끼리: 리그 실력 유지, 성장 곡선, 이적·은퇴)
//   node src/cli.ts tune --career [--stage A|B] [--iters 60] [--years 3] [--runs 4]  (다년 커리어 조절값 튜닝 → data/careerParams.json)
//   --params <파일> 로 다른 조절값 파일을 쓸 수 있다 (실험용)
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { Row } from "./calibrate.ts";
import { loadCareerParams, loadParams, loadTargets, loadUniverse, loadWorldTargets, saveCareerParams, saveParams } from "./data.ts";
import { ageTable, LEAGUES6 } from "./career/metrics.ts";
import { CareerPool, careerSeeds, evaluateCareer, loadAgeTarget, tuneCareer } from "./careerTune.ts";
import { playYear } from "./competition/play.ts";
import { champion, OVERSEAS } from "./competition/year.ts";
import { fitLeagueOffsets, fitOverseasTeamwork, makeInternationalProbe, simulateLeague } from "./worldTune.ts";
import { applyLeagueOffsets, leagueUniverse } from "./universe.ts";
import { lineupOf, swapPlayers } from "./lineup.ts";
import { createRng, hashSeed } from "./rng.ts";
import { playSeason } from "./season.ts";
import { playSeries } from "./series.ts";
import { DEFAULT_PARAMS, type Params } from "./params.ts";
import { buildDraftPool, evaluate, tune } from "./tune.ts";
import type { Position, Side, Universe } from "./types.ts";
import { POSITIONS } from "./types.ts";

const POS_KO: Record<Position, string> = { top: "탑", jng: "정글", mid: "미드", bot: "원딜", sup: "서폿" };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seed: { type: "string", default: "1" },
    bo: { type: "string", default: "3" },
    "no-fearless": { type: "boolean", default: false },
    runs: { type: "string", default: "1" },
    year: { type: "string", default: "2026" },
    seasons: { type: "string", default: "30" },
    iters: { type: "string", default: "300" },
    "full-draft": { type: "boolean", default: false },
    intl: { type: "boolean", default: false },
    games: { type: "string", default: "6" },
    years: { type: "string", default: "10" },
    career: { type: "boolean", default: false },
    stage: { type: "string", default: "A" },
    params: { type: "string" },
  },
});
const [command, ...rest] = positionals;
const seed = Number(values.seed);
const params: Params = values.params ? { ...DEFAULT_PARAMS, ...JSON.parse(readFileSync(values.params, "utf8")) } : loadParams();
const world = applyLeagueOffsets(loadUniverse(), params.leagueOffset); // LCK + 해외 5개 리그
const u = leagueUniverse(world, "LCK"); // 시즌·튜닝·이적 실험은 LCK만

switch (command) {
  case "match":
    match(rest[0] ?? "GEN", rest[1] ?? "T1");
    break;
  case "season":
    season(Number(values.runs));
    break;
  case "calibrate":
    values.intl ? calibrateWorld() : calibrate();
    break;
  case "tune":
    if (values.career) await careerTuneCli(values.stage, Number(values.iters === "300" ? 60 : values.iters), Number(values.years === "10" ? 3 : values.years), Number(values.runs === "1" ? 4 : values.runs));
    else values.intl ? tuneWorld() : runTune();
    break;
  case "year":
    year(Number(values.runs === "1" ? 100 : values.runs));
    break;
  case "career":
    await career(Number(values.years), Number(values.runs === "1" ? 3 : values.runs));
    break;
  case "transfer":
    transfer(rest[0], rest[1], Number(values.runs === "1" ? 300 : values.runs));
    break;
  default:
    console.log("명령: match <팀1> <팀2> | season | calibrate [--intl] | tune [--intl] | year | transfer <선수1> <선수2>   (팀: " + [...world.teams.keys()].join(", ") + ")");
}

function match(a: string, b: string) {
  const bestOf = Number(values.bo) as 1 | 3 | 5;
  const fearless = !values["no-fearless"];
  const s = playSeries(world, lineupOf(world, a), lineupOf(world, b), params, createRng(hashSeed(seed, "cli")), {
    bestOf,
    fearless,
    log: true,
  });
  const champ = (id: string) => world.champions.get(id)!.nameKo;
  console.log(`\n${s.teams[0]} vs ${s.teams[1]}  (BO${bestOf}${fearless ? ", 피어리스" : ""}, seed ${seed})`);
  s.games.forEach((g, i) => {
    const ids: Record<Side, string> = { blue: g.blue, red: g.red };
    const lu = { blue: lineupOf(world, g.blue), red: lineupOf(world, g.red) };
    const r = g.result;
    console.log(`\n━━ ${i + 1}세트 ━━ 블루 ${g.blue} vs 레드 ${g.red}`);
    console.log(`  밴   ${g.blue}: ${g.draft.bans.blue.map(champ).join(", ")}`);
    console.log(`       ${g.red}: ${g.draft.bans.red.map(champ).join(", ")}`);
    for (const pos of POSITIONS) {
      const side = (s2: Side) => {
        const line = r.lines[s2][pos];
        return `${lu[s2].players[pos].name}(${champ(g.draft.picks[s2][pos])}) ${line.kills}/${line.deaths}/${line.assists}`;
      };
      console.log(`  ${pad(POS_KO[pos], 4)} ${pad(side("blue"), 30)} vs  ${side("red")}`);
    }
    console.log("  ── 중계");
    for (const e of r.events) console.log(`  ${clock(e.t)} ${e.side ? `[${ids[e.side]}] ` : ""}${e.text}`);
    console.log(
      `  ── 결과: ${ids[r.winner]} 승리 (${clock(r.duration)})  킬 ${r.kills.blue}:${r.kills.red}  ` +
        `용 ${r.dragons.blue}:${r.dragons.red}  바론 ${r.barons.blue}:${r.barons.red}  포탑 ${r.towers.blue}:${r.towers.red}`,
    );
  });
  console.log(`\n최종: ${s.teams[0]} ${s.score[0]} : ${s.score[1]} ${s.teams[1]}  → ${s.winner} 승리\n`);
}

function season(runs: number) {
  if (runs === 1) {
    const r = playSeason(u, params, createRng(hashSeed(seed, "season")));
    console.log(`\n정규시즌 (더블 라운드로빈, BO3, seed ${seed})\n`);
    console.log("순위  팀    시리즈   세트     득실");
    r.standings.forEach((t, i) =>
      console.log(
        `${pad(String(i + 1), 5)} ${pad(t.team, 5)} ${pad(`${t.seriesWins}-${t.seriesLosses}`, 8)} ${pad(`${t.gameWins}-${t.gameLosses}`, 8)} ${t.gameWins - t.gameLosses >= 0 ? "+" : ""}${t.gameWins - t.gameLosses}`,
      ),
    );
    return;
  }
  // 여러 시즌을 돌려서 팀별 기대 성적
  const draft = buildDraftPool(u, params, seed);
  const stats = new Map<string, { wins: number; rank: number; first: number; top6: number }>();
  for (let i = 0; i < runs; i++) {
    const r = playSeason(u, params, createRng(hashSeed(seed, "season", i)), { draft });
    r.standings.forEach((t, rank) => {
      const s = stats.get(t.team) ?? { wins: 0, rank: 0, first: 0, top6: 0 };
      s.wins += t.seriesWins;
      s.rank += rank + 1;
      s.first += rank === 0 ? 1 : 0;
      s.top6 += rank < 6 ? 1 : 0;
      stats.set(t.team, s);
    });
  }
  console.log(`\n정규시즌 ${runs}회 시뮬 평균 (seed ${seed})\n`);
  console.log("팀    평균 시리즈승  평균 순위  1위 확률  6위 안 확률");
  [...stats.entries()]
    .sort((a, b) => a[1].rank - b[1].rank)
    .forEach(([team, s]) =>
      console.log(
        `${pad(team, 5)} ${pad((s.wins / runs).toFixed(1), 13)} ${pad((s.rank / runs).toFixed(1), 10)} ${pad(pct(s.first / runs), 9)} ${pct(s.top6 / runs)}`,
      ),
    );
}

function calibrate() {
  const targets = loadTargets(values.year);
  const seasons = Number(values.seasons);
  const draft = values["full-draft"] ? undefined : buildDraftPool(u, params, seed);
  const ev = evaluate(u, params, targets, seasons, hashSeed(seed, "calibrate"), draft);
  console.log(`\n시뮬 ${seasons}시즌 (${ev.metrics.games}경기) vs 실제 LCK ${values.year}  — 손실 ${ev.loss.toFixed(2)}\n`);
  printRows(ev.rows);
  console.log("\n라인 영향력 (15분 라인 골드차 표준화 로지스틱 가중치)");
  const real = targets.lane_relative_weight;
  for (const pos of POSITIONS) console.log(`  ${pad(POS_KO[pos], 5)} 시뮬 ${ev.metrics.laneWeight[pos].toFixed(2)}   실제 ${real[pos].toFixed(2)}`);
  console.log("\n팀별 정규시즌 세트 승률 (팀워크: 개인 스탯 밖의 팀 전력, z 단위)");
  const realTeam = targets.team_regular_winrate;
  console.log("  (선수 운영 = 주전 5명 운영 기여 합 × 배율, 팀 고유 = 선수로 설명 안 되는 2026 팀 효과. 둘 다 전투력 단위)");
  for (const team of Object.keys(realTeam).sort((a, b) => realTeam[b] - realTeam[a])) {
    const macro = params.macroWeight * POSITIONS.reduce((s, pos) => s + lineupOf(u, team).players[pos].intangible, 0);
    console.log(`  ${pad(team, 5)} 시뮬 ${pct(ev.metrics.teamWinrate[team])}   실제 ${pct(realTeam[team])}   선수 운영 ${signedFix(macro)}   팀 고유 ${signedFix(params.teamwork[team] ?? 0)}`);
  }
  console.log("\n정규시즌 승률 차이별 강팀 승률");
  const realUpset = new Map(targets.upset_game_level.map(([k, n, wr]) => [k, [n, wr]]));
  for (const [k, n, wr] of ev.metrics.upset) {
    const r = realUpset.get(k);
    console.log(`  ${pad(k, 9)} 시뮬 ${pct(wr)} (${n}경기)   실제 ${r ? `${pct(r[1])} (${r[0]}경기)` : "-"}`);
  }
}

function runTune() {
  const targets = loadTargets(values.year);
  const iterations = Number(values.iters);
  const seasons = Number(values.seasons);
  const started = Date.now();
  const result = tune(u, targets, params, {
    iterations,
    seasons,
    seed,
    onProgress: (i, best) => {
      if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${iterations}  손실 ${best.toFixed(2)}  (${((Date.now() - started) / 1000).toFixed(0)}초)`);
    },
  });
  saveParams(result.params);
  console.log(`\n저장: data/params.json (튜닝 손실 ${result.loss.toFixed(2)}). 검증은 npm run calibrate`);
}

// 해외 리그 팀워크 → 리그 보정. LCK 조절값과 LCK 팀워크는 건드리지 않는다
function tuneWorld() {
  const targets = loadTargets(values.year);
  const wt = loadWorldTargets();
  const base = loadUniverse();
  const log = (m: string) => console.log("  " + m);
  console.log("해외 리그 팀워크");
  let p = fitOverseasTeamwork(base, wt, params, Number(values.seasons), seed, 12, log);
  console.log("국제전 리그 보정");
  p = fitLeagueOffsets(base, targets, wt, p, Number(values.games), seed, 10, log);
  saveParams(p);
  console.log("\n저장: data/params.json. 검증은 npm run calibrate -- --intl");
}

function calibrateWorld() {
  const targets = loadTargets(values.year);
  const wt = loadWorldTargets();
  const base = loadUniverse();
  const cseed = hashSeed(seed, "calibrate-world");
  console.log("\n해외 리그 팀별 세트 승률 (더블 라운드로빈 시뮬 vs 실제 2026 최근 정규 스플릿 2개)");
  for (const lg of OVERSEAS) {
    const sim = simulateLeague(base, lg, params, Number(values.seasons), cseed);
    const real = wt.teamWinrate[lg];
    const ids = Object.keys(real).sort((a, b) => real[b] - real[a]);
    const rmse = Math.sqrt(ids.reduce((a, id) => a + (sim[id] - real[id]) ** 2, 0) / ids.length);
    console.log(`  ${pad(lg, 6)} 오차 ${(rmse * 100).toFixed(1)}%p   ` + ids.map((id) => `${id} ${pct(sim[id])}/${pct(real[id])}`).join("  "));
  }
  console.log(`\n리그 보정 (능력치 점수, LCK = 0): ${Object.entries(params.leagueOffset).map(([k, v]) => `${k} ${signedFix(v)}`).join("  ")}`);
  console.log("\n국제전 리그 쌍 승률: 대표팀(월즈 출전권 수만큼 상위 팀)끼리 맞대결");
  console.log("  (기준 = 2024~2026 국제전 리그 강도 모델, 실제 = 단순 집계. 가중 = 최근 연도 가중 경기 수)");
  const rows = makeInternationalProbe(base, targets, wt, params, Number(values.games), cseed)(params);
  for (const r of rows)
    console.log(`  ${pad(`${r.a} 대 ${r.b}`, 14)} 시뮬 ${pct(r.sim)}   기준 ${pct(r.target)}   실제 ${r.raw === null ? "-" : pct(r.raw)}   가중 ${r.weight.toFixed(1)}`);
  const err = rows.reduce((s, x) => s + x.weight * (x.sim - x.target) ** 2, 0) / rows.reduce((s, x) => s + x.weight, 0);
  console.log(`  가중 오차 ${(Math.sqrt(err) * 100).toFixed(1)}%p`);
}

// 한 해 전체를 여러 번: 대회별 우승 팀·리그 분포
function year(runs: number) {
  const draft = buildDraftPool(world, params, seed);
  const wins: Record<string, Map<string, number>> = { LCK: new Map(), MSI: new Map(), WORLDS: new Map() };
  const region = new Map<string, Map<string, number>>();
  const leagueOf = (t: string) => world.teams.get(t)!.league;
  const started = Date.now();
  for (let i = 0; i < runs; i++) {
    const st = playYear(world, params, hashSeed(seed, "year", i), draft);
    for (const ev of Object.keys(wins)) {
      const c = champion(st, ev)!;
      wins[ev].set(c, (wins[ev].get(c) ?? 0) + 1);
      const r = region.get(ev) ?? new Map<string, number>();
      r.set(leagueOf(c), (r.get(leagueOf(c)) ?? 0) + 1);
      region.set(ev, r);
    }
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${runs} (${((Date.now() - started) / 1000).toFixed(0)}초)`);
  }
  console.log(`\n한 해 ${runs}회 시뮬 (seed ${seed})`);
  for (const ev of Object.keys(wins)) {
    const top = [...wins[ev]].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t} ${pct(n / runs)}`).join("  ");
    const reg = [...region.get(ev)!].sort((a, b) => b[1] - a[1]).map(([lg, n]) => `${lg} ${pct(n / runs)}`).join("  ");
    console.log(`  ${pad(ev, 7)} 우승 리그: ${reg}\n          우승 팀: ${top}`);
  }
}

// 다년 커리어를 AI끼리 돌려 세계가 안정적인지 본다
// 다년 커리어 AI끼리 (worker_threads로 나란히): 리그 수준 유지, 나이별 변화(LCK·CL, 실제와 같은 조건), 은퇴·FA·신인, 월즈 우승 지역
async function career(years: number, runs: number) {
  const pool = new CareerPool();
  const cp = loadCareerParams();
  const target = loadAgeTarget();
  const started = Date.now();
  const res = await evaluateCareer(pool, cp, careerSeeds(seed, runs), years, target);
  pool.close();
  const LG = LEAGUES6;
  console.log(`\n다년 커리어 ${runs}회 × ${years}년 (AI끼리, ${((Date.now() - started) / 1000).toFixed(0)}초)\n`);
  console.log("시즌   " + LG.map((lg) => pad(lg, 7)).join("") + "LCK퍼짐  은퇴  FA   신인  상한초과  월즈 우승");
  const avg = (f: (r: (typeof res.runs)[0]) => number) => res.runs.reduce((s, r) => s + f(r), 0) / res.runs.length;
  for (let yr = 0; yr < years; yr++) {
    console.log(
      `${res.runs[0].seasons[yr]}  ` +
        LG.map((lg) => pad(avg((r) => r.leagueMeans[yr][lg]).toFixed(1), 7)).join("") +
        `${pad(pct(avg((r) => r.lckSpread[yr])), 9)}${pad(avg((r) => r.retired[yr]).toFixed(0), 6)}${pad(avg((r) => r.fa[yr]).toFixed(0), 5)}${pad(avg((r) => r.rookies[yr]).toFixed(0), 6)}${pad(avg((r) => r.overCap[yr]).toFixed(1), 10)}${res.runs.map((r) => r.worlds[yr]).join(" ")}`,
    );
  }
  const b = res.runs[0].baseline;
  console.log(`기준   ${LG.map((lg) => pad(b[lg].toFixed(1), 7)).join("")}15.2%  (2026 실제 로스터)`);
  console.log("  (리그 칸 = 시즌 시작 때 주전 평균 실효 실력(능력 + 운영 기여), LCK퍼짐 = LCK 팀 세트 승률 표준편차)");
  const regions = new Map<string, number>();
  for (const r of res.runs) for (const w of r.worlds) { const lg = w.slice(w.indexOf("(") + 1, -1); regions.set(lg, (regions.get(lg) ?? 0) + 1); }
  console.log(`\n월즈 우승 리그: ${[...regions].sort((a, b) => b[1] - a[1]).map(([lg, n]) => `${lg} ${pct(n / (runs * years))}`).join("  ")}`);
  const sim = ageTable(res.runs);
  console.log("\n나이별 한 해 실력 변화 (LCK 1군 두 해 15세트 이상 · LCK CL 2군, 실제 = 2020~2026 백분위 변화를 부드럽게)");
  for (const t of target) {
    const x = sim.get(t.age);
    if (x) console.log(`  ${t.age}세  시뮬 ${signedFix(x.mean)} (${x.n}쌍)   실제 ${signedFix(t.delta)} (${t.n}쌍)`);
  }
  const l = res.loss;
  console.log(`\n손실 ${l.total.toFixed(3)}: 리그 하락 ${l.drift.toFixed(2)} (LCK 최대 ${l.lckMaxDrift.toFixed(1)}점) · 퍼짐 ${l.spread.toFixed(2)} · 나이 RMSE ${l.ageRmse.toFixed(2)}점 · 격차 ${l.gaps.toFixed(2)} · 모양 ${l.shape.toFixed(2)}`);
  if (res.runs.some((r) => r.rosterErrors)) console.log(`로스터 오류 ${res.runs.reduce((s, r) => s + r.rosterErrors, 0)}건`);
}

async function careerTuneCli(stage: string, iters: number, years: number, runs: number) {
  const best = await tuneCareer(loadCareerParams(), { stage, iters, years, runs, seed, log: (m) => console.log(m) });
  saveCareerParams(best);
  console.log("저장: data/careerParams.json");
}

function transfer(aId: string, bId: string, runs: number) {
  const after = swapPlayers(u, aId, bId);
  const a = u.players.get(aId.toLowerCase())!;
  const b = u.players.get(bId.toLowerCase())!;
  const stats = (uni: Universe) => {
    const draft = buildDraftPool(uni, params, seed);
    const out = new Map<string, { wins: number; games: number; rank: number }>();
    for (let i = 0; i < runs; i++) {
      const r = playSeason(uni, params, createRng(hashSeed(seed, "transfer", i)), { draft });
      r.standings.forEach((t, rank) => {
        const s = out.get(t.team) ?? { wins: 0, games: 0, rank: 0 };
        s.wins += t.gameWins;
        s.games += t.gameWins + t.gameLosses;
        s.rank += rank + 1;
        out.set(t.team, s);
      });
    }
    return out;
  };
  const describe = (x: typeof a) =>
    `${x.name}(${x.team} ${POS_KO[x.position]}) 운영 ${signedFix(x.intangible)}±${x.intangibleSe.toFixed(2)} · ` +
    `라인전 ${x.ratings.laning.toFixed(0)} 한타 ${x.ratings.teamfight.toFixed(0)} 시야 ${x.ratings.vision.toFixed(0)} 생존 ${x.ratings.survival.toFixed(0)}`;
  console.log(`\n맞트레이드: ${describe(a)}\n            ${describe(b)}\n(정규시즌 ${runs}회 평균)\n`);
  const [s0, s1] = [stats(u), stats(after)];
  console.log("팀    세트 승률 (전 → 후)       평균 순위 (전 → 후)");
  for (const team of [a.team, b.team]) {
    const x = s0.get(team)!;
    const y = s1.get(team)!;
    const d = y.wins / y.games - x.wins / x.games;
    console.log(`${pad(team, 5)} ${pct(x.wins / x.games)} → ${pct(y.wins / y.games)} (${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%p)   ${(x.rank / runs).toFixed(1)} → ${(y.rank / runs).toFixed(1)}`);
  }
}

function signedFix(x: number): string {
  return `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
}

function printRows(rows: Row[]) {
  console.log(`${pad("지표", 32)} ${pad("시뮬", 9)} ${pad("실제", 9)} 차이/허용오차`);
  for (const [name, sim, real, scale] of rows) {
    const z = (sim - real) / scale;
    const flag = Math.abs(z) <= 1 ? "✓" : Math.abs(z) <= 2 ? "△" : "✗";
    console.log(`${pad(name, 32)} ${pad(fmt(sim), 9)} ${pad(fmt(real), 9)} ${z >= 0 ? "+" : ""}${z.toFixed(1)} ${flag}`);
  }
}

function fmt(x: number): string {
  return Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(3);
}
function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
function clock(t: number): string {
  return `${String(Math.floor(t)).padStart(2, "0")}:${String(Math.floor((t % 1) * 60)).padStart(2, "0")}`;
}
// 한글은 터미널에서 2칸을 차지한다
function pad(s: string, width: number): string {
  const w = [...s].reduce((n, ch) => n + (/[ᄀ-ᇿ㄰-㆏가-힯]/.test(ch) ? 2 : 1), 0);
  return s + " ".repeat(Math.max(0, width - w));
}

