// 한 세트(게임) 시뮬레이션.
//   1) 라인전(0~15분): 포지션별 우위 → 라인 골드차, 첫 킬·첫 용·유충·첫 포탑
//   2) 중후반(15분~): 몇 분마다 교전. 전투력 차이 + 골드차 + 버프로 승자를 정하고,
//      승자가 골드·킬·용·바론·포탑을 가져간다. 포탑이 충분히 밀리면 마무리 시도.
import type { Params } from "./params.ts";
import { sigmoid, type Rng } from "./rng.ts";
import { compScore, fighterPower, mastery, matchupGd15, z } from "./strength.ts";
import type { DraftResult, GameEvent, GameResult, Lineup, PlayerLine, Position, Side, Universe } from "./types.ts";
import { POSITIONS, SIDES, other } from "./types.ts";

const KILL_SHARE: Record<Position, number> = { top: 0.18, jng: 0.22, mid: 0.24, bot: 0.31, sup: 0.05 };
const DEATH_SHARE: Record<Position, number> = { top: 0.2, jng: 0.22, mid: 0.18, bot: 0.19, sup: 0.21 };
const ASSIST_RATE: Record<Position, number> = { top: 0.4, jng: 0.6, mid: 0.5, bot: 0.45, sup: 0.75 };
const POS_KO: Record<Position, string> = { top: "탑", jng: "정글", mid: "미드", bot: "원딜", sup: "서폿" };
const DRAGON_KO = ["화염", "대지", "바다", "바람", "마법공학", "화학공학"];
const TOWERS_TO_END = 7; // 이만큼 부숴야 넥서스를 칠 수 있다 (외곽·내곽·억제기 포탑 중 한 라인 이상)
const MAX_TOWERS = 11;

export interface SimOptions {
  log?: boolean; // 중계 로그 생성 (시즌·튜닝 시엔 끈다)
}

