// 라운드로빈 대진 (원형 배치법). 홀수 팀이면 매 라운드 한 팀이 쉰다.

export function roundRobin(list: string[]): Array<Array<[string, string]>> {
  const t = [...list];
  if (t.length % 2) t.push("");
  const rounds: Array<Array<[string, string]>> = [];
  for (let r = 0; r < t.length - 1; r++) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < t.length / 2; i++) {
      const [a, b] = [t[i], t[t.length - 1 - i]];
      if (a && b) pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    t.splice(1, 0, t.pop()!);
  }
  return rounds;
}

// 더블 라운드로빈: 첫 바퀴를 홈·원정만 바꿔 한 번 더
export function doubleRoundRobin(list: string[]): Array<Array<[string, string]>> {
  const legs = roundRobin(list);
  return [...legs, ...legs.map((r) => r.map(([a, b]) => [b, a] as [string, string]))];
}
