import type { ReactNode } from "react";
import { baseUniverse, POSITIONS, type DraftResult, type GameResult, type Lineup, type Position, type Side } from "../../engine.ts";
import { clock, POS_KO, signed, TEAM_STYLE } from "../../game/meta.ts";
import { ChampIcon, GoldChart, SideTag, TeamBadge } from "../../ui/bits.tsx";

interface Props {
  result: GameResult;
  draft: DraftResult;
  lineups: Record<Side, Lineup>;
  children?: ReactNode; // 다음 단계 버튼
}

export function GameReport({ result, draft, lineups, children }: Props) {
  const winner = lineups[result.winner].team.id;
  const finalGold = result.goldTimeline[result.goldTimeline.length - 1]?.[1] ?? 0;
  const kda = (side: Side, pos: Position) => {
    const l = result.lines[side][pos];
    return (l.kills + l.assists) / Math.max(1, l.deaths);
  };
  const mvp = POSITIONS.reduce((best, pos) => (kda(result.winner, pos) > kda(result.winner, best) ? pos : best), "top" as Position);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="winner-banner">
        <TeamBadge team={winner} size={40} />
        <div className="stack" style={{ gap: 2 }}>
          <h2>{TEAM_STYLE[winner].name} 승리</h2>
          <span className="muted">
            {clock(result.duration)} · 킬 {result.kills.blue}:{result.kills.red} · 15분 골드 {signed(result.gd15)} (블루 기준) · 최종 골드 {signed(finalGold)}
          </span>
        </div>
      </div>
      <div className="box">
        {(["blue", "red"] as Side[]).map((side) => (
          <section className="panel" key={side}>
            <h2>
              <span className="row">
                <TeamBadge team={lineups[side].team.id} size={22} /> {TEAM_STYLE[lineups[side].team.id].name}
              </span>
              <SideTag side={side} />
            </h2>
            <div className="table-wrap">
              <table>
                <tbody>
                  {POSITIONS.map((pos) => {
                    const c = baseUniverse.champions.get(draft.picks[side][pos])!;
                    const l = result.lines[side][pos];
                    return (
                      <tr key={pos}>
                        <td>{POS_KO[pos]}</td>
                        <td>
                          <div className="row">
                            <ChampIcon id={c.id} name={c.nameKo} size={28} />
                            <span>
                              {lineups[side].players[pos].name}
                              {side === result.winner && pos === mvp && <span className="mvp">MVP</span>}
                            </span>
                          </div>
                        </td>
                        <td className="num">
                          {l.kills}/{l.deaths}/{l.assists}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row muted" style={{ fontSize: 13, marginTop: 10, flexWrap: "wrap" }}>
              <span>포탑 {result.towers[side]}</span>·<span>용 {result.dragons[side]}</span>·<span>바론 {result.barons[side]}</span>
              {result.soul === side && <span className="chip gold">용의 영혼</span>}
            </div>
          </section>
        ))}
      </div>
      <section className="panel">
        <h2>골드 흐름</h2>
        <GoldChart points={result.goldTimeline} until={result.duration} duration={result.duration} />
      </section>
      {children}
    </div>
  );
}
