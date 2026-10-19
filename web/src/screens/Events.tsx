// 대회 탭: Road to MSI, MSI, LCK 포스트시즌, 월즈의 대진표·스위스 기록·최종 순위
import { useMemo, useState } from "react";
import { bracketDefOf, bracketView, champion, resolveSlot, RULES, swissTable, type BracketDef, type BracketView, type Match, type PhaseId, type Slot } from "../engine.ts";
import { type ActiveCareer as Career } from "../game/career.ts";
import { clock, EVENT_NAME, placeName, TEAM_STYLE } from "../game/meta.ts";
import { LeagueTag, TeamBadge } from "../ui/bits.tsx";

type EventTab = "RTM" | "MSI" | "LCKPO" | "WORLDS";
const TABS: Array<{ id: EventTab; label: string }> = [
  { id: "RTM", label: "Road to MSI" },
  { id: "MSI", label: "MSI" },
  { id: "LCKPO", label: "LCK 포스트시즌" },
  { id: "WORLDS", label: "월즈" },
];

// 지금 진행 중인 대회를 먼저 보여준다
function currentTab(c: Career): EventTab {
  const p = c.year.phase;
  if (p === "MSI_PI" || p === "MSI_BR" || p === "SUMMER") return "MSI";
  if (p === "LCK_PI" || p === "LCK_PO") return "LCKPO";
  if (p.startsWith("WLD") || p === "DONE") return "WORLDS";
  return "RTM";
}

