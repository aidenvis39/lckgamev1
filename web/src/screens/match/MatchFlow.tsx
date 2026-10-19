// 내 시리즈 진행: 밴픽 → 중계 → 세트 결과 → (진 팀이 진영 선택) → 다음 세트 … → 시리즈 결과
import { useMemo, useState } from "react";
import { lineupOf, params, POSITIONS, simulateGame, type DraftResult, type GameResult, type Side } from "../../engine.ts";
import { recordUserSeries, seriesRng, universeFor, type Career, type SeriesRecord } from "../../game/career.ts";
import { clock, TEAM_STYLE } from "../../game/meta.ts";
import { TeamBadge } from "../../ui/bits.tsx";
import { DraftBoard } from "./DraftBoard.tsx";
import { GameReport } from "./GameReport.tsx";
import { LiveGame } from "./LiveGame.tsx";

interface PlayedGame {
  blue: string;
  red: string;
  draft: DraftResult;
  result: GameResult;
}

type Phase = "draft" | "live" | "report" | "side" | "end";
const WINS_NEEDED = 2;

export function MatchFlow({ career, series, onDone, onLeave }: { career: Career; series: SeriesRecord; onDone: (r: SeriesRecord) => void; onLeave: () => void }) {
  const u = useMemo(() => universeFor(career), [career]);
  const me = career.teamId;
  const opp = series.home === me ? series.away : series.home;
  const [games, setGames] = useState<PlayedGame[]>([]);
  const [sides, setSides] = useState({ blue: series.home, red: series.away });
  const [phase, setPhase] = useState<Phase>("draft");
  const [current, setCurrent] = useState<PlayedGame | null>(null);
  const [leaving, setLeaving] = useState(false);

  const lineups = useMemo(() => ({ blue: lineupOf(u, sides.blue), red: lineupOf(u, sides.red) }), [u, sides]);
  const userSide: Side = sides.blue === me ? "blue" : "red";
  const rng = useMemo(() => seriesRng(career, series, `g${games.length}`), [career, series, games.length]);
  const used = useMemo(() => games.flatMap((g) => (["blue", "red"] as Side[]).flatMap((s) => POSITIONS.map((p) => g.draft.picks[s][p]))), [games]);
  const winnerOf = (g: PlayedGame) => (g.result.winner === "blue" ? g.blue : g.red);
  const scoreOf = (list: PlayedGame[]): [number, number] => [
    list.filter((g) => winnerOf(g) === series.home).length,
    list.filter((g) => winnerOf(g) === series.away).length,
  ];
  const shown = current && phase !== "draft" && phase !== "live" ? [...games, current] : games;
  const score = scoreOf(shown);
  const seriesOver = Math.max(...score) >= WINS_NEEDED;

  const onDraftDone = (draft: DraftResult) => {
    const result = simulateGame(u, lineups, draft, params, rng.fork("sim"), { log: true });
    setCurrent({ blue: sides.blue, red: sides.red, draft, result });
    setPhase("live");
  };

  const nextGame = () => {
    const done = [...games, current!];
    setGames(done);
    setCurrent(null);
    if (Math.max(...scoreOf(done)) >= WINS_NEEDED) return setPhase("end");
    const last = done[done.length - 1];
    const winner = winnerOf(last);
    const loser = winner === last.blue ? last.red : last.blue;
    if (loser === me) return setPhase("side");
    setSides({ blue: loser, red: winner }); // AI가 지면 블루를 고른다
    setPhase("draft");
  };

  const chooseSide = (side: Side) => {
    setSides(side === "blue" ? { blue: me, red: opp } : { blue: opp, red: me });
    setPhase("draft");
  };

  const finish = () => {
    onDone(
      recordUserSeries(
        series,
        games.map((g) => ({ blue: g.blue, red: g.red, draft: { picks: g.draft.picks }, result: g.result })),
        scoreOf(games),
      ),
    );
  };

  const gameNo = games.length + 1;
  const seriesWinner = score[0] > score[1] ? series.home : series.away;

  return (
    <main className="match" aria-label="경기">
      <div className="match-inner">
        <div className="series-bar">
          <div className="t">
            <TeamBadge team={series.home} size={30} />
            <strong>{TEAM_STYLE[series.home].name}</strong>
          </div>
          <div className="s">
            {score[0]} : {score[1]}
            <small>
              {phase === "end" ? "시리즈 종료" : `${gameNo}세트`} · BO3 · 피어리스
            </small>
          </div>
          <div className="t r">
            <strong>{TEAM_STYLE[series.away].name}</strong>
            <TeamBadge team={series.away} size={30} />
          </div>
        </div>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {phase !== "end" && `이번 세트: 블루 ${sides.blue} · 레드 ${sides.red}`}
            {used.length > 0 && phase === "draft" && ` · 피어리스로 막힌 챔피언 ${used.length}개`}
          </span>
          {phase !== "end" &&
            (leaving ? (
              <span className="row">
                <span className="muted" style={{ fontSize: 13 }}>
                  지금 나가면 이 시리즈는 처음부터 다시 함
                </span>
                <button className="btn small" onClick={onLeave}>
                  나가기
                </button>
                <button className="btn small ghost" onClick={() => setLeaving(false)}>
                  계속하기
                </button>
              </span>
            ) : (
              <button className="btn small ghost" onClick={() => setLeaving(true)}>
                나중에 하기
              </button>
            ))}
        </div>

        {phase === "draft" && <DraftBoard key={games.length} ctx={{ u, lineups, p: params }} userSide={userSide} unavailable={used} rng={rng.fork("draft")} onDone={onDraftDone} />}
        {phase === "live" && current && <LiveGame result={current.result} lineups={lineups} onFinish={() => setPhase("report")} />}
        {phase === "report" && current && (
          <GameReport result={current.result} draft={current.draft} lineups={lineups}>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn primary" onClick={nextGame}>
                {seriesOver ? "시리즈 결과" : winnerOf(current) === me ? "다음 세트" : "다음 세트 진영 고르기"}
              </button>
            </div>
          </GameReport>
        )}
        {phase === "side" && (
          <section className="panel stack" style={{ alignItems: "flex-start" }}>
            <h2>다음 세트 진영 선택</h2>
            <p className="muted" style={{ margin: 0 }}>
              진 팀이 진영을 고름. 2026 LCK에선 블루가 56% 이겼음. 레드는 마지막 픽으로 카운터를 칠 수 있음.
            </p>
            <div className="row">
              <button className="btn" style={{ borderColor: "var(--blue)" }} onClick={() => chooseSide("blue")}>
                블루 진영
              </button>
              <button className="btn" style={{ borderColor: "var(--red)" }} onClick={() => chooseSide("red")}>
                레드 진영
              </button>
            </div>
          </section>
        )}
        {phase === "end" && (
          <section className="stack">
            <div className="winner-banner">
              <TeamBadge team={seriesWinner} size={44} />
              <div className="stack" style={{ gap: 2 }}>
                <h2>{seriesWinner === me ? "시리즈 승리" : "시리즈 패배"}</h2>
                <span className="muted">
                  {TEAM_STYLE[series.home].name} {score[0]} : {score[1]} {TEAM_STYLE[series.away].name}
                </span>
              </div>
            </div>
            <section className="panel">
              {games.map((g, i) => (
                <div className="result-row" key={i}>
                  <span className="label">{i + 1}세트</span>
                  <TeamBadge team={winnerOf(g)} size={20} />
                  <span className="w">{TEAM_STYLE[winnerOf(g)].name} 승</span>
                  <span className="muted num">{clock(g.result.duration)}</span>
                  <span className="muted">
                    킬 {g.result.kills.blue}:{g.result.kills.red} (블루 {g.blue})
                  </span>
                </div>
              ))}
            </section>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn primary" onClick={finish}>
                결과 저장하고 다른 경기 진행
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
