// 중계: 엔진이 이미 계산한 경기를 시간 순서대로 풀어서 보여준다.
import { useEffect, useMemo, useState } from "react";
import type { GameResult, Lineup, Side, TimelineEntry } from "../../engine.ts";
import { clock, signed } from "../../game/meta.ts";
import { GoldChart, TeamBadge } from "../../ui/bits.tsx";

const SPEEDS = [1, 3, 8] as const;

export function LiveGame({ result, lineups, onFinish }: { result: GameResult; lineups: Record<Side, Lineup>; onFinish: () => void }) {
  const [t, setT] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(3);
  const done = t >= result.duration;

  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setT((x) => Math.min(result.duration, x + 0.1 * speed)), 100);
    return () => clearInterval(id);
  }, [speed, done, result.duration]);

  const stat = (side: Side, kind: TimelineEntry["kind"]) =>
    result.timeline.filter((e) => e.side === side && e.kind === kind && e.t <= t).reduce((n, e) => n + (e.count ?? 1), 0);
  const feed = useMemo(() => result.events.filter((e) => e.t <= t).reverse(), [result.events, t]);
  const gold = goldAt(result, t);

  return (
    <div className="broadcast">
      <div className="stack">
        <div className="scoreboard">
          {(["blue", "red"] as Side[]).map((side, i) => (
            <div key={side} className={`team ${i ? "r" : ""}`} style={{ order: i ? 2 : 0 }}>
              <div className="row" style={{ flexDirection: i ? "row-reverse" : "row" }}>
                <TeamBadge team={lineups[side].team.id} size={26} />
                <span className="kills">{stat(side, "kill")}</span>
              </div>
              <div className="objs" style={{ justifyContent: i ? "flex-end" : "flex-start" }}>
                <span>
                  포탑 <b>{stat(side, "tower")}</b>
                </span>
                <span>
                  용 <b>{stat(side, "dragon")}</b>
                </span>
                <span>
                  바론 <b>{stat(side, "baron")}</b>
                </span>
              </div>
            </div>
          ))}
          <div className="clock" style={{ order: 1 }}>
            <b>{clock(t)}</b>
            <span className="muted" style={{ fontSize: 12 }}>
              골드 {gold === 0 ? "동률" : `${gold > 0 ? lineups.blue.team.id : lineups.red.team.id} ${signed(Math.abs(gold))}`}
            </span>
          </div>
        </div>
        <section className="panel">
          <h2>
            골드 차이 <span className="label">위쪽 블루 우세 · 아래쪽 레드 우세</span>
          </h2>
          <GoldChart points={result.goldTimeline} until={t} duration={result.duration} />
        </section>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <div className="seg" role="group" aria-label="중계 속도">
            {SPEEDS.map((s) => (
              <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s}배속
              </button>
            ))}
          </div>
          {done ? (
            <button className="btn primary" onClick={onFinish}>
              세트 결과 보기
            </button>
          ) : (
            <button className="btn" onClick={() => setT(result.duration)}>
              결과로 건너뛰기
            </button>
          )}
        </div>
      </div>
      <section className="panel">
        <h2>
          중계 <span className="label">최신순</span>
        </h2>
        <div className="feed" aria-live="polite">
          {feed.length === 0 && <div className="empty">곧 라인전이 시작됨</div>}
          {feed.map((e, i) => (
            <div key={`${e.t}-${i}`} className={`feed-item ${e.side ?? ""}`}>
              <span className="t">{clock(e.t)}</span>
              <span>
                {e.side && <b>{lineups[e.side].team.id} </b>}
                {e.text}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// 15분까지는 0에서 15분 골드차까지 직선, 이후엔 교전마다 기록된 값 사이를 잇는다
function goldAt(r: GameResult, t: number): number {
  const pts: Array<[number, number]> = [[0, 0], ...r.goldTimeline];
  for (let i = 1; i < pts.length; i++) {
    const [t1, g1] = pts[i];
    if (t <= t1) {
      const [t0, g0] = pts[i - 1];
      return g0 + ((g1 - g0) * (t - t0)) / (t1 - t0);
    }
  }
  return pts[pts.length - 1][1];
}
