// 밴픽 보드. 사용자가 한쪽을 맡고, 상대 차례는 AI가 잠깐 뜸을 들인 뒤 고른다.
import { useEffect, useMemo, useState } from "react";
import {
  aiChoice,
  applyChoice,
  currentTurn,
  DRAFT_ORDER,
  mastery,
  newDraft,
  other,
  pickValue,
  POSITIONS,
  rankOptions,
  toResult,
  type DraftContext,
  type DraftResult,
  type DraftState,
  type Position,
  type Rng,
  type Side,
} from "../../engine.ts";
import { metaTier, POS_KO } from "../../game/meta.ts";
import { ChampIcon } from "../../ui/bits.tsx";

interface Props {
  ctx: DraftContext;
  userSide: Side;
  unavailable: string[];
  rng: Rng;
  onDone: (draft: DraftResult) => void;
}

type Sort = "rec" | "meta" | "mast" | "name";

export function DraftBoard({ ctx, userSide, unavailable, rng, onDone }: Props) {
  const [s, setS] = useState<DraftState>(() => newDraft(unavailable));
  const [selected, setSelected] = useState<string | null>(null);
  const [pickPos, setPickPos] = useState<Position | null>(null);
  const [role, setRole] = useState<Position | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("rec");
  const turn = currentTurn(s);
  const myTurn = !!turn && turn[1] === userSide;

  // 상대(AI) 차례
  useEffect(() => {
    if (!turn) {
      const t = setTimeout(() => onDone(toResult(s)), 900);
      return () => clearTimeout(t);
    }
    if (turn[1] === userSide) return;
    const t = setTimeout(() => setS((cur) => applyChoice(cur, aiChoice(ctx, cur, rng))), 650);
    return () => clearTimeout(t);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  // 밴은 상대 기준 가치(상대가 가장 원할 챔피언), 픽은 우리 팀 기준 가치
  const options = useMemo(() => {
    if (!turn) return new Map<string, { value: number; position: Position }>();
    const side = turn[0] === "ban" ? other(userSide) : userSide;
    return new Map(rankOptions(ctx, s, side).map((o) => [o.champion, { value: o.value, position: o.position }]));
  }, [s, ctx, userSide, turn]);
  const openPositions = POSITIONS.filter((p) => !s.picks[userSide][p]);

  const champs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...ctx.u.champions.values()].filter(
      (c) => (role === "all" || (c.positions[role] ?? 0) >= 0.1) && (!q || c.nameKo.includes(q) || c.name.toLowerCase().includes(q)),
    );
    // 밴 차례엔 상대 선수, 픽 차례엔 우리 선수의 출전 경기 수
    const viewSide = turn?.[0] === "ban" ? other(userSide) : userSide;
    const mastAt = (id: string) => {
      const pos = role !== "all" ? role : options.get(id)?.position;
      return pos ? ctx.lineups[viewSide].players[pos].champions[id] ?? 0 : 0;
    };
    const by: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      rec: (a, b) => (options.get(b.id)?.value ?? -99) - (options.get(a.id)?.value ?? -99),
      meta: (a, b) => b.meta - a.meta,
      mast: (a, b) => mastAt(b.id) - mastAt(a.id),
      name: (a, b) => a.nameKo.localeCompare(b.nameKo, "ko"),
    };
    return list.sort(by[sort]).map((c) => ({ c, mast: mastAt(c.id) }));
  }, [ctx, query, role, sort, options, userSide]);

  const choose = (id: string) => {
    if (!myTurn || s.taken.has(id)) return;
    setSelected(id);
    if (turn![0] === "pick") {
      const champ = ctx.u.champions.get(id)!;
      const fits = openPositions.filter((p) => pickValue(ctx, s, userSide, champ, p) > -Infinity);
      const preferred = role !== "all" && openPositions.includes(role) ? role : null;
      const best = fits.sort((x, y) => pickValue(ctx, s, userSide, champ, y) - pickValue(ctx, s, userSide, champ, x))[0];
      setPickPos(preferred ?? best ?? openPositions[0]);
    }
  };

  const lockIn = () => {
    if (!myTurn || !selected) return;
    const [kind, side] = turn!;
    setS(applyChoice(s, kind === "ban" ? { kind, side, champion: selected } : { kind, side, champion: selected, position: pickPos! }));
    setSelected(null);
    setPickPos(null);
  };

  const autoFinish = () => {
    let cur = s;
    while (currentTurn(cur)) cur = applyChoice(cur, aiChoice(ctx, cur, rng));
    setS(cur);
  };

  const reason = (id: string) =>
    s.unavailable.has(id) ? "피어리스" : s.bans.blue.includes(id) || s.bans.red.includes(id) ? "밴" : s.taken.has(id) ? "픽" : "";
  const label = turnLabel(s);
  const top = [...options.entries()].slice(0, 5);
  const sel = selected ? ctx.u.champions.get(selected) : null;

  return (
    <div className="draft">
      <SideColumn side="blue" ctx={ctx} s={s} userSide={userSide} pendingPos={myTurn && turn?.[0] === "pick" ? pickPos : null} />
      <div className="draft-center">
        <div className="turn">
          <div className="stack" style={{ gap: 4 }}>
            <span className={`what ${turn?.[1] ?? ""}`}>{label}</span>
            <span className="muted" style={{ fontSize: 13 }}>
              {!turn ? "밴픽 완료 — 곧 경기가 시작됨" : myTurn ? "내 차례: 챔피언을 고르고 확정" : "상대가 고르는 중…"}
            </span>
          </div>
          <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
            <div className="steps" aria-hidden="true">
              {DRAFT_ORDER.map((_, i) => (
                <i key={i} className={i < s.turn ? "done" : i === s.turn ? "now" : ""} />
              ))}
            </div>
            {turn && (
              <button className="btn ghost small" onClick={autoFinish}>
                남은 밴픽 AI에게 맡기기
              </button>
            )}
          </div>
        </div>

        {myTurn && (
          <div className="suggest">
            <span className="muted">{turn![0] === "ban" ? "상대가 노릴 챔피언" : "추천"}</span>
            {top.map(([id, o]) => {
              const c = ctx.u.champions.get(id)!;
              return (
                <button key={id} onClick={() => choose(id)} aria-pressed={selected === id}>
                  <ChampIcon id={id} name={c.nameKo} size={24} />
                  {c.nameKo}
                  <span className="faint">{POS_KO[o.position]}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="filters">
          <div className="seg" role="group" aria-label="포지션 필터">
            <button aria-pressed={role === "all"} onClick={() => setRole("all")}>
              전체
            </button>
            {POSITIONS.map((p) => (
              <button key={p} aria-pressed={role === p} onClick={() => setRole(p)}>
                {POS_KO[p]}
              </button>
            ))}
          </div>
          <input id="champ-search" placeholder="챔피언 검색" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="챔피언 검색" />
          <select id="champ-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬" className="btn small">
            <option value="rec">추천순</option>
            <option value="meta">메타순</option>
            <option value="mast">숙련순</option>
            <option value="name">가나다순</option>
          </select>
        </div>

        <div className="champ-grid">
          {champs.map(({ c, mast }) => {
            const why = reason(c.id);
            return (
              <button key={c.id} className="tile" disabled={!!why || !myTurn} aria-pressed={selected === c.id} onClick={() => choose(c.id)} title={c.nameKo}>
                <ChampIcon id={c.id} name={c.nameKo} size={52} />
                <span className={`tier ${metaTier(c)}`}>{metaTier(c)}</span>
                {mast >= 1 && <span className="mast">{Math.round(mast)}</span>}
                <span className="nm">{c.nameKo}</span>
                {why && <span className="why">{why}</span>}
              </button>
            );
          })}
        </div>

        {myTurn && (
          <div className="lockbar">
            <div className="row" style={{ minWidth: 0 }}>
              {sel ? (
                <>
                  <ChampIcon id={sel.id} name={sel.nameKo} size={40} />
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{sel.nameKo}</strong>
                    {turn![0] === "pick" && pickPos && (
                      <span className="muted" style={{ fontSize: 12 }}>
                        {ctx.lineups[userSide].players[pickPos].name} 숙련도 {Math.round(mastery(ctx.lineups[userSide].players[pickPos], sel.id) * 100)}
                        {(sel.positions[pickPos] ?? 0) < 0.15 ? " · 비주류 포지션" : ""}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <span className="muted">챔피언을 고르세요</span>
              )}
            </div>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {turn![0] === "pick" && sel && (
                <div className="seg" role="group" aria-label="포지션">
                  {openPositions.map((p) => (
                    <button key={p} aria-pressed={pickPos === p} onClick={() => setPickPos(p)}>
                      {POS_KO[p]}
                    </button>
                  ))}
                </div>
              )}
              <button className="btn primary" disabled={!sel} onClick={lockIn}>
                {turn![0] === "ban" ? "밴 확정" : "픽 확정"}
              </button>
            </div>
          </div>
        )}
      </div>
      <SideColumn side="red" ctx={ctx} s={s} userSide={userSide} pendingPos={myTurn && turn?.[0] === "pick" ? pickPos : null} />
    </div>
  );
}

function turnLabel(s: DraftState): string {
  const turn = currentTurn(s);
  if (!turn) return "밴픽 완료";
  const [kind, side] = turn;
  const n = DRAFT_ORDER.slice(0, s.turn + 1).filter(([k, sd]) => k === kind && sd === side).length;
  return `${side === "blue" ? "블루" : "레드"} ${n}${kind === "ban" ? "밴" : "픽"}`;
}

function SideColumn({ side, ctx, s, userSide, pendingPos }: { side: Side; ctx: DraftContext; s: DraftState; userSide: Side; pendingPos: Position | null }) {
  const turn = currentTurn(s);
  const lineup = ctx.lineups[side];
  const banTurn = turn?.[0] === "ban" && turn[1] === side;
  return (
    <div className={`draft-side ${side}`}>
      <h3>
        <span>
          {side === "blue" ? "블루" : "레드"} · {lineup.team.id}
        </span>
        {side === userSide && <span className="faint">내 팀</span>}
      </h3>
      <div className="bans">
        {Array.from({ length: 5 }, (_, i) => {
          const id = s.bans[side][i];
          const c = id ? ctx.u.champions.get(id) : null;
          return (
            <div key={i} className={`ban ${c ? "" : "vacant"} ${banTurn && i === s.bans[side].length ? "active" : ""}`}>
              {c && <ChampIcon id={c.id} name={c.nameKo} size={40} />}
            </div>
          );
        })}
      </div>
      {POSITIONS.map((pos) => {
        const id = s.picks[side][pos];
        const c = id ? ctx.u.champions.get(id) : null;
        const active = side === userSide && pendingPos === pos;
        return (
          <div key={pos} className={`slot ${active ? "active" : ""}`}>
            {c ? <ChampIcon id={c.id} name={c.nameKo} size={48} /> : <span className="empty-ic">{POS_KO[pos]}</span>}
            <div className="who">
              <b>{lineup.players[pos].name}</b>
              <span>{c ? c.nameKo : POS_KO[pos]}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
