import { lckUniverse as baseUniverse, POSITIONS, realWinrate2026 } from "../engine.ts";
import { grade, pct, TEAM_STYLE } from "../game/meta.ts";
import { teamProfile } from "../game/teamStats.ts";
import { TeamBadge } from "../ui/bits.tsx";

export function TeamSelect({ onPick }: { onPick: (teamId: string) => void }) {
  const teams = [...baseUniverse.teams.values()].sort((a, b) => (realWinrate2026[b.id] ?? 0) - (realWinrate2026[a.id] ?? 0));
  return (
    <div className="page">
      <section className="hero">
        <span className="label">2026 시즌</span>
        <h1>
          어느 팀의 <em>감독</em>이 될까
        </h1>
        <p>
          LCK 정규시즌에서 시작해 Road to MSI, MSI, LCK 플레이오프를 거쳐 월즈까지 한 해를 치름. 내 경기는 직접 밴픽하고
          중계로 지켜보고, 다른 경기와 해외 5개 리그는 엔진이 실제 통계에 맞춰 시뮬함.
        </p>
      </section>
      <div className="team-grid">
        {teams.map((t) => {
          const prof = teamProfile(baseUniverse, t.id);
          const overall = (prof.laning + prof.teamfight + prof.vision + prof.survival) / 4;
          return (
            <button key={t.id} className="team-card" onClick={() => onPick(t.id)}>
              <div className="row">
                <TeamBadge team={t.id} size={34} />
                <div className="stack" style={{ gap: 2 }}>
                  <strong>{TEAM_STYLE[t.id].name}</strong>
                  <span className="muted" style={{ fontSize: 13 }}>
                    2026 실제 정규시즌 세트 승률 <span className="num">{pct(realWinrate2026[t.id] ?? 0)}</span>
                  </span>
                </div>
              </div>
              <div className="names">
                {POSITIONS.map((pos, i) => (
                  <span key={pos}>
                    {i > 0 && " · "}
                    <b>{baseUniverse.players.get(t.starters[pos])!.name}</b>
                  </span>
                ))}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <span className="chip gold">개인 능력 {grade(overall)}</span>
                <span className={`chip ${prof.macro >= 0.2 ? "good" : prof.macro <= -0.1 ? "bad" : ""}`}>
                  운영 {prof.macro >= 0.2 ? "강함" : prof.macro <= -0.1 ? "약함" : "보통"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
