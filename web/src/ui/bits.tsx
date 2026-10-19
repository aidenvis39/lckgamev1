import { useEffect, useId, useRef, useState } from "react";
import type { Side } from "../engine.ts";
import { champImage, LEAGUE_STYLE, TEAM_STYLE } from "../game/meta.ts";

export function TeamBadge({ team, size = 28 }: { team: string; size?: number }) {
  const s = TEAM_STYLE[team];
  return (
    <span
      className="badge"
      style={{ width: size * 1.45, height: size, background: s?.color ?? "var(--ink-3)", color: s?.ink ?? "var(--fg)", fontSize: size * (team.length >= 4 ? 0.34 : 0.48) }}
      title={s?.name ?? team}
    >
      {team}
    </span>
  );
}

export function LeagueTag({ league }: { league: string }) {
  const s = LEAGUE_STYLE[league];
  return (
    <span className="league-tag" style={{ color: s?.color, borderColor: s?.color }}>
      {s?.name ?? league}
    </span>
  );
}

// 챔피언 이미지. Data Dragon을 못 불러오면 이름 첫 글자를 보여준다.
export function ChampIcon({ id, name, size = 48 }: { id: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="champ" style={{ width: size, height: size, fontSize: size * 0.42 }} title={name}>
      {name.slice(0, 1)}
      {!broken && <img src={champImage(id)} alt="" loading="lazy" onError={() => setBroken(true)} />}
    </span>
  );
}

export function RatingBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="rating">
      <span className="muted">{label}</span>
      <span className="bar">
        <i className={value < 58 ? "low" : ""} style={{ width: `${Math.max(4, ((value - 30) / 69) * 100)}%` }} />
      </span>
      <span className="num">{Math.round(value)}</span>
    </div>
  );
}

export function FormPill({ form }: { form: Array<"W" | "L"> }) {
  return (
    <span className="form-pill" aria-label={`최근 ${form.length}경기 ${form.join("")}`}>
      {form.map((r, i) => (
        <i key={i} className={r} />
      ))}
    </span>
  );
}

export function SideTag({ side }: { side: Side }) {
  return <span className={`side-tag ${side}`}>{side === "blue" ? "블루" : "레드"}</span>;
}

// 골드 그래프: 위쪽이 블루 우세, 아래쪽이 레드 우세. until까지만 그린다.
// 그래프 폭을 실제 컨테이너 폭에 맞춰서 글자 크기가 화면마다 커지거나 작아지지 않게 한다
function useWidth<T extends Element>(fallback: number) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export function GoldChart({ points, until, duration, height = 160 }: { points: Array<[number, number]>; until: number; duration: number; height?: number }) {
  const [ref, W] = useWidth<HTMLDivElement>(600);
  const clip = `gc${useId().replace(/:/g, "")}`;
  const H = height;
  const pad = { l: 40, r: 10, t: 10, b: 20 };
  const all: Array<[number, number]> = [[0, 0], ...points];
  const shown: Array<[number, number]> = [];
  for (let i = 0; i < all.length; i++) {
    const [t, g] = all[i];
    if (t <= until) shown.push([t, g]);
    else {
      const [t0, g0] = all[i - 1];
      shown.push([until, g0 + ((g - g0) * (until - t0)) / (t - t0)]);
      break;
    }
  }
  const maxAbs = Math.max(3000, ...all.map(([, g]) => Math.abs(g)));
  const span = Math.ceil(maxAbs / 2000) * 2000;
  const maxT = Math.max(20, Math.ceil(duration / 5) * 5);
  const x = (t: number) => pad.l + ((W - pad.l - pad.r) * t) / maxT;
  const y = (g: number) => pad.t + ((H - pad.t - pad.b) * (span - g)) / (2 * span);
  const line = shown.map(([t, g], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(g).toFixed(1)}`).join("");
  const last = shown[shown.length - 1];
  const area = `${line}L${x(last[0]).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;
  const step = W < 420 ? 10 : 5;
  const xticks = Array.from({ length: Math.floor(maxT / step) + 1 }, (_, i) => i * step);
  return (
    <div ref={ref}>
    <svg className="gold-chart" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="골드 차이 그래프">
      <defs>
        <clipPath id={`${clip}t`}>
          <rect x="0" y="0" width={W} height={y(0)} />
        </clipPath>
        <clipPath id={`${clip}b`}>
          <rect x="0" y={y(0)} width={W} height={H} />
        </clipPath>
      </defs>
      {xticks.map((t) => (
        <text key={t} x={x(t)} y={H - 4} textAnchor="middle">
          {t}
        </text>
      ))}
      <text x={pad.l - 6} y={y(span) + 4} textAnchor="end">
        +{span / 1000}k
      </text>
      <text x={pad.l - 6} y={y(-span) + 4} textAnchor="end">
        −{span / 1000}k
      </text>
      <line className="axis" x1={pad.l} x2={W - pad.r} y1={y(span)} y2={y(span)} />
      <line className="axis" x1={pad.l} x2={W - pad.r} y1={y(-span)} y2={y(-span)} />
      <line className="zero" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
      <path d={area} fill="var(--blue)" opacity="0.28" clipPath={`url(#${clip}t)`} />
      <path d={area} fill="var(--red)" opacity="0.28" clipPath={`url(#${clip}b)`} />
      <path d={line} fill="none" stroke="var(--fg)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r="4" fill={last[1] >= 0 ? "var(--blue)" : "var(--red)"} stroke="var(--ink-0)" strokeWidth="2" />
    </svg>
    </div>
  );
}

const ICONS: Record<string, string> = {
  home: "M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z",
  table: "M4 4h16v16H4zM4 9h16M4 14h16M10 4v16",
  roster: "M8 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm8 1a3 3 0 1 1 0-6 3 3 0 0 1 0 6zM1 21c0-4 3-7 7-7s7 3 7 7zm14.5 0c0-2.5-1-4.6-2.6-5.9A6 6 0 0 1 23 21z",
  lab: "M9 3h6M10 3v6L4 20a1 1 0 0 0 .9 1.5h14.2A1 1 0 0 0 20 20L14 9V3M7 15h10",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v3M8 21h8M9 21l1-4h4l1 4",
};

export function Icon({ name }: { name: keyof typeof ICONS | string }) {
  const filled = name === "roster";
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path d={ICONS[name]} />
    </svg>
  );
}
