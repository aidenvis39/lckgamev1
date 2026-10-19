import { useMemo, useState } from "react";
import { lckGroupStandings, lckSpringStandings, LEAGUES, leagueStandings, RULES, worldsSlotsOf, type Standing } from "../engine.ts";
import { isMine, type Career } from "../game/career.ts";
import { LEAGUE_STYLE, TEAM_STYLE } from "../game/meta.ts";
import { FormPill, TeamBadge } from "../ui/bits.tsx";

export function Season({ career }: { career: Career }) {
  const [league, setLeague] = useState("LCK");
  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">{career.world.season} 정규시즌</span>
          <h1>리그</h1>
        </div>
        <div className="seg seg-wrap" role="group" aria-label="리그 선택">
          {LEAGUES.map((lg) => (
            <button key={lg} aria-pressed={league === lg} onClick={() => setLeague(lg)}>
              {LEAGUE_STYLE[lg].name}
            </button>
          ))}
        </div>
      </div>
      {league === "LCK" ? <Lck career={career} /> : <Overseas career={career} league={league} />}
    </div>
  );
}

function Table({ rows, me, cuts = [], note }: { rows: Standing[]; me: string; cuts?: number[]; note?: string }) {
  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>팀</th>
              <th>시리즈</th>
              <th>세트</th>
              <th>득실</th>
              <th>최근 5</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.team} className={`${s.team === me ? "me" : ""} ${cuts.includes(i) ? "cut" : ""}`}>
                <td className="num faint">{i + 1}</td>
                <td>
                  <div className="row">
                    <TeamBadge team={s.team} size={22} />
                    {TEAM_STYLE[s.team].name}
                  </div>
                </td>
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
      {note && <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>{note}</p>}
    </>
  );
}

function Lck({ career }: { career: Career }) {
  const y = career.year;
  const groups = useMemo(() => lckGroupStandings(y), [y]);
  const spring = useMemo(() => lckSpringStandings(y), [y]);
  const [onlyMine, setOnlyMine] = useState(true);
  const lckMatches = y.matches.filter((m) => m.event === "LCK" && (!onlyMine || isMine(career, m)));
  const days = [...new Set(lckMatches.map((m) => m.day))].sort((a, b) => a - b);
  const dayName = (d: number) => {
    const summer = y.phaseStart.SUMMER;
    return summer !== undefined && d >= summer ? `3~4라운드 ${d - summer + 1}일차` : `1~2라운드 ${d - (y.phaseStart.SPRING ?? 0) + 1}일차`;
  };
  return (
    <>
      {groups ? (
        <div className="grid-2">
          <section className="panel">
            <h2>
              레전드 그룹 <span className="label">1~4위 플레이오프 · 5위 플레이인</span>
            </h2>
            <Table rows={groups.legend} me={career.teamId} cuts={[3]} />
          </section>
          <section className="panel">
            <h2>
              라이즈 그룹 <span className="label">1~3위 플레이인</span>
            </h2>
            <Table rows={groups.rise} me={career.teamId} cuts={[2]} />
          </section>
        </div>
      ) : null}
      <section className="panel">
        <h2>
          1~2라운드 순위 <span className="label">시리즈 승 → 세트 득실 → 상대 전적</span>
        </h2>
        <Table rows={spring} me={career.teamId} cuts={[4]} note="점선 위 5팀이 레전드 그룹. 상위 6팀이 Road to MSI에 나감" />
      </section>
      <section className="panel">
        <h2>
          LCK 일정
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
          {days.map((d) => (
            <div key={d}>
              <div className="label" style={{ color: d === y.day ? "var(--gold-hi)" : undefined }}>
                {dayName(d)}
                {d === y.day ? " · 오늘" : ""}
              </div>
              {lckMatches
                .filter((m) => m.day === d)
                .map((m) => {
                  const o = y.results[m.id];
                  return (
                    <div className="result-row" key={m.id}>
                      <TeamBadge team={m.home} size={20} />
                      <span className={o ? (o.winner === m.home ? "w" : "l") : ""}>{TEAM_STYLE[m.home].name}</span>
                      <span className="score">{o ? `${o.score[0]}:${o.score[1]}` : "vs"}</span>
                      <span className={o ? (o.winner === m.away ? "w" : "l") : ""}>{TEAM_STYLE[m.away].name}</span>
                      <TeamBadge team={m.away} size={20} />
                    </div>
                  );
                })}
            </div>
          ))}
          {!groups && <p className="faint" style={{ margin: 0, fontSize: 13 }}>3~4라운드 일정은 1~2라운드와 MSI가 끝나면 그룹에 따라 정해짐.</p>}
        </div>
      </section>
    </>
  );
}

function Overseas({ career, league }: { career: Career; league: string }) {
  const y = career.year;
  const first = useMemo(() => leagueStandings(y, league, "H1"), [y, league]);
  const all = useMemo(() => leagueStandings(y, league, "all"), [y, league]);
  const played = y.matches.filter((m) => m.event === league && y.results[m.id]).length;
  const total = y.matches.filter((m) => m.event === league).length;
  const msiSlots = RULES.msiOverseas[league];
  const worldsSlots = worldsSlotsOf(y, league);
  const bonusDecided = Boolean(y.worldsBonus);
  const second = y.phaseStart.SUMMER !== undefined;
  return (
    <>
      <p className="muted" style={{ margin: 0, maxWidth: "72ch" }}>
        해외 리그는 게임용 단순 규칙으로 뒤에서 진행됨: 전반·후반 각각 더블 라운드로빈 BO3. 전반 상위 {msiSlots}팀이 MSI, 전·후반 합산 상위{" "}
        {worldsSlots}팀이 월즈에 나감{bonusDecided ? "" : " (MSI 성적에 따라 1장 늘 수 있음)"}. 실제 각 리그의 컵·플레이오프는 아직 없음.
      </p>
      <div className={second ? "grid-2" : ""}>
        {second && (
          <section className="panel">
            <h2>
              전체 순위 <span className="label">월즈 {worldsSlots}장</span>
            </h2>
            <Table rows={all} me={career.teamId} cuts={[worldsSlots - 1]} />
          </section>
        )}
        <section className="panel">
          <h2>
            전반 순위 <span className="label">MSI {msiSlots}장</span>
          </h2>
          <Table rows={first} me={career.teamId} cuts={[msiSlots - 1]} note={`${played}/${total}경기 진행`} />
        </section>
      </div>
    </>
  );
}
