import { useMemo } from "react";
import { baseUniverse, newWorld, POSITIONS, toUniverse } from "../engine.ts";
import { grade, pct, TEAM_STYLE } from "../game/meta.ts";
import { teamProfile } from "../game/teamStats.ts";
import { TeamBadge } from "../ui/bits.tsx";

// 2025 시즌이 끝난 상태로 고른다: 2025 주전, 2025 승률, 계약이 끝난 선수, 실제 2026 영입
export function TeamSelect({ onPick }: { onPick: (teamId: string) => void }) {
  const w = useMemo(() => newWorld(0), []); // 소속·계약은 시드와 상관없음
  const u = useMemo(() => toUniverse(w, baseUniverse), [w]);
  const teams = Object.values(w.teams)
    .filter((t) => t.league === "LCK")
    .sort((a, b) => b.prestige - a.prestige);
  const h = w.history[0];
  return (
    <div className="page">
      <section className="hero">
        <span className="label">2025 시즌 종료 · 스토브리그</span>
        <h1>
          어느 팀의 <em>감독</em>이 될까
        </h1>
        <p>
          2025 시즌이 끝난 스토브리그에서 시작함. 계약이 끝난 선수를 붙잡거나 FA·이적으로 2026 로스터를 꾸리고, LCK 정규시즌부터 MSI·월즈까지 치른 뒤 다음 해로
          이어 감. 다른 팀은 실제 2026 이적대로 움직이지만, 더 좋은 조건을 내면 뺏어 올 수도 있음.
        </p>
      </section>
      <div className="team-grid">
        {teams.map((t) => {
          const full = POSITIONS.every((pos) => t.starters[pos]);
          const prof = full ? teamProfile(u, t.id, w) : null;
          const overall = prof ? (prof.laning + prof.teamfight + prof.vision + prof.survival) / 4 : 0;
          const ids = [...POSITIONS.map((pos) => t.starters[pos]), ...t.bench, ...t.academy].filter(Boolean);
          const expiring = ids.filter((id) => (w.players[id].contract?.endSeason ?? 0) <= w.season).length;
          const coming = Object.values(w.opening?.pre ?? {}).filter((a) => a.team === t.id).length;
          const titles = (["LCK", "MSI", "WORLDS"] as const).filter((ev) => h.champions[ev] === t.id).map((ev) => ({ LCK: "LCK", MSI: "MSI", WORLDS: "월즈" })[ev]);
          return (
            <button key={t.id} className="team-card" onClick={() => onPick(t.id)}>
              <div className="row">
                <TeamBadge team={t.id} size={34} />
                <div className="stack" style={{ gap: 2 }}>
                  <strong>{TEAM_STYLE[t.id].name}</strong>
                  <span className="muted" style={{ fontSize: 13 }}>
                    2025 정규 세트 승률 <span className="num">{pct(t.prestige, 0)}</span>
                    {titles.length > 0 && ` · 2025 ${titles.join("·")} 우승`}
                  </span>
                </div>
              </div>
              <div className="names">
                {POSITIONS.map((pos, i) => (
                  <span key={pos}>
                    {i > 0 && " · "}
                    <b>{t.starters[pos] ? w.players[t.starters[pos]].name : "—"}</b>
                  </span>
                ))}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {prof && <span className="chip gold">개인 능력 {grade(overall)}</span>}
                <span className={`chip ${expiring >= 4 ? "bad" : ""}`}>계약 만료 {expiring}명</span>
                <span className="chip">실제 2026 영입 {coming}명</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
