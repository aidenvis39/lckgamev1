import { useMemo } from "react";
import {
  dayLabel,
  isMine,
  mySeriesOn,
  seasonOver,
  seriesOn,
  standings,
  universeFor,
  type Career,
  type SeriesRecord,
} from "../game/career.ts";
import { TEAM_STYLE } from "../game/meta.ts";
import { teamProfile, type TeamProfile } from "../game/teamStats.ts";
import { FormPill, SideTag, TeamBadge } from "../ui/bits.tsx";

interface Props {
  career: Career;
  onPlay: (s: SeriesRecord) => void;
  onAutoDay: () => void;
  onNewSeason: () => void;
  onOpenSeason: () => void;
}

export function Home({ career, onPlay, onAutoDay, onNewSeason, onOpenSeason }: Props) {
  const table = useMemo(() => standings(career), [career]);
  const me = career.teamId;
  const rank = table.findIndex((s) => s.team === me) + 1;
  const mine = table[rank - 1];
  const today = mySeriesOn(career, career.matchday);
  const others = seriesOn(career, career.matchday).filter((s) => !isMine(career, s));
  const recent = career.series.filter((s) => s.score && isMine(career, s)).slice(-5).reverse();
  const over = seasonOver(career);

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">{dayLabel(career.matchday)}</span>
          <h1>{TEAM_STYLE[me].name}</h1>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="chip gold">
            {rank}위 · {mine.sw}승 {mine.sl}패
          </span>
          <span className="chip">
            세트 <span className="num">{mine.gw}-{mine.gl}</span>
          </span>
          <FormPill form={mine.form} />
        </div>
      </div>

      {over ? (
        <section className="panel stack">
          <h2>정규시즌 종료</h2>
          <p style={{ margin: 0 }}>
            최종 {rank}위로 마감했음. {rank <= 6 ? "플레이오프 진출권 순위임." : "플레이오프 진출권 밖임."} 플레이오프는 다음
            업데이트에서 붙일 예정.
          </p>
          <div className="row">
            <button className="btn primary" onClick={onNewSeason}>
              같은 팀으로 새 시즌
            </button>
            <button className="btn" onClick={onOpenSeason}>
              최종 순위 보기
            </button>
          </div>
        </section>
      ) : today ? (
        <NextMatch career={career} series={today} onPlay={onPlay} onAuto={onAutoDay} />
      ) : (
        <section className="panel stack">
          <h2>오늘은 경기가 없음</h2>
          <p className="muted" style={{ margin: 0 }}>
            3~4라운드 그룹은 5팀이라 하루씩 쉬는 날이 있음. 다른 경기 결과를 보고 다음 날로 넘어가면 됨.
          </p>
          <div>
            <button className="btn primary" onClick={onAutoDay}>
              다른 경기 진행하고 다음 날로
            </button>
          </div>
        </section>
      )}

      <div className="grid-2">
        <section className="panel">
          <h2>
            순위
            <button className="btn ghost small" onClick={onOpenSeason}>
              전체 보기
            </button>
          </h2>
          <div className="table-wrap">
            <table>
              <tbody>
                {table.map((s, i) => (
                  <tr key={s.team} className={`${s.team === me ? "me" : ""} ${i === 4 && !career.groups ? "cut" : ""}`}>
                    <td className="num faint">{i + 1}</td>
                    <td>
                      <div className="row">
                        <TeamBadge team={s.team} size={20} />
                        <span>{TEAM_STYLE[s.team].name}</span>
                      </div>
                    </td>
                    <td className="num">
                      {s.sw}-{s.sl}
                    </td>
                    <td className="num muted">{s.gw - s.gl >= 0 ? `+${s.gw - s.gl}` : s.gw - s.gl}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!career.groups && <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>점선 위 5팀이 3~4라운드 레전드 그룹으로 감</p>}
        </section>

        <div className="stack" style={{ gap: 16 }}>
          {!over && others.length > 0 && (
            <section className="panel">
              <h2>오늘 다른 경기</h2>
              {others.map((s) => (
                <div className="result-row" key={s.id}>
                  <TeamBadge team={s.home} size={20} />
                  <span>{TEAM_STYLE[s.home].name}</span>
                  <span className="score muted">vs</span>
                  <TeamBadge team={s.away} size={20} />
                  <span>{TEAM_STYLE[s.away].name}</span>
                </div>
              ))}
            </section>
          )}
          <section className="panel">
            <h2>최근 내 경기</h2>
            {recent.length === 0 && <div className="empty">아직 치른 경기가 없음</div>}
            {recent.map((s) => {
              const opp = s.home === me ? s.away : s.home;
              const won = s.winner === me;
              const [mineScore, oppScore] = s.home === me ? s.score! : [s.score![1], s.score![0]];
              return (
                <div className="result-row" key={s.id}>
                  <span className={`chip ${won ? "good" : "bad"}`}>{won ? "승" : "패"}</span>
                  <span className="score">
                    {mineScore}:{oppScore}
                  </span>
                  <TeamBadge team={opp} size={20} />
                  <span>{TEAM_STYLE[opp].name}</span>
                  {s.auto && <span className="chip">AI 지휘</span>}
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}

const COMPARE: Array<[keyof TeamProfile, string]> = [
  ["laning", "라인전"],
  ["teamfight", "한타"],
  ["vision", "시야"],
  ["survival", "생존"],
  ["macro", "운영"],
];

function NextMatch({ career, series, onPlay, onAuto }: { career: Career; series: SeriesRecord; onPlay: (s: SeriesRecord) => void; onAuto: () => void }) {
  const u = useMemo(() => universeFor(career), [career]);
  const table = standings(career);
  const rec = (t: string) => table.find((s) => s.team === t)!;
  const [home, away] = [teamProfile(u, series.home), teamProfile(u, series.away)];
  const scale = (k: keyof TeamProfile, v: number) => (k === "macro" ? Math.max(4, Math.min(100, 50 + v * 90)) : Math.max(4, ((v - 40) / 59) * 100));
  return (
    <section className="stack">
      <div className="versus">
        {[series.home, series.away].map((t, i) => (
          <div className="side" key={t} style={{ order: i === 0 ? 0 : 2 }}>
            <TeamBadge team={t} size={44} />
            <strong>{TEAM_STYLE[t].name}</strong>
            <span className="row muted" style={{ fontSize: 13 }}>
              <SideTag side={i === 0 ? "blue" : "red"} /> {rec(t).sw}승 {rec(t).sl}패
            </span>
          </div>
        ))}
        <div className="vs" style={{ order: 1 }}>
          VS
        </div>
      </div>
      <div className="grid-2">
        <section className="panel">
          <h2>
            전력 비교 <span className="label">주전 평균</span>
          </h2>
          <div className="compare">
            {COMPARE.map(([k, label]) => (
              <div key={k} style={{ display: "contents" }}>
                <div className="l">
                  <div className="bar" style={{ width: `${scale(k, home[k])}%`, background: "var(--blue)" }} />
                </div>
                <div className="mid">{label}</div>
                <div>
                  <div className="bar" style={{ width: `${scale(k, away[k])}%`, background: "var(--red)" }} />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="panel stack">
          <h2>BO3 · 피어리스</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            1세트는 {TEAM_STYLE[series.home].name}이(가) 블루. 이후 세트는 진 팀이 진영을 고름. 앞 세트에 나온 챔피언은 양
            팀 모두 다시 못 씀.
          </p>
          <div className="row" style={{ flexWrap: "wrap", marginTop: "auto" }}>
            <button className="btn primary" onClick={() => onPlay(series)}>
              밴픽 시작
            </button>
            <button className="btn" onClick={onAuto}>
              AI에게 맡기고 하루 진행
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
