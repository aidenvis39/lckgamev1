import { useEffect, useMemo, useRef, useState } from "react";
import { baseUniverse, POSITIONS, type Player, type Position } from "../engine.ts";
import { macroGrade, pct, POS_KO, TEAM_STYLE } from "../game/meta.ts";
import { TeamBadge } from "../ui/bits.tsx";
import type { LabMessage, TeamOutcome } from "../workers/lab.worker.ts";

const RUNS = 100;

export function Lab() {
  const [pos, setPos] = useState<Position>("mid");
  const players = useMemo(
    () => [...baseUniverse.players.values()].filter((p) => p.position === pos).sort((a, b) => a.team.localeCompare(b.team) || b.games2026 - a.games2026),
    [pos],
  );
  const [a, setA] = useState("faker");
  const [b, setB] = useState("clozer");
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ a: Player; b: Player; before: Record<string, TeamOutcome>; after: Record<string, TeamOutcome> } | null>(null);
  const worker = useRef<Worker | null>(null);

  useEffect(() => () => worker.current?.terminate(), []);
  useEffect(() => {
    if (!players.some((p) => p.id === a)) setA(players[0]?.id ?? "");
    if (!players.some((p) => p.id === b)) setB(players.find((p) => p.team !== players[0]?.team)?.id ?? "");
  }, [players, a, b]);

  const pa = baseUniverse.players.get(a);
  const pb = baseUniverse.players.get(b);
  const sameTeam = pa && pb && pa.team === pb.team;

  const run = () => {
    if (!pa || !pb || sameTeam) return;
    worker.current?.terminate();
    const w = new Worker(new URL("../workers/lab.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    setProgress(0);
    setResult(null);
    w.onmessage = (e: MessageEvent<LabMessage>) => {
      if (e.data.type === "progress") setProgress(e.data.done / e.data.total);
      else {
        setResult({ a: pa, b: pb, before: e.data.before, after: e.data.after });
        setProgress(null);
        w.terminate();
      }
    };
    w.postMessage({ a, b, runs: RUNS, seed: 7 });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">이적 실험실</span>
          <h1>이 선수를 데려오면?</h1>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>
        같은 포지션 두 선수를 맞트레이드한 뒤 정규시즌을 {RUNS}번씩 돌려 전후 성적을 비교함. 개인 능력치와 챔피언 숙련도,
        운영 기여가 모두 선수를 따라감.
      </p>
      <section className="panel stack">
        <div className="seg" role="group" aria-label="포지션">
          {POSITIONS.map((p) => (
            <button key={p} aria-pressed={pos === p} onClick={() => setPos(p)}>
              {POS_KO[p]}
            </button>
          ))}
        </div>
        <div className="lab-pick">
          <PlayerSelect id="lab-a" label="선수 A" value={a} onChange={setA} players={players} />
          <span className="muted" style={{ paddingBottom: 10, textAlign: "center" }}>
            ⇄
          </span>
          <PlayerSelect id="lab-b" label="선수 B" value={b} onChange={setB} players={players} />
        </div>
        {sameTeam && <p className="chip bad" style={{ alignSelf: "start" }}>같은 팀 선수끼리는 바꿀 수 없음</p>}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button className="btn primary" onClick={run} disabled={!pa || !pb || !!sameTeam || progress !== null}>
            시즌 {RUNS}회씩 시뮬레이션
          </button>
          {progress !== null && (
            <div className="stack" style={{ flex: "1 1 200px", gap: 4 }}>
              <span className="muted" style={{ fontSize: 13 }}>
                계산 중 {Math.round(progress * 100)}%
              </span>
              <div className="progress">
                <i style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )}
        </div>
      </section>
      {result && (
        <section className="panel">
          <h2>
            {result.a.name} ⇄ {result.b.name}
            <span className="label">정규시즌 {RUNS}회 평균</span>
          </h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>팀</th>
                  <th>세트 승률</th>
                  <th>변화</th>
                  <th>평균 순위</th>
                  <th>레전드 그룹</th>
                </tr>
              </thead>
              <tbody>
                {[result.a.team, result.b.team].map((t) => {
                  const [x, y] = [result.before[t], result.after[t]];
                  const d = y.winrate - x.winrate;
                  return (
                    <tr key={t}>
                      <td>
                        <div className="row">
                          <TeamBadge team={t} size={22} />
                          {TEAM_STYLE[t].name}
                        </div>
                      </td>
                      <td className="num">
                        {pct(x.winrate)} → {pct(y.winrate)}
                      </td>
                      <td className={`num delta ${d >= 0 ? "up" : "down"}`}>
                        {d >= 0 ? "+" : "−"}
                        {Math.abs(d * 100).toFixed(1)}%p
                      </td>
                      <td className="num">
                        {x.rank.toFixed(1)} → {y.rank.toFixed(1)}
                      </td>
                      <td className="num">
                        {pct(x.legend, 0)} → {pct(y.legend, 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function PlayerSelect({ id, label, value, onChange, players }: { id: string; label: string; value: string; onChange: (v: string) => void; players: Player[] }) {
  const p = players.find((x) => x.id === value);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {players.map((x) => (
          <option key={x.id} value={x.id}>
            {x.team} · {x.name}
            {x.starter ? "" : " (후보)"}
          </option>
        ))}
      </select>
      {p && (
        <span className="muted" style={{ fontSize: 12 }}>
          라인전 {Math.round(p.ratings.laning)} · 한타 {Math.round(p.ratings.teamfight)} · 운영 {macroGrade(p.intangible).label}
        </span>
      )}
    </div>
  );
}
