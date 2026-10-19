// 구단: 예산·구단주 목표·로스터(계약·잠재력·집중 육성·2군)·역대 기록
import { useState } from "react";
import { demote, mainRoster, payroll, POSITIONS, promote, releaseMine, setStarter, toggleFocus, type Ability, type PlayerState } from "../engine.ts";
import { myTeam, rosterAction, rosterIssues, seasonOf, seasonOver, type Career, type Outcome } from "../game/career.ts";
import { placeName, POS_KO, TEAM_STYLE } from "../game/meta.ts";
import { TeamBadge } from "../ui/bits.tsx";
import { fmt1, PlayerDetail, PlayerLine, signed1 } from "../ui/player.tsx";

const teamworkLabel = (x: number) => (x >= 0.2 ? "탄탄" : x >= 0.06 ? "좋음" : x > -0.06 ? "보통" : "흔들림");

export function Club({ career, onChange }: { career: Career; onChange: (c: Career) => void }) {
  const w = career.world;
  const t = myTeam(career);
  const [open, setOpen] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pay = payroll(w.players, mainRoster(t));
  const issues = rosterIssues(career);
  const growth: Record<string, Partial<Record<Ability, number>>> = {};
  for (const n of career.growth.filter((g) => g.season === seasonOf(career)))
    for (const [id, d] of Object.entries(n.changes)) for (const [a, v] of Object.entries(d) as Array<[Ability, number]>) (growth[id] ??= {})[a] = Math.round(((growth[id][a] ?? 0) + v) * 10) / 10;

  const act = (o: Outcome, ok?: string) => {
    setArmed(null);
    setMsg(o.ok ? (ok ? { ok: true, text: ok } : null) : { ok: false, text: o.reason });
    if (o.ok) onChange(o.career);
  };
  const run = (fn: Parameters<typeof rosterAction>[1], ok?: string) => act(rosterAction(career, fn), ok);

  const starters = POSITIONS.map((pos) => t.starters[pos]).filter(Boolean);
  const groups: Array<[string, string[]]> = [
    ["주전", starters],
    ["1군 후보", t.bench],
    ["2군 (LCK CL)", t.academy],
  ];
  const last = [...w.history].reverse().find((h) => h.owner?.team === career.teamId);

  const actions = (p: PlayerState) => {
    const isStarter = starters.includes(p.id);
    const inAcademy = t.academy.includes(p.id);
    const focus = t.focus.includes(p.id);
    return (
      <>
        {!isStarter && (
          <button className="btn small" onClick={() => run((x) => setStarter(x, t.id, p.position, p.id), `${p.name} ${POS_KO[p.position]} 주전`)}>
            {POS_KO[p.position]} 주전으로
          </button>
        )}
        {t.bench.includes(p.id) && t.league === "LCK" && (
          <button className="btn small" onClick={() => run((x) => demote(x, t.id, p.id), `${p.name} 2군으로`)}>
            2군으로
          </button>
        )}
        {inAcademy && (
          <button className="btn small" onClick={() => run((x) => promote(x, t.id, p.id), `${p.name} 1군 후보로`)}>
            1군으로
          </button>
        )}
        <button className={`btn small ${focus ? "primary" : ""}`} onClick={() => run((x) => toggleFocus(x, t.id, p.id))}>
          {focus ? "집중 육성 해제" : "집중 육성"}
        </button>
        {!isStarter &&
          (armed === p.id ? (
            <>
              <button className="btn small" style={{ borderColor: "var(--bad)" }} onClick={() => run((x) => releaseMine(x, t.id, p.id), `${p.name} 방출 (FA)`)}>
                정말 방출
              </button>
              <button className="btn small ghost" onClick={() => setArmed(null)}>
                취소
              </button>
            </>
          ) : (
            <button className="btn small ghost" onClick={() => setArmed(p.id)}>
              방출
            </button>
          ))}
      </>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <span className="label">
            {TEAM_STYLE[career.teamId].name} · {seasonOf(career)}
          </span>
          <h1>구단</h1>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <span className={`chip ${pay > t.cap + 0.05 ? "bad" : "gold"}`} title="1군 연봉 합 / 연봉 상한 (가상 크레딧)">
            연봉 {fmt1(pay)} / {t.cap}C
          </span>
          <span className="chip" title="이적료로 쓸 수 있는 돈. 선수를 팔면 늘어남">
            이적 예산 {fmt1(t.transferBudget)}C
          </span>
          <span className="chip" title="주전을 오래 지킬수록 쌓이는 팀 고유 효과">
            팀워크 {teamworkLabel(t.teamwork)}
          </span>
          <span className="chip" title="최근 성적. FA 선수가 팀을 고를 때 봄">
            명성 {Math.round(t.prestige * 100)}
          </span>
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
      {issues.length > 0 && (
        <div className="notice" role="alert">
          등록 문제: {issues.map((x) => x.replace(/^(top|jng|mid|bot|sup)/, (m) => POS_KO[m as keyof typeof POS_KO])).join(", ")}
        </div>
      )}

      <div className="grid-2">
        <section className="panel">
          <h2>
            구단주 목표 <span className="label">{seasonOf(career)} 시즌</span>
          </h2>
          <ul className="goals">
            {career.goals.map((g) => (
              <li key={g.text}>{g.text}</li>
            ))}
          </ul>
          <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>
            {seasonOver(career) ? "시즌 결산은 스토브리그 첫 화면에서 봄." : "시즌이 끝나면 달성 여부로 평가 등급(S~D)을 매김. 경질은 없음."}
          </p>
        </section>
        <section className="panel">
          <h2>
            지난 평가 <span className="label">{last ? `${last.season} 시즌` : ""}</span>
          </h2>
          {last?.owner ? (
            <div className="stack" style={{ gap: 8 }}>
              <span className={`grade g-${last.owner.grade}`}>{last.owner.grade}</span>
              <ul className="goals">
                {last.owner.goals.map((g) => (
                  <li key={g.text} className={g.met ? "met" : "miss"}>
                    {g.met ? "✔" : "✘"} {g.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="empty">첫 시즌</div>
          )}
        </section>
      </div>

      <section className="stack">
        <p className="muted" style={{ margin: 0, fontSize: 13, maxWidth: "75ch" }}>
          실력은 경기 능력 4개 평균(40~99). 별은 남은 성장 여유를 추정한 잠재력. 선수는 시즌 중 여러 번 성장하고(주전으로 많이 뛸수록, 어릴수록 많이), 24세부터 조금씩 떨어짐. 집중
          육성은 2명까지, 성장 ×1.5.
        </p>
        {groups.map(([label, ids]) =>
          ids.length === 0 ? null : (
            <section className="panel" key={label}>
              <h2>
                {label} <span className="label">{ids.length}명</span>
              </h2>
              <div className="pl-list">
                {ids.map((id) => {
                  const p = w.players[id];
                  const g = growth[id];
                  const total = g ? ((g.laning ?? 0) + (g.teamfight ?? 0) + (g.vision ?? 0) + (g.survival ?? 0)) / 4 : 0;
                  return (
                    <div key={id}>
                      <PlayerLine
                        p={p}
                        open={open === id}
                        onClick={() => setOpen(open === id ? null : id)}
                        right={
                          <span className="pl-right">
                            {t.focus.includes(id) && <span className="chip gold">집중</span>}
                            {g && Math.abs(total) >= 0.05 && <span className={`delta ${total > 0 ? "up" : "down"}`}>{signed1(total)}</span>}
                            <span className="faint num">
                              ~{p.contract?.endSeason} · {fmt1(p.contract?.salary ?? 0)}C
                            </span>
                          </span>
                        }
                      />
                      {open === id && (
                        <PlayerDetail p={p} world={w} growth={g}>
                          {actions(p)}
                        </PlayerDetail>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ),
        )}
      </section>

      <History career={career} />
    </div>
  );
}

function History({ career }: { career: Career }) {
  const list = [...career.world.history].reverse();
  const me = career.teamId;
  const label: Record<string, string> = { LCK: "LCK", MSI: "MSI", WORLDS: "월즈" };
  return (
    <section className="panel">
      <h2>역대 기록</h2>
      {list.length === 0 && <div className="empty">아직 끝난 시즌이 없음</div>}
      <div className="stack" style={{ gap: 0 }}>
        {list.map((h) => {
          const mine = h.places[me] ?? {};
          return (
            <div className="hist" key={h.season}>
              <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
                <b className="num">{h.season}</b>
                {(["LCK", "MSI", "WORLDS"] as const).map((ev) =>
                  h.champions[ev] ? (
                    <span className="row" key={ev} style={{ gap: 6 }}>
                      <span className="faint" style={{ fontSize: 12 }}>
                        {label[ev]}
                      </span>
                      <TeamBadge team={h.champions[ev]} size={18} />
                      <span style={{ fontSize: 13 }}>{h.champions[ev]}</span>
                    </span>
                  ) : null,
                )}
                {h.owner && <span className={`grade small g-${h.owner.grade}`}>{h.owner.grade}</span>}
              </div>
              <div className="faint" style={{ fontSize: 13 }}>
                내 팀: LCK {placeName("LCK", mine.LCK ?? null)}
                {mine.MSI ? ` · MSI ${placeName("MSI", mine.MSI)}` : ""}
                {` · 월즈 ${placeName("WORLDS", mine.WORLDS ?? null)}`}
              </div>
              {h.moves.length > 0 && (
                <details>
                  <summary className="faint" style={{ fontSize: 13 }}>
                    시즌 뒤 이적 {h.moves.length}건
                  </summary>
                  <ul className="log">
                    {h.moves.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