export function Events({ career }: { career: Career }) {
  const [tab, setTab] = useState<EventTab>(() => currentTab(career));
  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">{career.world.season} 대회</span>
          <h1>{TABS.find((t) => t.id === tab)!.label}</h1>
        </div>
        <div className="seg seg-wrap" role="group" aria-label="대회 선택">
          {TABS.map((t) => (
            <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "RTM" && (
        <>
          <Intro text="LCK 1~2라운드 상위 6팀. 1·2위 대결 승자가 MSI 1시드, 3~6위 사다리를 올라온 팀과 1·2위전 패자가 2시드를 다툼. 전부 BO5." />
          <BracketSection career={career} phase="RTM" title="대진" />
          <Finals career={career} event="RTM" />
        </>
      )}
      {tab === "MSI" && (
        <>
          <Intro text="11팀. LCK·LEC·LCS·LCP 2시드는 플레이인(4팀 더블 엘리미네이션)에서 1팀만 브래킷으로. 브래킷은 8팀 더블 엘리미네이션, 전부 BO5." />
          <Qualified career={career} event="msi" />
          <BracketSection career={career} phase="MSI_PI" title="플레이인" />
          <BracketSection career={career} phase="MSI_BR" title="브래킷" />
          <Finals career={career} event="MSI" />
          <MsiBonus career={career} />
        </>
      )}
      {tab === "LCKPO" && (
        <>
          <Intro text="레전드 1~4위는 플레이오프 직행. 레전드 5위와 라이즈 1~3위가 플레이인에서 5·6시드를 다툼. 플레이오프는 6팀 더블 엘리미네이션이고, 3시드와 1시드가 상대를 지목함. 상위 4팀이 월즈에 나감." />
          <BracketSection career={career} phase="LCK_PI" title="플레이인" />
          <BracketSection career={career} phase="LCK_PO" title="플레이오프" />
          <Finals career={career} event="LCK" />
        </>
      )}
      {tab === "WORLDS" && (
        <>
          <Intro text="19팀 = 지역 기본 17장 + MSI 성적 2장. 플레이인 4팀 중 1팀이 스위스로. 스위스 16팀은 3승 진출·3패 탈락, 진출·탈락이 걸린 경기만 BO3이고 나머지는 단판. 8강부터 BO5 단판 토너먼트." />
          <MsiBonus career={career} />
          <Qualified career={career} event="worlds" />
          <BracketSection career={career} phase="WLD_PI" title="플레이인" />
          <Swiss career={career} />
          <BracketSection career={career} phase="WLD_KO" title="녹아웃" />
          <Finals career={career} event="WORLDS" />
        </>
      )}
    </div>
  );
}

const Intro = ({ text }: { text: string }) => (
  <p className="muted" style={{ margin: 0, maxWidth: "76ch" }}>
    {text}
  </p>
);

const leagueOfTeam = (c: Career, t: string, event: "msi" | "worlds") => c.year.qualified[event].find((e) => e.team === t);

function Qualified({ career, event }: { career: Career; event: "msi" | "worlds" }) {
  const list = career.year.qualified[event];
  if (!list.length) return null;
  return (
    <section className="panel">
      <h2>
        참가팀 <span className="label">{list.length}팀</span>
      </h2>
      <div className="entrants">
        {list.map((e) => (
          <div key={e.team} className={`entrant ${e.team === career.teamId ? "me" : ""}`}>
            <TeamBadge team={e.team} size={22} />
            <span>{TEAM_STYLE[e.team].name}</span>
            <LeagueTag league={e.league} />
            <span className="faint num">{e.seed}시드</span>
            {e.stage === "PI" && <span className="faint">플레이인</span>}
            {e.via && <span className="chip gold">{e.via}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

// MSI 성적으로 생기는 월즈 출전권. 확정 전(월즈 플레이인 전)엔 예상으로 보여준다
function MsiBonus({ career }: { career: Career }) {
  const y = career.year;
  const msi = y.finals.MSI;
  if (!msi) return null;
  const leagueOf = (t: string) => Object.entries(y.leagues).find(([, ts]) => ts.includes(t))![0];
  const champ = champion(y, "MSI")!;
  const b = y.worldsBonus;
  const runnerUp = [...msi].sort((a, c) => a[0] - c[0]).find(([, t]) => leagueOf(t) !== leagueOf(champ));
  return (
    <section className="panel">
      <h2>
        MSI 성적과 월즈 출전권 <span className="label">{b ? "확정" : "예상"}</span>
      </h2>
      <div className="stack" style={{ gap: 8, fontSize: 14 }}>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <TeamBadge team={champ} size={20} />
          <span>
            MSI 우승 {TEAM_STYLE[champ].name}: 자국 최종 {RULES.playoffLine[leagueOf(champ)]}위(플레이오프선) 안에 들면 월즈 직행, {leagueOf(champ)} +1장
          </span>
          {b && <span className={`chip ${b.championEligible ? "good" : "bad"}`}>{b.championEligible ? "직행 확정" : "조건 미달"}</span>}
        </div>
        {runnerUp && (
          <div className="row" style={{ flexWrap: "wrap" }}>
            <TeamBadge team={runnerUp[1]} size={20} />
            <span>
              다음으로 잘한 지역 {leagueOf(runnerUp[1])} +1장 ({TEAM_STYLE[runnerUp[1]].name} {runnerUp[0]}위)
            </span>
          </div>
        )}
        {b && (
          <span className="muted">
            확정: {b.leagues.map((lg) => `${lg} +1`).join(", ")}
            {!b.championEligible && " (우승팀이 조건을 못 채워 다음 지역으로 넘어감)"}
          </span>
        )}
      </div>
    </section>
  );
}

function slotText(def: BracketDef, v: BracketView, slot: Slot): string {
  const label = (key: string) => def.matches.find((m) => m.key === key)?.label.replace(/ \(.+\)$/, "") ?? key;
  if ("seed" in slot) return `${slot.seed}번 시드`;
  if ("w" in slot) return `${label(slot.w)} 승자`;
  if ("l" in slot) return `${label(slot.l)} 패자`;
  if ("pick" in slot) return "지목받은 팀";
  if ("rest" in slot) return "지목 안 된 팀";
  const pair = "better" in slot ? slot.better : slot.worse;
  return `${pair.map((x) => slotText(def, v, x)).join("·")} 중 시드 ${"better" in slot ? "높은" : "낮은"} 팀`;
}

function BracketSection({ career, phase, title }: { career: Career; phase: PhaseId; title: string }) {
  const y = career.year;
  const def = bracketDefOf(phase)!;
  const view = useMemo(() => bracketView(y, phase), [y, phase]);
  const started = (y.seeds[phase]?.length ?? 0) > 0;
  const columns = useMemo(() => {
    const cols: Array<{ label: string; keys: string[] }> = [];
    for (const m of def.matches) {
      const label = m.label.replace(/ \(.+\)$/, "");
      const col = cols.find((c) => c.label === label);
      col ? col.keys.push(m.key) : cols.push({ label, keys: [m.key] });
    }
    return cols;
  }, [def]);
  const byId = new Map(y.matches.map((m) => [m.id, m]));
  return (
    <section className="panel">
      <h2>
        {title} <span className="label">BO{def.bestOf}</span>
      </h2>
      {!started && <div className="empty">아직 시작 전. 앞 단계가 끝나면 대진이 정해짐</div>}
      {started && (
        <div className="bracket">
          {columns.map((col) => (
            <div className="bracket-col" key={col.label}>
              <div className="label">{col.label}</div>
              {col.keys.map((key) => {
                const def2 = def.matches.find((m) => m.key === key)!;
                const m = byId.get(`${phase}:${key}`);
                const teams = m ? [m.home, m.away] : [resolveSlot(def, view, def2.a), resolveSlot(def, view, def2.b)];
                const fallback = [slotText(def, view, def2.a), slotText(def, view, def2.b)];
                return <SeriesCard key={key} career={career} match={m ?? null} teams={teams} fallback={fallback} />;
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function SeriesCard({ career, match, teams, fallback }: { career: Career; match: Match | null; teams: Array<string | null>; fallback: string[] }) {
  const [open, setOpen] = useState(false);
  const o = match ? career.year.results[match.id] : undefined;
  const rec = match ? career.records[match.id] : undefined;
  const isToday = match && !o && match.day === career.year.day;
  return (
    <div className={`bm ${isToday ? "today" : ""}`}>
      <button className="bm-body" onClick={() => setOpen(!open)} disabled={!rec} aria-expanded={open}>
        {teams.map((t, i) => (
          <div key={i} className={`bm-team ${t && o?.winner === t ? "win" : o ? "lose" : ""} ${t === career.teamId ? "me" : ""}`}>
            {t ? (
              <>
                <TeamBadge team={t} size={18} />
                <span className="nm">{TEAM_STYLE[t].name}</span>
              </>
            ) : (
              <span className="faint nm">{fallback[i]}</span>
            )}
            <span className="num sc">{o ? o.score[i] : ""}</span>
          </div>
        ))}
        {isToday && <span className="chip gold bm-flag">오늘</span>}
      </button>
      {open && rec && (
        <div className="bm-games">
          {rec.games.map((g, i) => (
            <div key={i} className="faint">
              {i + 1}세트 {g.winner} 승 · {clock(g.duration)} · 킬 {g.kills[0]}:{g.kills[1]} (블루 {g.blue})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Swiss({ career }: { career: Career }) {
  const y = career.year;
  const table = useMemo(() => swissTable(y), [y]);
  if (!table.length)
    return (
      <section className="panel">
        <h2>스위스</h2>
        <div className="empty">아직 시작 전</div>
      </section>
    );
  const rounds = [1, 2, 3, 4, 5].map((r) => y.matches.filter((m) => m.event === "WORLDS" && m.stage === "SW" && m.round === r));
  return (
    <section className="panel">
      <h2>
        스위스 <span className="label">3승 진출 · 3패 탈락</span>
      </h2>
      <div className="grid-2">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>팀</th>
                <th>리그</th>
                <th>풀</th>
                <th>기록</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {table.map((t) => (
                <tr key={t.team} className={t.team === career.teamId ? "me" : ""}>
                  <td>
                    <div className="row">
                      <TeamBadge team={t.team} size={20} />
                      {TEAM_STYLE[t.team].name}
                    </div>
                  </td>
                  <td>
                    <LeagueTag league={t.league} />
                  </td>
                  <td className="num faint">{t.pool}</td>
                  <td className="num">
                    {t.w}-{t.l}
                  </td>
                  <td>{t.w === 3 ? <span className="chip good">진출</span> : t.l === 3 ? <span className="chip bad">탈락</span> : <span className="faint">진행 중</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="stack" style={{ gap: 14 }}>
          {rounds.map((list, i) =>
            list.length ? (
              <div key={i}>
                <div className="label">{i + 1}라운드</div>
                {list.map((m) => {
                  const o = y.results[m.id];
                  return (
                    <div className="result-row" key={m.id}>
                      <span className="faint num" style={{ minWidth: 34 }}>
                        BO{m.bestOf}
                      </span>
                      <TeamBadge team={m.home} size={18} />
                      <span className={o ? (o.winner === m.home ? "w" : "l") : ""}>{m.home}</span>
                      <span className="score">{o ? `${o.score[0]}:${o.score[1]}` : "vs"}</span>
                      <span className={o ? (o.winner === m.away ? "w" : "l") : ""}>{m.away}</span>
                      <TeamBadge team={m.away} size={18} />
                    </div>
                  );
                })}
              </div>
            ) : null,
          )}
        </div>
      </div>
    </section>
  );
}

function Finals({ career, event }: { career: Career; event: string }) {
  const list = career.year.finals[event];
  if (!list) return null;
  const evName = event === "LCK" ? "LCK" : event;
  return (
    <section className="panel">
      <h2>
        최종 순위 <span className="label">{EVENT_NAME[event] ?? event}</span>
      </h2>
      <div className="entrants">
        {list.map(([place, t]) => (
          <div key={t} className={`entrant ${t === career.teamId ? "me" : ""}`}>
            <span className="num faint" style={{ minWidth: 26 }}>
              {place}
            </span>
            <TeamBadge team={t} size={22} />
            <span>{TEAM_STYLE[t].name}</span>
            <span className="faint">{event === "RTM" ? (place <= 2 ? `MSI ${place}시드` : "") : placeName(evName, place)}</span>
            {leagueOfTeam(career, t, event === "MSI" ? "msi" : "worlds") && event !== "LCK" && event !== "RTM" && (
              <LeagueTag league={leagueOfTeam(career, t, event === "MSI" ? "msi" : "worlds")!.league} />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
