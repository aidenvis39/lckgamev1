// 순위표. 게임용 동률 규칙: 시리즈 승수 → 세트 득실 → 동률 팀끼리 시리즈 승수 → 동률 팀끼리 세트 득실 → 고정 추첨 순서.
// 실제 대회의 동률 결정전은 아직 없다 (추첨 순서가 대신함).
import type { Match, Results } from "./types.ts";

export interface Standing {
  team: string;
  sw: number; // 시리즈 승
  sl: number;
  gw: number; // 세트 승
  gl: number;
  form: Array<"W" | "L">; // 최근 5시리즈, 오래된 것부터
}

// teams 밖 팀과의 경기도 성적에 넣는다 (LCK 그룹 순위 = 1~4라운드 전체 성적). 상대 전적은 동률 팀끼리만
export function standings(teams: string[], matches: Match[], results: Results, lottery: string[] = teams): Standing[] {
  const table = new Map<string, Standing>(teams.map((t) => [t, { team: t, sw: 0, sl: 0, gw: 0, gl: 0, form: [] }]));
  const played = matches.filter((m) => results[m.id] && (table.has(m.home) || table.has(m.away)));
  for (const m of [...played].sort((a, b) => a.day - b.day)) {
    const o = results[m.id];
    for (const [id, mine, theirs] of [[m.home, o.score[0], o.score[1]], [m.away, o.score[1], o.score[0]]] as const) {
      const t = table.get(id);
      if (!t) continue;
      t.gw += mine;
      t.gl += theirs;
      const won = o.winner === id;
      won ? t.sw++ : t.sl++;
      t.form = [...t.form, won ? ("W" as const) : ("L" as const)].slice(-5);
    }
  }
  const rank = new Map(lottery.map((t, i) => [t, i]));
  const head = (group: Set<string>) => {
    const h2h = new Map<string, [number, number]>([...group].map((t) => [t, [0, 0]]));
    for (const m of played) {
      if (!group.has(m.home) || !group.has(m.away)) continue;
      const o = results[m.id];
      const [hs, as] = o.score;
      const hh = h2h.get(m.home)!;
      const aa = h2h.get(m.away)!;
      hh[0] += o.winner === m.home ? 1 : 0;
      aa[0] += o.winner === m.away ? 1 : 0;
      hh[1] += hs - as;
      aa[1] += as - hs;
    }
    return h2h;
  };
  const base = (x: Standing, y: Standing) => y.sw - x.sw || y.gw - y.gl - (x.gw - x.gl);
  const sorted = [...table.values()].sort(base);
  // 같은 승수·득실끼리 묶어서 상대 전적과 추첨 순서로 다시 정렬
  const out: Standing[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1;
    while (j < sorted.length && base(sorted[i], sorted[j]) === 0) j++;
    const tied = sorted.slice(i, j);
    if (tied.length > 1) {
      const h2h = head(new Set(tied.map((s) => s.team)));
      tied.sort((x, y) => {
        const [xa, ya] = [h2h.get(x.team)!, h2h.get(y.team)!];
        return ya[0] - xa[0] || ya[1] - xa[1] || (rank.get(x.team) ?? 99) - (rank.get(y.team) ?? 99);
      });
    }
    out.push(...tied);
    i = j;
  }
  return out;
}
