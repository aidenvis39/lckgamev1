// 내 시리즈 진행: 밴픽 → 중계 → 세트 결과 → (진 팀이 진영 선택) → 다음 세트 … → 시리즈 결과
// 세트가 끝날 때마다 진행을 저장해서, 나갔다 와도 그 세트부터 이어서 한다 (밴픽 중간은 저장 안 함)
import { useMemo, useState } from "react";
import { lineupOf, POSITIONS, simulateGame, type DraftResult, type Match, type Side } from "../../engine.ts";
import { paramsFor, seriesRng, universeFor, type Career, type PlayedGame, type SeriesProgress } from "../../game/career.ts";
import { clock, TEAM_STYLE } from "../../game/meta.ts";
import { TeamBadge } from "../../ui/bits.tsx";
import { DraftBoard } from "./DraftBoard.tsx";
import { GameReport } from "./GameReport.tsx";
import { LiveGame } from "./LiveGame.tsx";

type Phase = "draft" | "live" | "report" | "side" | "end";

interface Props {
  career: Career;
  match: Match;
  onDone: (games: PlayedGame[]) => void;
  onLeave: () => void;
  onProgress: (p: SeriesProgress) => void;
}

export function MatchFlow({ career, match, onDone, onLeave, onProgress }: Props) {
  // 진행 저장(progress)만 바뀔 땐 세계·출전 기록이 그대로라 같은 Universe를 쓴다
  const u = useMemo(() => universeFor(career), [career.world, career.stats]);
  const params = useMemo(() => paramsFor(career), [career.world, career.stats]);
  const me = career.teamId;
  const opp = match.home === me ? match.away : match.home;
  const need = Math.ceil(match.bestOf / 2);
  const saved = career.progress?.matchId === match.id ? career.progress : null;

  const winnerOf = (g: PlayedGame) => (g.result.winner === "blue" ? g.blue : g.red);
  const scoreOf = (list: PlayedGame[]): [number, number] => [
    list.filter((g) => winnerOf(g) === match.home).length,
    list.filter((g) => winnerOf(g) === match.away).length,
  ];

  const [games, setGames] = useState<PlayedGame[]>(saved?.games ?? []);
  const [sides, setSides] = useState(saved?.next ?? { blue: match.home, red: match.away });
  const [phase, setPhase] = useState<Phase>(() => {
    if (!saved) return "draft";
    if (Math.max(...scoreOf(saved.games)) >= need) return "end";
    return saved.next ? "draft" : "side";
  });
  const [current, setCurrent] = useState<PlayedGame | null>(null);
  const [leaving, setLeaving] = useState(false);

  const lineups = useMemo(() => ({ blue: lineupOf(u, sides.blue), red: lineupOf(u, sides.red) }), [u, sides]);
  const userSide: Side = sides.blue === me ? "blue" : "red";
  // career가 세트마다 저장되며 바뀌어도 같은 세트의 난수는 그대로 (시드·경기·세트 번호로만 정해짐)
  const rng = useMemo(() => seriesRng(career, match, `g${games.length}`), [career.year.seed, match.id, games.length]);
  const used = useMemo(() => games.flatMap((g) => (["blue", "red"] as Side[]).flatMap((s) => POSITIONS.map((p) => g.draft.picks[s][p]))), [games]);
  const shown = current && phase !== "draft" && phase !== "live" ? [...games, current] : games;
  const score = scoreOf(shown);
  const seriesOver = Math.max(...score) >= need;

  const onDraftDone = (draft: DraftResult) => {
    const result = simulateGame(u, lineups, draft, params, rng.fork("sim"), { log: true });
    setCurrent({ blue: sides.blue, red: sides.red, draft, result });
    setPhase("live");
  };

  const nextGame = () => {
    const done = [...games, current!];
    setGames(done);
    setCurrent(null);
    if (Math.max(...scoreOf(done)) >= need) {
      onProgress({ matchId: match.id, games: done, next: null });
      return setPhase("end");
    }
    const last = done[done.length - 1];
    const winner = winnerOf(last);
    const loser = winner === last.blue ? last.red : last.blue;
    if (loser === me) {
      onProgress({ matchId: match.id, games: done, next: null });
      return setPhase("side");
    }
    const next = { blue: loser, red: winner }; // AI가 지면 블루를 고른다
    onProgress({ matchId: match.id, games: done, next });
    setSides(next);
    setPhase("draft");
  };

  const chooseSide = (side: Side) => {
    const next = side === "blue" ? { blue: me, red: opp } : { blue: opp, red: me };
    onProgress({ matchId: match.id, games, next });
    setSides(next);
    setPhase("draft");
  };

  const gameNo = games.length + 1;
  const seriesWinner = score[0] > score[1] ? match.home : match.away;

  return (
    <main className="match" aria-label="경기">
      <div className="match-inner">
        <div className="series-bar">
          <div className="t">
            <TeamBadge team={match.home} size={30} />
            <strong>{TEAM_STYLE[match.home].name}</strong>
          </div>
          <div className="s">
            {score[0]} : {score[1]}
            <small>
              {phase === "end" ? "시리즈 종료" : match.bestOf === 1 ? "단판" : `${gameNo}세트`} · BO{match.bestOf}
              {match.bestOf > 1 ? " · 피어리스" : ""}
            </small>
          </div>
          <div className="t r">
            <strong>{TEAM_STYLE[match.away].name}</strong>
            <TeamBadge team={match.away} size={30} />
          </div>
        </div>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {match.label}
            {phase !== "end" && ` · 이번 세트: 블루 ${sides.blue} · 레드 ${sides.red}`}
            {used.length > 0 && phase === "draft" && ` · 피어리스로 막힌 챔피언 ${used.length}개`}
          </span>
          {phase !== "end" &&
            (leaving ? (
              <span className="row" style={{ flexWrap: "wrap" }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  {games.length ? `${games.length}세트까지는 저장됨. 지금 세트는 처음부터 다시 함` : "지금 나가면 이 세트는 처음부터 다시 함"}
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
                  {TEAM_STYLE[match.home].name} {score[0]} : {score[1]} {TEAM_STYLE[match.away].name}
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
              <button className="btn primary" onClick={() => onDone(games)}>
                결과 저장하고 다른 경기 진행
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
