import { useEffect, useState } from "react";
import { finishDay, loadCareer, newCareer, saveCareer, swapStarter, type Career, type SeriesRecord } from "./game/career.ts";
import { TEAM_STYLE } from "./game/meta.ts";
import { Home } from "./screens/Home.tsx";
import { Lab } from "./screens/Lab.tsx";
import { MatchFlow } from "./screens/match/MatchFlow.tsx";
import { Roster } from "./screens/Roster.tsx";
import { Season } from "./screens/Season.tsx";
import { TeamSelect } from "./screens/TeamSelect.tsx";
import { Icon, TeamBadge } from "./ui/bits.tsx";

type Tab = "home" | "season" | "roster" | "lab";
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "home", label: "홈", icon: "home" },
  { id: "season", label: "순위·일정", icon: "table" },
  { id: "roster", label: "로스터", icon: "roster" },
  { id: "lab", label: "이적 실험실", icon: "lab" },
];

export function App() {
  const [career, setCareer] = useState<Career | null>(() => loadCareer());
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || "home");
  const [playing, setPlaying] = useState<SeriesRecord | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => saveCareer(career), [career]);
  useEffect(() => {
    history.replaceState(null, "", `#${tab}`);
    window.scrollTo(0, 0);
  }, [tab, playing]);

  if (!career) {
    return (
      <main className="main">
        <TeamSelect onPick={(id) => setCareer(newCareer(id))} />
      </main>
    );
  }

  if (playing) {
    return (
      <MatchFlow
        career={career}
        series={playing}
        onLeave={() => setPlaying(null)}
        onDone={(record) => {
          setCareer(finishDay(career, record));
          setPlaying(null);
          setTab("home");
        }}
      />
    );
  }

  const nav = (cls: string) =>
    TABS.map((t) => (
      <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)} className={cls}>
        <Icon name={t.icon} />
        {t.label}
      </button>
    ));

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <b>LCK 매니저</b>
          <span>{career.season}</span>
        </div>
        <nav className="nav" aria-label="메뉴">
          {nav("")}
        </nav>
        <div className="rail-foot">
          <div className="row">
            <TeamBadge team={career.teamId} size={24} />
            <span>{TEAM_STYLE[career.teamId].name}</span>
          </div>
          {resetArmed ? (
            <div className="row">
              <button className="btn small" onClick={() => { setCareer(null); setResetArmed(false); setTab("home"); }}>
                정말 처음부터
              </button>
              <button className="btn small ghost" onClick={() => setResetArmed(false)}>
                취소
              </button>
            </div>
          ) : (
            <button className="btn small ghost" onClick={() => setResetArmed(true)}>
              다른 팀으로 새로 시작
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        {tab === "home" && (
          <Home
            career={career}
            onPlay={setPlaying}
            onAutoDay={() => setCareer(finishDay(career))}
            onNewSeason={() => setCareer(newCareer(career.teamId, undefined, career.season))}
            onOpenSeason={() => setTab("season")}
          />
        )}
        {tab === "season" && <Season career={career} />}
        {tab === "roster" && <Roster career={career} onSwap={(pos, id) => setCareer(swapStarter(career, pos, id))} />}
        {tab === "lab" && <Lab />}
      </main>

      <nav className="tabbar" aria-label="메뉴">
        {nav("")}
      </nav>

    </div>
  );
}
