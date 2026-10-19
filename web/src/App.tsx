import { useEffect, useState } from "react";
import {
  advanceToMine,
  finishDay,
  hasYear,
  loadCareer,
  marketWindow,
  matchById,
  newCareer,
  pickOpponent,
  recordMine,
  saveCareer,
  saveProgress,
  seasonOf,
  type Career,
} from "./game/career.ts";
import { TEAM_STYLE } from "./game/meta.ts";
import { Club } from "./screens/Club.tsx";
import { Events } from "./screens/Events.tsx";
import { Home } from "./screens/Home.tsx";
import { Lab } from "./screens/Lab.tsx";
import { Market } from "./screens/Market.tsx";
import { MatchFlow } from "./screens/match/MatchFlow.tsx";
import { Season } from "./screens/Season.tsx";
import { TeamSelect } from "./screens/TeamSelect.tsx";
import { Icon, TeamBadge } from "./ui/bits.tsx";

export type Tab = "home" | "league" | "events" | "club" | "market" | "lab";
const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: "home", label: "홈", icon: "home" },
  { id: "league", label: "리그", icon: "table" },
  { id: "events", label: "대회", icon: "trophy" },
  { id: "club", label: "구단", icon: "roster" },
  { id: "market", label: "선수 시장", icon: "market" },
  { id: "lab", label: "이적 실험실", icon: "lab" },
];
const SHORT: Partial<Record<Tab, string>> = { market: "시장", lab: "실험실" }; // 모바일 탭바용
const OLD_TABS: Record<string, Tab> = { roster: "club" };

const initial = loadCareer();

export function App() {
  const [career, setCareer] = useState<Career | null>(initial.career);
  const [notice, setNotice] = useState(initial.notice);
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1);
    return TABS.some((t) => t.id === h) ? (h as Tab) : (OLD_TABS[h] ?? "home");
  });
  const [playing, setPlaying] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  useEffect(() => saveCareer(career), [career]);
  useEffect(() => {
    history.replaceState(null, "", `#${tab}`);
    window.scrollTo(0, 0);
  }, [tab, playing]);

  if (!career) {
    return (
      <main className="main">
        {notice === "droppedV1" && (
          <div className="notice" role="status">
            MSI·월즈가 들어간 새 버전이라 예전 저장은 이어서 할 수 없어서 지웠음. 팀을 다시 골라줘.
            <button className="btn small ghost" onClick={() => setNotice(null)}>
              닫기
            </button>
          </div>
        )}
        <TeamSelect onPick={(id) => setCareer(newCareer(id))} />
      </main>
    );
  }

  const match = playing && hasYear(career) ? matchById(career, playing) : null;
  if (match && hasYear(career)) {
    return (
      <MatchFlow
        career={career}
        match={match}
        onLeave={() => setPlaying(null)}
        onProgress={(p) => setCareer((c) => (c ? saveProgress(c, p) : c))}
        onDone={(games) => {
          setCareer(finishDay(recordMine(career, match.id, games)));
          setPlaying(null);
          setTab("home");
        }}
      />
    );
  }

  const nav = (short: boolean) =>
    TABS.map((t) => (
      <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)} aria-label={t.label}>
        <Icon name={t.icon} />
        {short ? (SHORT[t.id] ?? t.label) : t.label}
        {t.id === "market" && windowOpen && <i className="dot" aria-label="이적 창 열림" />}
      </button>
    ));
  const windowOpen = marketWindow(career).transfers;

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <b>LCK 매니저</b>
          <span>{seasonOf(career)}</span>
        </div>
        <nav className="nav" aria-label="메뉴">
          {nav(false)}
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
        {notice === "migratedV2" && (
          <div className="notice" role="status">
            여러 시즌을 이어 하는 버전으로 바뀌었음. 진행 중이던 {seasonOf(career)} 시즌은 그대로 이어지고, 선수 성장·계약·이적은 지금부터 반영됨.
            <button className="btn small ghost" onClick={() => setNotice(null)}>
              닫기
            </button>
          </div>
        )}
        {tab === "home" && (
          <Home
            career={career}
            onPlay={setPlaying}
            onAutoDay={() => setCareer(finishDay(career))}
            onAdvance={() => setCareer(advanceToMine(career))}
            onChoose={(id, team) => setCareer(pickOpponent(career, id, team))}
            onChange={setCareer}
            onOpen={setTab}
          />
        )}
        {tab === "league" && (hasYear(career) ? <Season career={career} /> : <NotYet title="리그" />)}
        {tab === "events" && (hasYear(career) ? <Events career={career} /> : <NotYet title="대회" />)}
        {tab === "club" && <Club career={career} onChange={setCareer} />}
        {tab === "market" && <Market career={career} onChange={setCareer} />}
        {tab === "lab" && <Lab />}
      </main>

      <nav className="tabbar" aria-label="메뉴">
        {nav(true)}
      </nav>
    </div>
  );
}

// 첫 스토브리그(2025 → 2026) 동안엔 아직 그해 대진이 없다
function NotYet({ title }: { title: string }) {
  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">2026 시즌 전</span>
          <h1>{title}</h1>
        </div>
      </div>
      <div className="empty panel">2026 대진은 스토브리그가 끝나고 시즌을 시작하면 정해짐. 홈에서 스토브리그를 마저 진행해 줘.</div>
    </div>
  );
}
