import { useMemo } from "react";
import { champion, lckGroupStandings, lckSpringStandings, leagueStandings, type Match, type Standing } from "../engine.ts";
import {
  dayLabel,
  isMine,
  isOverseasLeague,
  myMatchToday,
  myPendingChoice,
  seasonOver,
  today,
  universeFor,
  type Career,
} from "../game/career.ts";
import { EVENT_NAME, placeName, TEAM_STYLE } from "../game/meta.ts";
import { teamProfile, type TeamProfile } from "../game/teamStats.ts";
import { FormPill, LeagueTag, SideTag, TeamBadge } from "../ui/bits.tsx";
import type { Tab } from "../App.tsx";

interface Props {
  career: Career;
  onPlay: (matchId: string) => void;
  onAutoDay: () => void;
  onAdvance: () => void;
  onChoose: (id: string, team: string) => void;
  onNewSeason: () => void;
  onOpen: (tab: Tab) => void;
}

const leagueOf = (c: Career, t: string) => universeFor(c).teams.get(t)!.league;
export const placeOf = (c: Career, event: string) => c.year.finals[event]?.find(([, t]) => t === c.teamId)?.[0] ?? null;

export function Home({ career, onPlay, onAutoDay, onAdvance, onChoose, onNewSeason, onOpen }: Props) {
  const me = career.teamId;
  const y = career.year;
  const lck = useMemo(() => leagueStandings(y, "LCK"), [y]);
  const mine = lck.find((s) => s.team === me)!;
  const groups = useMemo(() => lckGroupStandings(y), [y]);
  const inLegend = groups?.legend.some((s) => s.team === me) ?? false;
  const rankLabel = groups
    ? `${inLegend ? "레전드" : "라이즈"} ${(inLegend ? groups.legend : groups.rise).findIndex((s) => s.team === me) + 1}위`
    : `${lck.findIndex((s) => s.team === me) + 1}위`;
  const match = myMatchToday(career);
  const choice = myPendingChoice(career);
  const others = today(career).filter((m) => !isMine(career, m) && !isOverseasLeague(m));
  const overseasToday = today(career).filter(isOverseasLeague).length;
  const recent = y.matches.filter((m) => isMine(career, m) && y.results[m.id]).slice(-5).reverse();
  const inMsi = y.qualified.msi.some((e) => e.team === me);
  const inWorlds = y.qualified.worlds.some((e) => e.team === me);

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">{dayLabel(career)}</span>
          <h1>{TEAM_STYLE[me].name}</h1>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="chip gold">
            {rankLabel} · {mine.sw}승 {mine.sl}패
          </span>
          <FormPill form={mine.form} />
          {inMsi && <span className="chip good">MSI 진출</span>}
          {inWorlds && <span className="chip good">월즈 진출</span>}
        </div>
      </div>

      {seasonOver(career) ? (
        <SeasonSummary career={career} onNewSeason={onNewSeason} onOpen={onOpen} />
      ) : choice ? (
        <section className="panel stack">
          <h2>{choice.label}</h2>
          <p className="muted" style={{ margin: 0 }}>
            상위 시드가 다음 상대를 고름. 고르지 않은 팀은 다른 상위 시드와 붙음.
          </p>
          <div className="choice-grid">
            {choice.options.map((t) => {
              const s = lck.find((x) => x.team === t);
              return (
                <button key={t} className="choice" onClick={() => onChoose(choice.id, t)}>
                  <TeamBadge team={t} size={36} />
                  <strong>{TEAM_STYLE[t].name}</strong>
                  {s && (
                    <span className="muted num">
                      정규 {s.sw}-{s.sl}
                    </span>
                  )}
                  <span className="btn small primary">이 팀 지목</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : match ? (
        <NextMatch career={career} match={match} onPlay={onPlay} onAuto={onAutoDay} />
      ) : (
        <section className="panel stack">
          <h2>오늘은 내 경기가 없음</h2>
          <p className="muted" style={{ margin: 0 }}>{restReason(career, inMsi, inWorlds)}</p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn primary" onClick={onAdvance}>
              다음 내 경기까지 진행
            </button>
            <button className="btn" onClick={onAutoDay}>
              하루만 진행
            </button>
            <button className="btn ghost" onClick={() => onOpen("events")}>
              대회 보기
            </button>
          </div>
        </section>
      )}

      <div className="grid-2">
        <section className="panel">
          <h2>
            LCK 순위
            <button className="btn ghost small" onClick={() => onOpen("league")}>
              전체 보기
            </button>
          </h2>
          <MiniStandings career={career} />
        </section>

        <div className="stack" style={{ gap: 16 }}>
          {!seasonOver(career) && (others.length > 0 || overseasToday > 0) && (
            <section className="panel">
              <h2>오늘 다른 경기</h2>
              {others.map((m) => (
                <div className="result-row" key={m.id}>
                  <TeamBadge team={m.home} size={20} />
                  <span>{TEAM_STYLE[m.home].name}</span>
                  <span className="score muted">vs</span>
                  <TeamBadge team={m.away} size={20} />
                  <span>{TEAM_STYLE[m.away].name}</span>
                </div>
              ))}
              {overseasToday > 0 && <p className="faint" style={{ fontSize: 13, margin: "8px 0 0" }}>해외 리그 {overseasToday}경기도 같이 진행됨</p>}
            </section>
          )}
          <section className="panel">
            <h2>최근 내 경기</h2>
            {recent.length === 0 && <div className="empty">아직 치른 경기가 없음</div>}
            {recent.map((m) => (
              <ResultRow key={m.id} career={career} match={m} />
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

function restReason(c: Career, inMsi: boolean, inWorlds: boolean): string {
  const p = c.year.phase;
  if (p === "RTM") return "Road to MSI에 못 나감 (1~2라운드 6위 밖). 다른 팀 결과를 보고 넘어가면 됨.";
  if (p === "MSI_PI" || p === "MSI_BR")
    return inMsi ? "MSI 다른 경기가 끝나야 다음 상대가 정해짐. 탈락했다면 남은 경기를 지켜보면 됨." : "이번 MSI엔 출전하지 않음. 다른 지역 팀들 결과를 보고 넘어가면 됨.";
  if (p === "LCK_PI" || p === "LCK_PO") return "포스트시즌에 못 나갔거나 다음 상대를 기다리는 중.";
  if (p.startsWith("WLD"))
    return inWorlds ? "월즈 다른 경기가 끝나야 다음 상대가 정해짐. 탈락했다면 남은 경기를 지켜보면 됨." : "이번 월즈엔 출전하지 않음. 남은 경기를 지켜보면 됨.";
  return "5팀 그룹이라 하루씩 쉬는 날이 있음.";
}

function MiniStandings({ career }: { career: Career }) {
  const y = career.year;
  const g = useMemo(() => lckGroupStandings(y), [y]);
  const spring = useMemo(() => lckSpringStandings(y), [y]);
  const rows = (list: Standing[], offset = 0, cut?: number) =>
    list.map((s, i) => (
      <tr key={s.team} className={`${s.team === career.teamId ? "me" : ""} ${cut !== undefined && i === cut ? "cut" : ""}`}>
        <td className="num faint">{offset + i + 1}</td>
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
    ));
  if (!g)
    return (
      <>
        <div className="table-wrap">
          <table>
            <tbody>{rows(spring, 0, 4)}</tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>
          점선 위 5팀이 레전드 그룹. 6위 안이면 Road to MSI에 나감
        </p>
      </>
    );
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          <tr>
            <td colSpan={4} className="label">
              레전드 그룹 · 1~4위 플레이오프 직행, 5위 플레이인
            </td>
          </tr>
          {rows(g.legend, 0, 3)}
          <tr>
            <td colSpan={4} className="label">
              라이즈 그룹 · 1~3위 플레이인
            </td>
          </tr>
          {rows(g.rise, 0, 2)}
        </tbody>
      </table>
    </div>
  );
}

function ResultRow({ career, match: m }: { career: Career; match: Match }) {
  const me = career.teamId;
  const o = career.year.results[m.id];
  const opp = m.home === me ? m.away : m.home;
  const won = o.winner === me;
  const [a, b] = m.home === me ? o.score : [o.score[1], o.score[0]];
  return (
    <div className="result-row" style={{ flexWrap: "wrap" }}>
      <span className={`chip ${won ? "good" : "bad"}`}>{won ? "승" : "패"}</span>
      <span className="score">
        {a}:{b}
      </span>
      <TeamBadge team={opp} size={20} />
      <span>{TEAM_STYLE[opp].name}</span>
      <span className="faint" style={{ fontSize: 12 }}>
        {m.label}
      </span>
      {career.records[m.id]?.auto && <span className="chip">AI 지휘</span>}
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

function NextMatch({ career, match, onPlay, onAuto }: { career: Career; match: Match; onPlay: (id: string) => void; onAuto: () => void }) {
  const u = useMemo(() => universeFor(career), [career]);
  const lck = leagueStandings(career.year, "LCK");
  const [home, away] = [teamProfile(u, match.home), teamProfile(u, match.away)];
  const scale = (k: keyof TeamProfile, v: number) => (k === "macro" ? Math.max(4, Math.min(100, 50 + v * 90)) : Math.max(4, ((v - 40) / 59) * 100));
  const need = Math.ceil(match.bestOf / 2);
  const resumed = career.progress?.matchId === match.id ? career.progress.games.length : 0;
  const unknownMacro = !home.macroKnown || !away.macroKnown;
  return (
    <section className="stack">
      <div className="label" style={{ color: "var(--gold-hi)" }}>
        {match.label} · BO{match.bestOf}
      </div>
      <div className="versus">
        {[match.home, match.away].map((t, i) => {
          const s = lck.find((x) => x.team === t);
          return (
            <div className="side" key={t} style={{ order: i === 0 ? 0 : 2 }}>
              <TeamBadge team={t} size={44} />
              <strong>{TEAM_STYLE[t].name}</strong>
              <span className="row muted" style={{ fontSize: 13 }}>
                <SideTag side={i === 0 ? "blue" : "red"} />
                <LeagueTag league={leagueOf(career, t)} />
                {s && `${s.sw}승 ${s.sl}패`}
              </span>
            </div>
          );
        })}
        <div className="vs" style={{ order: 1 }}>
          VS
        </div>
      </div>
      <div className="grid-2">
        <section className="panel">
          <h2>
            전력 비교 <span className="label">주전 평균 · 리그 보정 반영</span>
          </h2>
          <div className="compare">
            {COMPARE.map(([k, label]) => (
              <div key={k} style={{ display: "contents" }}>
                <div className="l">
                  <div className="bar" style={{ width: `${scale(k, home[k] as number)}%`, background: "var(--blue)", opacity: k === "macro" && !home.macroKnown ? 0.3 : 1 }} />
                </div>
                <div className="mid">{label}</div>
                <div>
                  <div className="bar" style={{ width: `${scale(k, away[k] as number)}%`, background: "var(--red)", opacity: k === "macro" && !away.macroKnown ? 0.3 : 1 }} />
                </div>
              </div>
            ))}
          </div>
          {unknownMacro && (
            <p className="faint" style={{ fontSize: 12, margin: "10px 0 0" }}>
              해외 선수 운영 기여는 추정치가 없어서 보통으로 둠 (흐린 막대)
            </p>
          )}
        </section>
        <section className="panel stack">
          <h2>
            BO{match.bestOf}
            {match.bestOf > 1 ? " · 피어리스" : " · 단판"}
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {match.bestOf === 1
              ? `한 세트로 끝남. ${TEAM_STYLE[match.home].name}이(가) 블루.`
              : `${need}세트를 먼저 이기면 승리. 1세트는 ${TEAM_STYLE[match.home].name}이(가) 블루, 이후 세트는 진 팀이 진영을 고름. 앞 세트에 나온 챔피언은 양 팀 모두 다시 못 씀.`}
          </p>
          {resumed > 0 && <span className="chip gold">{resumed}세트까지 치른 시리즈가 저장되어 있음</span>}
          <div className="row" style={{ flexWrap: "wrap", marginTop: "auto" }}>
            <button className="btn primary" onClick={() => onPlay(match.id)}>
              {resumed > 0 ? "이어서 하기" : "밴픽 시작"}
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

function SeasonSummary({ career, onNewSeason, onOpen }: { career: Career; onNewSeason: () => void; onOpen: (tab: Tab) => void }) {
  const y = career.year;
  const events = ["LCK", "MSI", "WORLDS"] as const;
  const eventKey = { LCK: "LCK", MSI: "MSI", WORLDS: "WORLDS" };
  return (
    <section className="stack">
      <div className="winner-banner">
        <TeamBadge team={champion(y, "WORLDS")!} size={44} />
        <div className="stack" style={{ gap: 2 }}>
          <span className="label">{career.season} 월즈 우승</span>
          <h2>{TEAM_STYLE[champion(y, "WORLDS")!].name}</h2>
        </div>
      </div>
      <div className="grid-3">
        {events.map((ev) => {
          const champ = champion(y, eventKey[ev])!;
          const place = placeOf(career, ev);
          return (
            <section className="panel stack" key={ev} style={{ gap: 10 }}>
              <span className="label">{ev === "LCK" ? "LCK 플레이오프" : EVENT_NAME[ev]}</span>
              <div className="row">
                <TeamBadge team={champ} size={26} />
                <strong>{TEAM_STYLE[champ].name}</strong>
              </div>
              <span className={`chip ${place === 1 ? "gold" : place === null ? "" : "good"}`} style={{ alignSelf: "flex-start" }}>
                내 팀: {placeName(ev, place)}
              </span>
            </section>
          );
        })}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn primary" onClick={onNewSeason}>
          같은 팀으로 새 시즌
        </button>
        <button className="btn" onClick={() => onOpen("events")}>
          대회 결과 보기
        </button>
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 13 }}>
        새 시즌은 같은 2026 로스터로 다시 시작함. 선수 성장·이적이 이어지는 다년 커리어는 다음 단계.
      </p>
    </section>
  );
}