export function simulateGame(
  u: Universe,
  lineups: Record<Side, Lineup>,
  draft: DraftResult,
  p: Params,
  rng: Rng,
  opts: SimOptions = {},
): GameResult {
  const log = opts.log ?? false;
  const events: GameEvent[] = [];
  const say = (t: number, side: Side | undefined, text: string) => {
    if (log) events.push({ t, side, text });
  };
  const pl = (s: Side, pos: Position) => lineups[s].players[pos];
  const ch = (s: Side, pos: Position) => u.champions.get(draft.picks[s][pos])!;
  const who = (s: Side, pos: Position) => `${pl(s, pos).name}(${ch(s, pos).nameKo})`;

  const lines: Record<Side, Record<Position, PlayerLine>> = { blue: emptyLines(), red: emptyLines() };
  const kills = { blue: 0, red: 0 };
  const dragons = { blue: 0, red: 0 };
  const barons = { blue: 0, red: 0 };
  const towers = { blue: 0, red: 0 };
  const elders = { blue: 0, red: 0 };
  let soul: Side | null = null;
  let firstBlood: Side | null = null;
  let firstBaron: Side | null = null;

  const pickWeighted = (w: Record<Position, number>): Position => {
    let r = rng.next() * POSITIONS.reduce((s, pos) => s + w[pos], 0);
    for (const pos of POSITIONS) if ((r -= w[pos]) <= 0) return pos;
    return "sup";
  };
  const addKill = (t: number, s: Side, killer: Position = pickWeighted(KILL_SHARE)) => {
    const victim = pickWeighted(DEATH_SHARE);
    lines[s][killer].kills++;
    lines[other(s)][victim].deaths++;
    kills[s]++;
    for (const pos of POSITIONS) if (pos !== killer && rng.next() < ASSIST_RATE[pos]) lines[s][pos].assists++;
    if (!firstBlood) {
      firstBlood = s;
      say(t, s, `퍼스트 블러드! ${who(s, killer)} → ${who(other(s), victim)}`);
    }
  };

  // 경기마다 선수 컨디션이 조금씩 흔들린다
  const form = { blue: {} as Record<Position, number>, red: {} as Record<Position, number> };
  for (const s of SIDES) for (const pos of POSITIONS) form[s][pos] = p.form * rng.normal();

  // ── 1. 라인전 ──────────────────────────────────────────────
  const edge = {} as Record<Position, number>; // 블루 기준 우위 (표준편차 단위)
  for (const pos of POSITIONS) {
    const [pb, pr, cb, cr] = [pl("blue", pos), pl("red", pos), ch("blue", pos), ch("red", pos)];
    edge[pos] =
      p.laneSkill * (z(pb.ratings.laning) - z(pr.ratings.laning)) +
      p.laneChamp * (cb.early - cr.early) +
      p.laneMeta * (cb.meta - cr.meta) +
      p.laneMastery * (mastery(pb, cb.id) - mastery(pr, cr.id)) +
      (p.laneMatchup * matchupGd15(u, pos, cb.id, cr.id)) / p.laneSd[pos] +
      form.blue[pos] - form.red[pos];
  }
  const lane = { ...edge };
  lane.bot += p.supportSynergy * edge.sup;
  for (const pos of ["top", "mid", "bot"] as Position[]) lane[pos] += p.jungleGank * edge.jng;

  const laneGd15 = {} as Record<Position, number>;
  for (const pos of POSITIONS) laneGd15[pos] = Math.round(p.laneSd[pos] * (lane[pos] + p.laneNoise * rng.normal()));

  const vision = POSITIONS.reduce((s, pos) => s + z(pl("blue", pos).ratings.vision) - z(pl("red", pos).ratings.vision), 0) / 5;
  const control = (x: number): Side => (rng.next() < sigmoid(p.objControl * x + 0.3 * vision) ? "blue" : "red");

  // 공허 유충 (6분)
  const grubs = control(lane.jng + 0.5 * lane.top);
  say(6 + rng.next(), grubs, "공허 유충 획득");
  // 첫 용 (5~8분), 두 번째 용 (+5~6분)
  let tDragon = 5 + 3 * rng.next();
  const firstDragon = control(lane.jng + 0.5 * (lane.bot + lane.sup));
  takeDragon(firstDragon, tDragon);
  tDragon += 5 + rng.next();
  takeDragon(control(lane.jng + 0.5 * (lane.bot + lane.sup)), tDragon);

  // 15분까지의 킬: 라인 골드차가 큰 쪽이 따낸다
  const earlyKills = Math.max(1, rng.poisson(p.killsAt15));
  const killTimes = Array.from({ length: earlyKills }, () => 2 + 13 * rng.next()).sort((a, b) => a - b);
  for (const t of killTimes) {
    const pos = pickWeighted(KILL_SHARE);
    const s: Side = rng.next() < sigmoid((1.2 * laneGd15[pos]) / p.laneSd[pos]) ? "blue" : "red";
    addKill(t, s, pos);
  }

  let gold = POSITIONS.reduce((s, pos) => s + laneGd15[pos], 0) + (grubs === "blue" ? 300 : -300);
  const gd15 = gold;
  // 같은 골드라도 원딜·미드 우위가 탑 우위보다 교전에 크게 작용한다
  const laneBonus = POSITIONS.reduce((s, pos) => s + (p.laneValue[pos] - 1) * laneGd15[pos], 0);
  const firstTower: Side = rng.next() < sigmoid(gd15 / 1500) ? "blue" : "red";
  towers[firstTower]++;
  say(11 + 4 * rng.next(), firstTower, "첫 포탑 파괴");
  const herald = control(lane.jng + 0.5 * (lane.top + lane.mid));
  towers[herald]++;
  gold += herald === "blue" ? 300 : -300;
  if (log) {
    const lead = gd15 >= 0 ? 1 : -1; // 앞선 팀 기준으로 표시
    const lanes = POSITIONS.map((pos) => `${POS_KO[pos]} ${signed(lead * laneGd15[pos])}`).join(" / ");
    say(15, gd15 >= 0 ? "blue" : "red", `15분 골드 ${signed(lead * gd15)} (${lanes})`);
    say(15.2, herald, "전령 획득");
  }
  const goldTimeline: Array<[number, number]> = [[15, gd15]];

  // ── 2. 중후반 교전 ─────────────────────────────────────────
  const comp = { blue: compScore(u, draft.picks.blue, p), red: compScore(u, draft.picks.red, p) };
  const roleSum = POSITIONS.reduce((s, pos) => s + p.roleWeight[pos], 0);
  const baronUntil = { blue: -1, red: -1 };
  const elderUntil = { blue: -1, red: -1 };
  let nextDragon = tDragon + 5;
  let nextBaron = 20;
  let nextElder = Infinity;
  let t = 15;
  let winner: Side | null = null;

  const power = (s: Side, now: number): number => {
    let v = 0;
    for (const pos of POSITIONS) v += p.roleWeight[pos] * (fighterPower(pl(s, pos), ch(s, pos), now, p) + form[s][pos]);
    v = v / roleSum + comp[s] + (p.teamwork[lineups[s].team.id] ?? 0) + p.drakeBuff * dragons[s];
    if (soul === s) v += p.soulBuff;
    if (baronUntil[s] > now) v += p.baronBuff;
    if (elderUntil[s] > now) v += p.elderBuff;
    return v;
  };

  while (winner === null) {
    t += p.windowMin + (p.windowMax - p.windowMin) * rng.next();
    const x = p.fightSkill * (power("blue", t) - power("red", t)) + (p.fightGold * (gold + laneBonus)) / 1000 + p.sideBonus;
    const w: Side = rng.next() < sigmoid(x) ? "blue" : "red";
    const sign = w === "blue" ? 1 : -1;
    let swing = Math.max(150, p.swingMean + p.swingSd * rng.normal());
    let wonTowers = 1;

    const kw = rng.poisson(p.killsPerFight);
    const kl = rng.poisson(p.killsPerFight * p.loserKillRatio);
    for (let i = 0; i < kw; i++) addKill(t, w);
    for (let i = 0; i < kl; i++) addKill(t, other(w));
    let what = "";
    if (soul && t >= nextElder) {
      elders[w]++;
      elderUntil[w] = t + 2.5;
      nextElder = t + 6;
      wonTowers++;
      what = "장로 용";
    } else if (t >= nextBaron && rng.next() < p.baronContest) {
      barons[w]++;
      firstBaron ??= w;
      baronUntil[w] = t + 3;
      nextBaron = t + 6;
      swing += p.baronGold;
      wonTowers++;
      what = "바론";
    } else if (!soul && t >= nextDragon) {
      what = takeDragon(w, t, false);
      nextDragon = t + 5;
    }
    if (baronUntil[w] > t) wonTowers++;
    towers[w] = Math.min(MAX_TOWERS, towers[w] + wonTowers);
    gold += sign * swing;
    goldTimeline.push([round1(t), Math.round(gold)]);
    if (log) say(t, w, `교전 승리 ${kw}:${kl}${what ? ` → ${what}` : ""} (골드 차이 ${signed(sign * gold)})`);

    if (towers[w] >= TOWERS_TO_END && t >= 20) {
      const buffed = baronUntil[w] > t || elderUntil[w] > t ? 1 : 0;
      const end = sigmoid(p.endBase + (p.endGold * sign * gold) / 1000 + p.endBaron * buffed + p.endTime * (t - 30));
      if (rng.next() < end || t > 60) winner = w;
    }
  }

  const duration = round1(t + 0.5 + rng.next());
  towers[winner] = Math.min(MAX_TOWERS, towers[winner] + 1); // 마무리 과정에서 부수는 포탑
  say(duration, winner, `넥서스 파괴 — ${lineups[winner].team.id} 승리`);
  events.sort((a, b) => a.t - b.t);

  return {
    winner,
    duration,
    gd15,
    laneGd15,
    kills,
    dragons,
    barons,
    towers,
    elders,
    soul,
    firsts: { blood: firstBlood ?? "blue", dragon: firstDragon, tower: firstTower, baron: firstBaron },
    goldTimeline,
    lines,
    events,
  };

  function takeDragon(s: Side, at: number, announce = true): string {
    dragons[s]++;
    const kind = DRAGON_KO[rng.int(DRAGON_KO.length)];
    if (dragons[s] === 4 && !soul) {
      soul = s;
      nextElder = at + 6;
      if (announce) say(at, s, `${kind} 용 → 용의 영혼`);
      return `${kind} 용 (영혼)`;
    }
    if (announce) say(at, s, `${kind} 용`);
    return `${kind} 용`;
  }
}

function emptyLines(): Record<Position, PlayerLine> {
  return Object.fromEntries(POSITIONS.map((pos) => [pos, { kills: 0, deaths: 0, assists: 0 }])) as Record<Position, PlayerLine>;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const signed = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x).toLocaleString("en-US")}`;
