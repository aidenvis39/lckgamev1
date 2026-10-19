// 시드 고정 난수. 같은 시드면 같은 경기 결과가 나온다 (재현, 테스트, 리플레이용).

export interface Rng {
  next(): number; // [0, 1)
  normal(): number; // 표준정규분포
  int(n: number): number; // [0, n)
  poisson(lambda: number): number;
  fork(salt: string | number): Rng; // 독립된 하위 스트림 (경기별, 시리즈별)
}

export function hashSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  let spare: number | null = null;

  // mulberry32
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (): number => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    while (u === 0) u = next();
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };

  const poisson = (lambda: number): number => {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal()));
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= next();
    } while (p > limit);
    return k - 1;
  };

  return {
    next,
    normal,
    int: (n) => Math.floor(next() * n),
    poisson,
    fork: (salt) => createRng(hashSeed(seed, salt)),
  };
}

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
