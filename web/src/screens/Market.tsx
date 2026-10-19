// 선수 시장: FA 제안(스토브리그는 라운드제, 시즌 중엔 바로 계약), 이적료 영입, 트레이드
import { useMemo, useState } from "react";
import {
  acceptance,
  capRoom,
  checkOffer,
  evaluateTrade,
  LEAGUES,
  mainRoster,
  overall,
  payroll,
  POSITIONS,
  salaryDemand,
  transferFee,
  type Offer,
  type PlayerState,
  type Position,
  type TradeProposal,
} from "../engine.ts";
import {
  addOffer,
  FA_ROUNDS,
  finishMarket,
  marketWindow,
  myTeam,
  placeBid,
  playMarketRound,
  proposeTrade,
  realDeal,
  removeOffer,
  seasonOf,
  signFreeAgent,
  type Career,
  type Outcome,
} from "../game/career.ts";
import { LEAGUE_STYLE, POS_KO, TEAM_STYLE } from "../game/meta.ts";
import { TeamBadge } from "../ui/bits.tsx";
import { fmt1, ovr, PlayerDetail, PlayerLine } from "../ui/player.tsx";

type Mode = "fa" | "buy" | "trade";
type Msg = { ok: boolean; text: string } | null;
const round1 = (x: number) => Math.round(x * 10) / 10;

