// 다년 커리어 선수 표시: 한 줄 요약, 상세 카드, 성장 리포트
import type { ReactNode } from "react";
import { ABILITIES, baseUniverse, effective, famePremium, macroPoints, overall, potentialStars, type Ability, type PlayerState, type WorldState } from "../engine.ts";
import type { GrowthNote } from "../game/career.ts";
import { macroGrade, POS_KO } from "../game/meta.ts";
import { ChampIcon, RatingBar, TeamBadge } from "./bits.tsx";

export const ABILITY_KO: Record<Ability, string> = { laning: "라인전", teamfight: "한타", vision: "시야", survival: "생존", champPool: "챔프폭" };
export const ovr = (p: PlayerState) => Math.round(overall(p.ratings));
export const stars = (p: PlayerState) => {
  const n = potentialStars(p);
  return "★".repeat(n) + "☆".repeat(5 - n);
};
export const fmt1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
export const signed1 = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${fmt1(Math.abs(x))}`;

// 경기 능력 4개 평균 변화 (챔프폭 제외)
export const ovrDelta = (d: Partial<Record<Ability, number>>) => ((d.laning ?? 0) + (d.teamfight ?? 0) + (d.vision ?? 0) + (d.survival ?? 0)) / 4;

export function Stars({ p }: { p: PlayerState }) {
  return (
    <span className="stars" title="잠재력 (남은 성장 여유 추정)" aria-label={`잠재력 ${potentialStars(p)}/5`}>
      {stars(p)}
    </span>
  );
}

// 시장·로스터 목록 한 줄
export function PlayerLine({ p, team = false, right, onClick, open }: { p: PlayerState; team?: boolean; right?: ReactNode; onClick?: () => void; open?: boolean }) {
  const t = p.contract?.team;
  const body = (
    <>
      <span className="pl-pos">{POS_KO[p.position]}</span>
      <span className="pl-name">
        <b>{p.name}</b>
        <span className="faint">
          {p.age}세{p.virtual ? " · 신인" : ""}
          {team && (t ? ` · ${t}` : " · FA")}
        </span>
      </span>
      {team && t && <TeamBadge team={t} size={20} />}
      <span className="pl-ovr num">{ovr(p)}</span>
      <Stars p={p} />
      {right}
    </>
  );
  return onClick ? (
    <button className={`pl ${open ? "open" : ""}`} onClick={onClick} aria-expanded={open}>
      {body}
    </button>
  ) : (
    <div className="pl">{body}</div>
  );
}

export function PlayerDetail({ p, world, children, growth }: { p: PlayerState; world: WorldState; children?: ReactNode; growth?: Partial<Record<Ability, number>> }) {
  const r = p.ratings;
  const macro = p.intangibleKnown ? macroGrade(p.intangible) : { label: "아직 모름", tone: "neutral" as const };
  // 운영 기여를 실력 점수로: 추정치와 대략의 범위 (±1 표준오차)
  const pts = macroPoints(world);
  const mid = Math.round(pts * p.intangible);
  const band = Math.round(pts * p.intangibleSe);
  const fp = famePremium(world, p);
  const pool = Object.entries(p.champions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  return (
    <div className="pl-detail stack">
      <div className="grid-2" style={{ gap: 12 }}>
        <div className="stack" style={{ gap: 6 }}>
          {ABILITIES.map((a) => (
            <div className="row" key={a} style={{ gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <RatingBar label={ABILITY_KO[a]} value={r[a]} />
              </div>
              {growth?.[a] !== undefined && <span className={`delta small ${growth[a]! > 0 ? "up" : growth[a]! < 0 ? "down" : ""}`}>{signed1(growth[a]!)}</span>}
            </div>
          ))}
        </div>
        <div className="stack" style={{ gap: 8, fontSize: 13 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">계약</span>
            <span>{p.contract ? `${p.contract.endSeason} 시즌까지 · ${fmt1(p.contract.salary)}C` : "FA"}</span>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">운영</span>
            <span className="row" style={{ gap: 6 }}>
              <span className="faint num" title="운영 기여를 실력 점수로 바꾼 추정치와 범위. 경기를 뛸수록 범위가 좁아짐">
                {mid >= 0 ? "+" : ""}
                {mid} ± {band}
              </span>
              <span className={`chip ${macro.tone === "neutral" ? "" : macro.tone}`}>{macro.label}</span>
            </span>
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">실효 실력</span>
            <span className="num" title="경기 능력 + 운영 기여 추정치. AI가 주전을 고를 때 보는 값">
              {Math.round(effective(world, p))}
            </span>
          </div>
          {fp > 0.005 && (
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">인지도</span>
              <span className="num" title="우승 경력만큼 요구 연봉이 오름 (최근 우승일수록 큼)">연봉 +{Math.round(fp * 100)}%</span>
            </div>
          )}
          {p.careerTitles.length > 0 && (
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <span className="muted">우승</span>
              <span style={{ textAlign: "right" }}>{p.careerTitles.join(", ")}</span>
            </div>
          )}
          {pool.length > 0 && (
            <div className="pool">
              {pool.map(([id, n]) => {
                const c = baseUniverse.champions.get(id);
                return (
                  <span className="p" key={id}>
                    <ChampIcon id={id} name={c?.nameKo ?? id} size={32} />
                    {Math.round(n)}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {children && <div className="row" style={{ flexWrap: "wrap" }}>{children}</div>}
    </div>
  );
}

// 성장 리포트: 여러 성장 시점의 내 팀 변화를 선수별로 합쳐 보여준다
export function GrowthList({ notes, world }: { notes: GrowthNote[]; world: WorldState }) {
  const sum: Record<string, Partial<Record<Ability, number>>> = {};
  for (const n of notes)
    for (const [id, d] of Object.entries(n.changes)) {
      const s = (sum[id] ??= {});
      for (const [a, v] of Object.entries(d) as Array<[Ability, number]>) s[a] = (s[a] ?? 0) + v;
    }
  const rows = Object.entries(sum)
    .filter(([id]) => world.players[id])
    .sort((a, b) => ovrDelta(b[1]) - ovrDelta(a[1]));
  if (!rows.length) return <div className="empty">변화 없음</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>선수</th>
            <th className="num">실력</th>
            {ABILITIES.map((a) => (
              <th key={a} className="num">
                {ABILITY_KO[a]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([id, d]) => {
            const p = world.players[id];
            const total = ovrDelta(d);
            return (
              <tr key={id}>
                <td>
                  <span className="faint">{POS_KO[p.position]}</span> {p.name} <span className="faint">{p.academy ? "· 2군" : ""}</span>
                </td>
                <td className="num">
                  {ovr(p)} <span className={`delta ${total > 0.05 ? "up" : total < -0.05 ? "down" : ""}`}>{signed1(total)}</span>
                </td>
                {ABILITIES.map((a) => (
                  <td key={a} className={`num delta ${(d[a] ?? 0) > 0 ? "up" : (d[a] ?? 0) < 0 ? "down" : "faint"}`}>
                    {d[a] ? signed1(d[a]!) : "·"}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
