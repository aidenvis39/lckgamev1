import type { ReactNode } from "react";
import { baseUniverse, POSITIONS, type Player, type Position } from "../engine.ts";
import { rosterOf, type Career } from "../game/career.ts";
import { macroGrade, POS_KO, TEAM_STYLE } from "../game/meta.ts";
import { ChampIcon, RatingBar } from "../ui/bits.tsx";

export function Roster({ career, onSwap }: { career: Career; onSwap: (pos: Position, playerId: string) => void }) {
  const { starters, bench } = rosterOf(career);
  const benchPlayers = bench.map((id) => baseUniverse.players.get(id)!);
  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">{TEAM_STYLE[career.teamId].name}</span>
          <h1>로스터</h1>
        </div>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>
        능력치는 2026 실제 기록을 같은 포지션 선수들 사이 순위로 바꾼 값(40~99). 운영은 기록에 안 잡히는 콜·운영 기여로,
        2020~2026 LCK 경기와 이적 기록으로 추정한 값이라 불확실성이 큼.
      </p>
      <section className="stack">
        <span className="label">주전</span>
        <div className="player-grid">
          {POSITIONS.map((pos) => (
            <PlayerCard key={pos} player={baseUniverse.players.get(starters[pos])!} />
          ))}
        </div>
      </section>
      {benchPlayers.length > 0 && (
        <section className="stack">
          <span className="label">후보</span>
          <div className="player-grid">
            {benchPlayers.map((p) => (
              <PlayerCard key={p.id} player={p} action={<button className="btn small" onClick={() => onSwap(p.position, p.id)}>{POS_KO[p.position]} 주전으로</button>} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PlayerCard({ player, action }: { player: Player; action?: ReactNode }) {
  const r = player.ratings;
  const macro = player.intangibleKnown ? macroGrade(player.intangible) : { label: "추정 없음", tone: "neutral" as const };
  const pool = Object.entries(player.champions).slice(0, 6);
  return (
    <article className="panel player-card">
      <div className="head">
        <span className="pos">{POS_KO[player.position]}</span>
        <div className="stack" style={{ gap: 4 }}>
          <span className="name">{player.name}</span>
          <span className="muted" style={{ fontSize: 13 }}>
            {player.age ? `${player.age}세 · ` : ""}2026 {player.games2026}경기
            {player.lowSample && <span className="chip" title="15경기 미만이라 가진 경기로 추정하고 중간값 쪽으로 당긴 능력치" style={{ marginLeft: 6 }}>자료 부족</span>}
          </span>
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <RatingBar label="라인전" value={r.laning} />
        <RatingBar label="한타" value={r.teamfight} />
        <RatingBar label="시야" value={r.vision} />
        <RatingBar label="생존" value={r.survival} />
        <RatingBar label="챔프폭" value={r.champPool} />
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="muted" style={{ fontSize: 13 }}>운영</span>
        <span className={`chip ${macro.tone === "neutral" ? "" : macro.tone}`}>{macro.label}</span>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted" style={{ fontSize: 13 }}>주력 챔피언 · 최근 출전 (2025는 절반 반영)</span>
        <div className="pool">
          {pool.map(([id, n]) => {
            const c = baseUniverse.champions.get(id);
            return (
              <span className="p" key={id}>
                <ChampIcon id={id} name={c?.nameKo ?? id} size={36} />
                {Math.round(n)}
              </span>
            );
          })}
        </div>
      </div>
      {action}
    </article>
  );
}
