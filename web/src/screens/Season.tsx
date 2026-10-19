import { useMemo, useState } from "react";
import { dayLabel, isMine, R12_DAYS, standings, TOTAL_DAYS, type Career } from "../game/career.ts";
import { TEAM_STYLE } from "../game/meta.ts";
import { FormPill, TeamBadge } from "../ui/bits.tsx";

export function Season({ career }: { career: Career }) {
  const table = useMemo(() => standings(career), [career]);
  const [onlyMine, setOnlyMine] = useState(true);
  const days = Array.from({ length: career.groups ? TOTAL_DAYS : R12_DAYS }, (_, d) => d);
  const groupOf = (t: string) => (career.groups ? (career.groups.legend.includes(t) ? "레전드" : "라이즈") : null);

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">{career.season} 정규시즌</span>
          <h1>순위와 일정</h1>
        </div>
        <span className="chip gold">{dayLabel(career.matchday)}</span>
      </div>

      <section className="panel">
        <h2>
          순위표 <span className="label">시리즈 승 → 세트 득실</span>
        </h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>팀</th>
                {career.groups && <th>그룹</th>}
                <th>시리즈</th>
                <th>세트</th>
                <th>득실</th>
                <th>최근 5</th>
              </tr>
            </thead>
            <tbody>
              {table.map((s, i) => (
                <tr key={s.team} className={`${s.team === career.teamId ? "me" : ""} ${i === 5 ? "" : ""}`}>
                  <td className="num faint">{i + 1}</td>
                  <td>
                    <div className="row">
                      <TeamBadge team={s.team} size={22} />
                      {TEAM_STYLE[s.team].name}
                    </div>
                  </td>
                  {career.groups && <td className="muted">{groupOf(s.team)}</td>}
                  <td className="num">
                    {s.sw}-{s.sl}
                  </td>
                  <td className="num">
                    {s.gw}-{s.gl}
                  </td>
                  <td className="num">{s.gw - s.gl >= 0 ? `+${s.gw - s.gl}` : s.gw - s.gl}</td>
                  <td>
                    <FormPill form={s.form} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>
          일정
          <span className="seg" role="group" aria-label="일정 필터">
            <button aria-pressed={onlyMine} onClick={() => setOnlyMine(true)}>
              내 경기
            </button>
            <button aria-pressed={!onlyMine} onClick={() => setOnlyMine(false)}>
              전체
            </button>
          </span>
        </h2>
        <div className="stack" style={{ gap: 18 }}>
          {days.map((d) => {
            const list = career.series.filter((s) => s.matchday === d && (!onlyMine || isMine(career, s)));
            if (!list.length) return null;
            return (
              <div key={d}>
                <div className="label" style={{ color: d === career.matchday ? "var(--gold-hi)" : undefined }}>
                  {dayLabel(d)}
                  {d === career.matchday ? " · 오늘" : ""}
                </div>
                {list.map((s) => (
                  <div className="result-row" key={s.id}>
                    <TeamBadge team={s.home} size={20} />
                    <span className={s.winner ? (s.winner === s.home ? "w" : "l") : ""}>{TEAM_STYLE[s.home].name}</span>
                    <span className="score">{s.score ? `${s.score[0]}:${s.score[1]}` : "vs"}</span>
                    <span className={s.winner ? (s.winner === s.away ? "w" : "l") : ""}>{TEAM_STYLE[s.away].name}</span>
                    <TeamBadge team={s.away} size={20} />
                  </div>
                ))}
              </div>
            );
          })}
          {!career.groups && <p className="faint" style={{ margin: 0, fontSize: 13 }}>3~4라운드 일정은 1~2라운드가 끝나면 순위에 따라 정해짐.</p>}
        </div>
      </section>
    </div>
  );
}
