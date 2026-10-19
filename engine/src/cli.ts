// 사용법:
//   node src/cli.ts match GEN T1 [--bo 3] [--seed 7] [--no-fearless]
//   node src/cli.ts season [--seed 1] [--runs 200]
//   node src/cli.ts calibrate [--year 2026] [--seasons 30] [--seed 1] [--full-draft]
//   node src/cli.ts tune [--year 2026] [--iters 300] [--seasons 8] [--seed 1]
import { parseArgs } from "node:util";
import type { Row } from "./calibrate.ts";
import { loadParams, loadTargets, loadUniverse, saveParams } from "./data.ts";
import { lineupOf } from "./lineup.ts";
import { createRng, hashSeed } from "./rng.ts";
import { playSeason } from "./season.ts";
import { playSeries } from "./series.ts";
import { buildDraftPool, evaluate, tune } from "./tune.ts";
import type { Position, Side } from "./types.ts";
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
  },
});
const [command, ...rest] = positionals;
const seed = Number(values.seed);
const u = loadUniverse();
const params = loadParams();

switch (command) {
  case "match":
    match(rest[0] ?? "GEN", rest[1] ?? "T1");
    break;
  case "season":
    season(Number(values.runs));
    break;
  case "calibrate":
    calibrate();
    break;
  case "tune":
    runTune();
    break;
  default:
    console.log("명령: match <팀1> <팀2> | season | calibrate | tune   (팀: " + [...u.teams.keys()].join(", ") + ")");
}

function match(a: string, b: string) {
  const bestOf = Number(values.bo) as 1 | 3 | 5;
  const fearless = !values["no-fearless"];
  const s = playSeries(u, lineupOf(u, a), lineupOf(u, b), params, createRng(hashSeed(seed, "cli")), {
    bestOf,
    fearless,
    log: true,
  });
  const champ = (id: string) => u.champions.get(id)!.nameKo;
  console.log(`\n${s.teams[0]} vs ${s.teams[1]}  (BO${bestOf}${fearless ? ", 피어리스" : ""}, seed ${seed})`);
  s.games.forEach((g, i) => {
    const ids: Record<Side, string> = { blue: g.blue, red: g.red };
    const lu = { blue: lineupOf(u, g.blue), red: lineupOf(u, g.red) };
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

