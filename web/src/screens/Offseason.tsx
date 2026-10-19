// 스토브리그: 결산 → 재계약 → FA 시장 → 등록 → 새 시즌
import { useState } from "react";
import { salaryNeeded } from "../engine.ts";
import {
  addRealOffers,
  autoFill,
  FA_ROUNDS,
  isOpening,
  myRealArrivals,
  myRealSignings,
  realDeal,
  finishMarket,
  myExpiring,
  myTeam,
  openStoveMarket,
  playMarketRound,
  resign,
  rosterIssues,
  seasonOf,
  startNextSeason,
  toResign,
  type Career,
  type OffseasonStage,
} from "../game/career.ts";
import { placeName, POS_KO } from "../game/meta.ts";
import type { Tab } from "../App.tsx";
import { TeamBadge } from "../ui/bits.tsx";
import { fmt1, GrowthList, ovr, Stars } from "../ui/player.tsx";

const STEPS: Array<[OffseasonStage, string]> = [
  ["review", "결산"],
  ["resign", "재계약"],
  ["market", "FA 시장"],
  ["register", "등록"],
];

export function Offseason({ career, onChange, onOpen }: { career: Career; onChange: (c: Career) => void; onOpen: (tab: Tab) => void }) {
  const o = career.offseason!;
  const at = STEPS.findIndex(([s]) => s === o.stage);
  return (
    <section className="stack">
      <ol className="steps" aria-label="스토브리그 단계">
        {STEPS.map(([s, label], i) => (
          <li key={s} className={i < at ? "done" : i === at ? "now" : ""} aria-current={i === at ? "step" : undefined}>
            <span className="num">{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {o.stage === "review" &&
        (isOpening(career) ? <OpeningReview career={career} onNext={() => onChange(toResign(career))} /> : <Review career={career} onNext={() => onChange(toResign(career))} />)}
      {o.stage === "resign" && <Resign career={career} onChange={onChange} />}
      {o.stage === "market" && (
        <section className="panel stack">
          <h2>
            FA {o.round + 1}/{FA_ROUNDS}라운드 <span className="label">내 제안 {o.offers.length}건</span>
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            라운드마다 모든 팀이 FA에게 제안하고, 선수는 연봉·팀 명성·주전 약속·같은 지역을 보고 고름. 이적료 영입과 트레이드는 바로 결정됨. 마지막 라운드엔 선수들이 낮은 조건도
            받음.
          </p>
          {isOpening(career) && myRealSignings(career).length > 0 && <RealOffers career={career} onChange={onChange} />}
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn" onClick={() => onOpen("market")}>
              시장에서 제안하기
            </button>
            <button className="btn primary" onClick={() => onChange(playMarketRound(career))}>
              {o.round + 1}라운드 진행
            </button>
            <button className="btn ghost" onClick={() => onChange(finishMarket(career))}>
              남은 라운드 모두 진행
            </button>
          </div>
          <Log lines={o.log} />
        </section>
      )}
      {o.stage === "register" && <Register career={career} onChange={onChange} onOpen={onOpen} />}
    </section>
  );
}

function Log({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <details open>
      <summary className="faint" style={{ fontSize: 13 }}>
        시장 소식 {lines.filter((l) => !l.startsWith("──")).length}건
      </summary>
      <ul className="log">
        {lines.slice(0, 40).map((l, i) => (
          <li key={i} className={l.startsWith("✔") ? "good" : l.startsWith("✘") ? "bad" : l.startsWith("──") ? "head" : ""}>
            {l}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Review({ career, onNext }: { career: Career; onNext: () => void }) {
  const w = career.world;
  const h = w.history[w.history.length - 1];
  const mine = h.places[career.teamId] ?? {};
  const o = career.offseason!;
  const endNote = career.growth.filter((g) => g.checkpoint === "SEASON_END" && g.season === seasonOf(career));
  const label: Record<string, string> = { LCK: "LCK", MSI: "MSI", WORLDS: "월즈" };
  return (
    <>
      <div className="grid-2">
        <section className="panel stack">
          <h2>
            {h.season} 시즌 결산 <span className="label">구단주 평가</span>
          </h2>
          {h.owner && (
            <div className="row" style={{ alignItems: "flex-start", gap: 16 }}>
              <span className={`grade g-${h.owner.grade}`}>{h.owner.grade}</span>
              <ul className="goals">
                {h.owner.goals.map((g) => (
                  <li key={g.text} className={g.met ? "met" : "miss"}>
                    {g.met ? "✔" : "✘"} {g.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="faint" style={{ fontSize: 13 }}>
            LCK {placeName("LCK", mine.LCK ?? null)}
            {mine.MSI ? ` · MSI ${placeName("MSI", mine.MSI)}` : ""} · 월즈 {placeName("WORLDS", mine.WORLDS ?? null)}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
            {(["LCK", "MSI", "WORLDS"] as const).map((ev) => (
              <span className="row" key={ev} style={{ gap: 6 }}>
                <span className="faint" style={{ fontSize: 12 }}>
                  {label[ev]} 우승
                </span>
                <TeamBadge team={h.champions[ev]} size={18} />
                <span style={{ fontSize: 13 }}>{h.champions[ev]}</span>
              </span>
            ))}
          </div>
        </section>
        <section className="panel stack">
          <h2>
            다음 시즌 예산 <span className="label">성적에 따라 바뀜</span>
          </h2>
          <div className="faint" style={{ fontSize: 14 }}>
            연봉 상한 <b className="num">{myTeam(career).cap}C</b> · 이적 예산은 새 시즌 시작 때 상한의 30%가 더해짐 (지금 {fmt1(myTeam(career).transferBudget)}C)
          </div>
          {o.retired.length > 0 && (
            <div className="faint" style={{ fontSize: 14 }}>
              은퇴: {o.retired.map((id) => w.players[id]?.name ?? id).join(", ")}
            </div>
          )}
          <div className="faint" style={{ fontSize: 14 }}>
            계약이 끝나는 우리 선수 {myExpiring(career).length}명. 다음 단계에서 재계약하지 않으면 FA가 됨.
          </div>
        </section>
      </div>
      <section className="panel">
        <h2>
          시즌 결산 성장·노쇠 <span className="label">나이 +1</span>
        </h2>
        <GrowthList notes={endNote} world={w} />
      </section>
      <div className="row">
        <button className="btn primary" onClick={onNext}>
          재계약 단계로
        </button>
      </div>
    </>
  );
}

function Resign({ career, onChange }: { career: Career; onChange: (c: Career) => void }) {
  const w = career.world;
  const t = myTeam(career);
  const list = myExpiring(career);
  const [err, setErr] = useState<Record<string, string>>({});
  return (
    <section className="panel stack">
      <h2>
        재계약 <span className="label">{list.length}명 남음</span>
      </h2>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        계약이 이번 시즌으로 끝나는 선수. 필요 연봉은 선수가 남을 최소 조건. 재계약하지 않은 선수는 시장이 열릴 때 FA가 되어 다른 팀으로 갈 수 있음.
      </p>
      {list.length === 0 && <div className="empty">재계약할 선수가 없음</div>}
      {list.map((id) => {
        const p = w.players[id];
        const role = t.starters[p.position] === id ? "starter" : "bench";
        return <ResignRow key={id} career={career} id={id} need={salaryNeeded(w, p, t.id, role)} err={err[id]} onResult={(c, e) => (e ? setErr({ ...err, [id]: e }) : onChange(c))} />;
      })}
      <div className="row">
        <button className="btn primary" onClick={() => onChange(openStoveMarket(career))}>
          시장 열기
        </button>
        {list.length > 0 && <span className="faint" style={{ fontSize: 13 }}>남은 {list.length}명은 FA로 나감</span>}
      </div>
    </section>
  );
}

function ResignRow({ career, id, need, err, onResult }: { career: Career; id: string; need: number; err?: string; onResult: (c: Career, err?: string) => void }) {
  const p = career.world.players[id];
  const [salary, setSalary] = useState(need);
  const [years, setYears] = useState(2);
  return (
    <div className="resign">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <span className="pl-pos">{POS_KO[p.position]}</span>
        <b>{p.name}</b>
        <span className="faint">
          {p.age}세{p.academy ? " · 2군" : ""}
        </span>
        <span className="num">{ovr(p)}</span>
        <Stars p={p} />
        <span className="faint num" style={{ fontSize: 13 }}>
          지금 {fmt1(p.contract?.salary ?? 0)}C · 필요 {fmt1(need)}C
        </span>
        {realDeal(career, id) && <span className="chip">실제 2026: {realDeal(career, id)!.label}</span>}
      </div>
      <div className="form-row">
        <label className="field">
          <span className="faint" style={{ fontSize: 12 }}>
            연봉 (C)
          </span>
          <input type="number" inputMode="decimal" step={0.1} min={0.3} value={salary} onChange={(e) => setSalary(Math.round((Number(e.target.value) || 0) * 10) / 10)} />
        </label>
        <label className="field">
          <span className="faint" style={{ fontSize: 12 }}>
            기간
          </span>
          <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {[1, 2, 3].map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn small primary"
          style={{ alignSelf: "end" }}
          onClick={() => {
            const r = resign(career, id, salary, years);
            onResult(r.career, r.ok ? undefined : r.reason);
          }}
        >
          재계약
        </button>
      </div>
      {err && <span className="chip bad">{err}</span>}
    </div>
  );
}

function Register({ career, onChange, onOpen }: { career: Career; onChange: (c: Career) => void; onOpen: (tab: Tab) => void }) {
  const issues = rosterIssues(career);
  const [err, setErr] = useState("");
  const next = seasonOf(career) + 1;
  return (
    <section className="panel stack">
      <h2>
        로스터 등록 <span className="label">{next} 시즌</span>
      </h2>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        FA 라운드가 끝났음. 남은 FA는 바로 계약할 수 있고, 이적료 영입·트레이드도 시즌 시작 전까지 가능. 주전 5명이 있어야 등록됨.
      </p>
      {issues.length > 0 && (
        <div className="notice">
          등록 문제: {issues.join(", ")}
          <button
            className="btn small"
            onClick={() => {
              const r = autoFill(career);
              onChange(r.career);
              setErr(r.ok ? "" : r.reason);
            }}
          >
            빈자리 자동 채우기
          </button>
        </div>
      )}
      {err && <div className="notice">{err}</div>}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button
          className="btn primary"
          disabled={issues.length > 0}
          onClick={() => {
            const r = startNextSeason(career);
            if (r.ok) onChange(r.career);
            else setErr(r.reason);
          }}
        >
          {next} 시즌 시작
        </button>
        <button className="btn" onClick={() => onOpen("club")}>
          로스터 확인
        </button>
        <button className="btn ghost" onClick={() => onOpen("market")}>
          시장
        </button>
      </div>
      <Log lines={career.offseason!.log} />
    </section>
  );
}

// 첫 스토브리그 결산: 실제 2025 결과, 계약이 끝난 우리 선수와 실제 행선지, 실제 2026에 우리 팀으로 온 선수
function OpeningReview({ career, onNext }: { career: Career; onNext: () => void }) {
  const w = career.world;
  const o = career.offseason!;
  const leaving = myExpiring(career);
  const coming = myRealArrivals(career);
  const t = myTeam(career);
  return (
    <>
      <div className="grid-2">
        <section className="panel stack">
          <h2>
            계약이 끝난 선수 <span className="label">{leaving.length}명</span>
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            2025 시즌으로 계약이 끝남. 다음 단계에서 재계약하지 않으면 FA가 되어 실제 2026 팀으로 감.
          </p>
          {leaving.length === 0 && <div className="empty">없음</div>}
          {leaving.map((id) => {
            const p = w.players[id];
            const d = realDeal(career, id);
            return (
              <div className="row" key={id} style={{ flexWrap: "wrap" }}>
                <span className="pl-pos">{POS_KO[p.position]}</span>
                <b>{p.name}</b>
                <span className="num">{ovr(p)}</span>
                <span className="faint">{p.age}세</span>
                <span className="chip">{d ? `실제 2026: ${d.label}` : "실제 2026: 팀 없음"}</span>
              </div>
            );
          })}
        </section>
        <section className="panel stack">
          <h2>
            실제 2026에 온 선수 <span className="label">{coming.length}명</span>
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            실제로 우리 팀과 계약한 FA. 시장에서 제안하면 거의 받아들이고, 안 데려오면 다른 팀은 건드리지 않음 (다른 팀 합의 선수도 큰 조건이면 뺏어 올 수 있음).
          </p>
          {coming.length === 0 && <div className="empty">없음</div>}
          {coming.map((x) => {
            const p = w.players[x.player];
            return (
              <div className="row" key={x.player} style={{ flexWrap: "wrap" }}>
                <span className="pl-pos">{POS_KO[p.position]}</span>
                <b>{p.name}</b>
                <span className="num">{ovr(p)}</span>
                <span className="faint">{p.contract ? `2025 ${p.contract.team}` : "FA"}</span>
                <span className="chip">{x.academy ? "2군" : x.starter ? "주전" : "후보"}</span>
              </div>
            );
          })}
        </section>
      </div>
      <section className="panel stack">
        <h2>
          예산 <span className="label">2026 시즌</span>
        </h2>
        <div className="faint" style={{ fontSize: 14 }}>
          연봉 상한 <b className="num">{t.cap}C</b> · 이적 예산 <b className="num">{fmt1(t.transferBudget)}C</b>. 상한은 실제 2026 로스터를 데려올 수 있을 만큼으로 정했음.
        </div>
        {o.retired.length > 0 && (
          <div className="faint" style={{ fontSize: 14 }}>
            은퇴: {o.retired.map((id) => w.players[id]?.name ?? id).join(", ")}
          </div>
        )}
      </section>
      <div className="row">
        <button className="btn primary" onClick={onNext}>
          재계약 단계로
        </button>
      </div>
    </>
  );
}

function RealOffers({ career, onChange }: { career: Career; onChange: (c: Career) => void }) {
  const [err, setErr] = useState("");
  const pending = myRealSignings(career).filter((x) => !career.offseason!.offers.some((o) => o.player === x.player));
  if (!pending.length) return null;
  return (
    <div className="row" style={{ flexWrap: "wrap" }}>
      <button
        className="btn"
        onClick={() => {
          const r = addRealOffers(career);
          onChange(r.career);
          setErr(r.ok ? "" : r.reason);
        }}
      >
        실제 2026 영입 그대로 제안 ({pending.length}명)
      </button>
      {err && <span className="chip bad">{err}</span>}
    </div>
  );
}