export function Market({ career, onChange }: { career: Career; onChange: (c: Career) => void }) {
  const w = career.world;
  const t = myTeam(career);
  const win = marketWindow(career);
  const [mode, setMode] = useState<Mode>("fa");
  const [msg, setMsg] = useState<Msg>(null);
  const act = (o: Outcome, ok: string) => {
    setMsg(o.ok ? { ok: true, text: ok } : { ok: false, text: o.reason });
    if (o.ok) onChange(o.career);
  };
  const pay = payroll(w.players, mainRoster(t));
  const o = career.offseason;

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">{win.label}</span>
          <h1>선수 시장</h1>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className="chip gold">
            연봉 {fmt1(pay)} / {t.cap}C · 여유 {fmt1(capRoom(w, t.id))}C
          </span>
          <span className="chip">이적 예산 {fmt1(t.transferBudget)}C</span>
          <span className="chip">1군 {mainRoster(t).length}/10명</span>
        </div>
      </div>

      {msg && (
        <div className={`notice ${msg.ok ? "ok" : ""}`} role="status">
          {msg.text}
          <button className="btn small ghost" onClick={() => setMsg(null)}>
            닫기
          </button>
        </div>
      )}

      {o?.stage === "market" && (
        <section className="panel stack">
          <h2>
            FA {o.round + 1}/{FA_ROUNDS}라운드 · 내 제안 {o.offers.length}건
            <span className="label">{o.round === FA_ROUNDS - 1 ? "마지막 라운드: 선수들이 낮은 조건도 받음" : "다른 팀 제안과 비교해 선수가 고름"}</span>
          </h2>
          {o.offers.map((x) => {
            const p = w.players[x.player];
            const a = acceptance(w, x, o.round === FA_ROUNDS - 1);
            return (
              <div className="row" key={x.player} style={{ flexWrap: "wrap" }}>
                <span className="pl-pos">{POS_KO[p.position]}</span>
                <b>{p.name}</b>
                <span className="faint num">
                  {x.salary}C · {x.years}년 · {x.role === "starter" ? "주전 약속" : "후보"}
                </span>
                <span className={`chip ${a.likely ? "good" : "bad"}`}>{a.likely ? "수락할 듯" : "다른 팀에 밀릴 수 있음"}</span>
                <button className="btn small ghost" onClick={() => onChange(removeOffer(career, x.player))}>
                  빼기
                </button>
              </div>
            );
          })}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn primary" onClick={() => onChange(playMarketRound(career))}>
              {o.round + 1}라운드 진행
            </button>
            <button className="btn ghost" onClick={() => onChange(finishMarket(career))}>
              남은 라운드 모두 진행
            </button>
          </div>
          <RoundLog lines={o.log} />
        </section>
      )}

      <div className="seg seg-wrap" role="group" aria-label="시장 종류">
        {(
          [
            ["fa", "FA"],
            ["buy", "이적료 영입"],
            ["trade", "트레이드"],
          ] as Array<[Mode, string]>
        ).map(([m, label]) => (
          <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>

      {mode !== "trade" && !(mode === "fa" ? win.fa : win.transfers) && <div className="notice">{mode === "fa" ? win.label : `이적료 영입은 이적 창에서만. ${win.label}`}</div>}
      {mode === "fa" && <PlayerSearch career={career} mode="fa" onAct={act} onChange={onChange} />}
      {mode === "buy" && <PlayerSearch career={career} mode="buy" onAct={act} onChange={onChange} />}
      {mode === "trade" && (win.transfers ? <TradeBuilder career={career} onAct={act} /> : <div className="notice">트레이드는 이적 창에서만. {win.label}</div>)}
    </div>
  );
}

function RoundLog({ lines }: { lines: string[] }) {
  const end = lines.findIndex((l, i) => i > 0 && l.startsWith("──"));
  const latest = lines.slice(0, end < 0 ? 12 : Math.min(end, 16));
  if (!latest.length) return null;
  return (
    <ul className="log">
      {latest.map((l, i) => (
        <li key={i} className={l.startsWith("✔") ? "good" : l.startsWith("✘") ? "bad" : l.startsWith("──") ? "head" : ""}>
          {l}
        </li>
      ))}
    </ul>
  );
}

const leagueOfPlayer = (c: Career, p: PlayerState) => c.world.teams[p.contract?.team ?? p.team]?.league ?? "";

function PlayerSearch({ career, mode, onAct, onChange }: { career: Career; mode: "fa" | "buy"; onAct: (o: Outcome, ok: string) => void; onChange: (c: Career) => void }) {
  const w = career.world;
  const [pos, setPos] = useState<Position | "all">("all");
  const [league, setLeague] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => {
    const ids = mode === "fa" ? w.freeAgents : Object.values(w.teams).filter((x) => x.id !== career.teamId).flatMap((x) => mainRoster(x));
    const needle = q.trim().toLowerCase();
    return ids
      .map((id) => w.players[id])
      .filter((p) => p && (pos === "all" || p.position === pos) && (league === "all" || leagueOfPlayer(career, p) === league) && (!needle || p.name.toLowerCase().includes(needle)))
      .sort((a, b) => overall(b.ratings) - overall(a.ratings));
  }, [w, mode, pos, league, q, career]);
  const shown = list.slice(0, 50);

  return (
    <section className="stack">
      <div className="filters">
        <div className="seg seg-wrap" role="group" aria-label="포지션">
          {(["all", ...POSITIONS] as const).map((x) => (
            <button key={x} aria-pressed={pos === x} onClick={() => setPos(x)}>
              {x === "all" ? "전체" : POS_KO[x]}
            </button>
          ))}
        </div>
        <label className="field inline">
          <span className="sr-only">리그</span>
          <select value={league} onChange={(e) => setLeague(e.target.value)} aria-label="리그">
            <option value="all">모든 리그</option>
            {LEAGUES.map((lg) => (
              <option key={lg} value={lg}>
                {LEAGUE_STYLE[lg]?.name ?? lg}
              </option>
            ))}
          </select>
        </label>
        <input className="search" type="search" placeholder="선수 이름" value={q} onChange={(e) => setQ(e.target.value)} aria-label="선수 이름 검색" />
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 13 }}>
        {mode === "fa"
          ? `FA ${list.length}명. 요구 연봉은 실력·나이로 정해짐. 팀 명성·주전 약속·같은 지역이면 덜 줘도 옴.`
          : `다른 팀 1군 ${list.length}명. 원소속 팀은 몸값 이상이면 팔고(대체 선수 없는 주전은 1.3배), 선수도 지금보다 나은 조건이어야 옴.`}
        {list.length > shown.length && ` 실력 순 위 ${shown.length}명만 보임.`}
      </p>
      <div className="panel pl-list">
        {shown.length === 0 && <div className="empty">조건에 맞는 선수가 없음</div>}
        {shown.map((p) => (
          <div key={p.id}>
            <PlayerLine
              p={p}
              team
              open={open === p.id}
              onClick={() => setOpen(open === p.id ? null : p.id)}
              right={
                <span className="pl-right faint num">
                  {realDeal(career, p.id) && <span className="chip">실제 2026: {realDeal(career, p.id)!.label}</span>}
                  {mode === "fa" ? `요구 ${fmt1(salaryDemand(p))}C` : `몸값 ${fmt1(transferFee(p, w.season))}C · ~${p.contract?.endSeason}`}
                </span>
              }
            />
            {open === p.id && (
              <PlayerDetail p={p}>
                {mode === "fa" ? <OfferForm career={career} p={p} onAct={onAct} onChange={onChange} /> : <BidForm career={career} p={p} onAct={onAct} />}
              </PlayerDetail>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Num({ label, value, onChange, step = 0.1, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="field">
      <span className="faint" style={{ fontSize: 12 }}>
        {label}
      </span>
      <input type="number" inputMode="decimal" step={step} min={min} max={max} value={value} onChange={(e) => onChange(round1(Number(e.target.value) || 0))} />
    </label>
  );
}

function Years({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span className="faint" style={{ fontSize: 12 }}>
        기간
      </span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {[1, 2, 3].map((y) => (
          <option key={y} value={y}>
            {y}년
          </option>
        ))}
      </select>
    </label>
  );
}

function Role({ value, onChange }: { value: "starter" | "bench"; onChange: (v: "starter" | "bench") => void }) {
  return (
    <label className="field">
      <span className="faint" style={{ fontSize: 12 }}>
        역할
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value as "starter" | "bench")}>
        <option value="starter">주전 약속</option>
        <option value="bench">후보</option>
      </select>
    </label>
  );
}

// 내 주전보다 잘하면 주전 약속을 기본으로
function defaultRole(career: Career, p: PlayerState): "starter" | "bench" {
  const cur = myTeam(career).starters[p.position];
  return !cur || overall(p.ratings) > overall(career.world.players[cur].ratings) ? "starter" : "bench";
}

function OfferForm({ career, p, onAct, onChange }: { career: Career; p: PlayerState; onAct: (o: Outcome, ok: string) => void; onChange: (c: Career) => void }) {
  const w = career.world;
  const win = marketWindow(career);
  const off = career.offseason;
  const [salary, setSalary] = useState(Math.max(0.3, salaryDemand(p)));
  const [years, setYears] = useState(1);
  const [role, setRole] = useState(defaultRole(career, p));
  const offer: Offer = { team: career.teamId, player: p.id, salary, years, role };
  const last = win.fa === "now" || off?.round === FA_ROUNDS - 1;
  const a = acceptance(w, offer, last);
  const check = checkOffer(w, offer, off?.offers ?? []);
  return (
    <div className="stack" style={{ width: "100%", gap: 10 }}>
      <div className="form-row">
        <Num label="연봉 (C/시즌)" value={salary} onChange={setSalary} min={0.3} />
        <Years value={years} onChange={setYears} />
        <Role value={role} onChange={setRole} />
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className={`chip ${a.likely ? "good" : "bad"}`} title={`효용 ${a.utility} / 기준 ${a.need}`}>
          {a.likely ? "받아들일 조건" : "이대로는 거절할 듯"}
        </span>
        {!check.ok && <span className="chip bad">{check.reason}</span>}
        {win.fa === "offer" && (
          <button className="btn small primary" disabled={!check.ok} onClick={() => onAct(addOffer(career, offer), `${p.name}에게 제안 (라운드 진행 때 결정)`)}>
            제안 넣기
          </button>
        )}
        {win.fa === "now" && (
          <button className="btn small primary" disabled={!check.ok} onClick={() => onAct(signFreeAgent(career, offer), `${p.name} 계약 완료`)}>
            바로 계약
          </button>
        )}
        {off?.offers.some((x) => x.player === p.id) && (
          <button className="btn small ghost" onClick={() => onChange({ ...career, offseason: { ...off, offers: off.offers.filter((x) => x.player !== p.id) } })}>
            제안 취소
          </button>
        )}
      </div>
    </div>
  );
}

function BidForm({ career, p, onAct }: { career: Career; p: PlayerState; onAct: (o: Outcome, ok: string) => void }) {
  const w = career.world;
  const win = marketWindow(career);
  const base = transferFee(p, w.season);
  const [fee, setFee] = useState(base);
  const [salary, setSalary] = useState(round1(Math.max(salaryDemand(p), (p.contract?.salary ?? 0) * 1.1)));
  const [years, setYears] = useState(2);
  const [role, setRole] = useState(defaultRole(career, p));
  const left = Math.max(0, (p.contract?.endSeason ?? w.season) - w.season);
  return (
    <div className="stack" style={{ width: "100%", gap: 10 }}>
      <span className="faint" style={{ fontSize: 13 }}>
        {p.contract?.team} 소속 · 계약 {left ? `${left}년 더 남음` : "이번 시즌까지"} · 지금 연봉 {fmt1(p.contract?.salary ?? 0)}C · 몸값 {fmt1(base)}C
      </span>
      <div className="form-row">
        <Num label="이적료 (C)" value={fee} onChange={setFee} min={0} />
        <Num label="연봉 (C/시즌)" value={salary} onChange={setSalary} min={0.3} />
        <Years value={years} onChange={setYears} />
        <Role value={role} onChange={setRole} />
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="btn small primary" disabled={!win.transfers} onClick={() => onAct(placeBid(career, { team: career.teamId, player: p.id, fee, salary, years, role }), `${p.name} 영입 완료`)}>
          이적 제안
        </button>
        {!win.transfers && <span className="chip">이적 창이 닫혀 있음</span>}
      </div>
    </div>
  );
}

function TradeBuilder({ career, onAct }: { career: Career; onAct: (o: Outcome, ok: string) => void }) {
  const w = career.world;
  const me = career.teamId;
  const teams = useMemo(
    () => Object.values(w.teams).filter((x) => x.id !== me).sort((a, b) => LEAGUES.indexOf(a.league) - LEAGUES.indexOf(b.league) || a.id.localeCompare(b.id)),
    [w, me],
  );
  const [to, setTo] = useState(teams[0].id);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [fee, setFee] = useState(0);
  const tp: TradeProposal = { from: me, to, give, get, fee };
  const e = give.length || get.length ? evaluateTrade(w, tp) : null;
  const toggle = (list: string[], set: (x: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const side = (teamId: string, sel: string[], set: (x: string[]) => void) => (
    <div className="panel stack" style={{ gap: 6 }}>
      <h2 style={{ marginBottom: 4 }}>
        <span className="row">
          <TeamBadge team={teamId} size={22} />
          {TEAM_STYLE[teamId]?.name ?? teamId}
        </span>
        <span className="label">{teamId === me ? "주는 선수" : "받는 선수"}</span>
      </h2>
      {mainRoster(w.teams[teamId]).map((id) => {
        const p = w.players[id];
        return (
          <label key={id} className="check">
            <input type="checkbox" checked={sel.includes(id)} onChange={() => toggle(sel, set, id)} />
            <span className="pl-pos">{POS_KO[p.position]}</span>
            <span className="grow">
              {p.name} <span className="faint">{p.age}세</span>
            </span>
            <span className="num">{ovr(p)}</span>
            <span className="faint num">{fmt1(p.contract?.salary ?? 0)}C</span>
          </label>
        );
      })}
    </div>
  );
  return (
    <section className="stack">
      <p className="faint" style={{ margin: 0, fontSize: 13 }}>
        계약(연봉·기간)은 그대로 팀만 바뀜. 상대는 받는 가치가 주는 가치보다 5% 이상 커야 받고, 주전 전력이 약해지면 그만큼 더 요구함. 이적료를 얹을 수 있음(받으려면 음수).
      </p>
      <div className="form-row">
        <label className="field">
          <span className="faint" style={{ fontSize: 12 }}>
            상대 팀
          </span>
          <select
            value={to}
            onChange={(ev) => {
              setTo(ev.target.value);
              setGet([]);
            }}
          >
            {teams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.league} · {TEAM_STYLE[x.id]?.name ?? x.name}
              </option>
            ))}
          </select>
        </label>
        <Num label="얹는 이적료 (C)" value={fee} onChange={setFee} />
      </div>
      <div className="grid-2">
        {side(me, give, setGive)}
        {side(to, get, setGet)}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {e && (
          <span className={`chip ${e.ok ? "good" : "bad"}`}>
            {e.ok ? `수락할 조건 (받는 가치 ${e.valueIn} / 주는 가치 ${e.valueOut})` : e.reason}
          </span>
        )}
        <button
          className="btn primary"
          disabled={!e?.ok}
          onClick={() => {
            onAct(proposeTrade(career, tp), "트레이드 성사");
            setGive([]);
            setGet([]);
            setFee(0);
          }}
        >
          트레이드 제안
        </button>
      </div>
      <p className="faint" style={{ margin: 0, fontSize: 12 }}>
        {seasonOf(career)} 시즌 기준 가치. 나이가 어리고 잠재력이 클수록 가치가 높음.
      </p>
    </section>
  );
}
