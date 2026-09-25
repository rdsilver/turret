/**
 * Deterministic seeded PRNG (sfc32) + helpers.
 *
 * Every generated structure is driven by one of these so the same seed always
 * regenerates the same demolition puzzle (daily challenges, shared seeds).
 */
export class Random {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  readonly seed: number;

  constructor(seed: number | string) {
    const s = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.seed = s;
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = s ^ 0xdeadbeef;
    for (let i = 0; i < 15; i++) this.next();
  }

  /** Uniform float in [0, 1). */
  next(): number {
    let a = this.a | 0,
      b = this.b | 0,
      c = this.c | 0,
      d = this.d | 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    return (t >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Random.pick on empty array');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** Weighted pick: weights need not sum to 1. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i] ?? 0;
      if (r <= 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Approximately normal (Irwin–Hall, 4 samples), mean 0, std ~1. */
  gaussian(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * Math.sqrt(3);
  }

  /** Create an independent child stream (stable for a given label). */
  fork(label: string | number): Random {
    return new Random((this.seed ^ hashString(String(label))) >>> 0);
  }
}

/** FNV-1a 32-bit string hash. */
export function hashString(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Human-friendly seed text <-> number. */
export function seedToString(seed: number): string {
  return (seed >>> 0).toString(36).toUpperCase().padStart(6, '0');
}

/**
 * Inverse of seedToString for every 32-bit seed (up to 7 base-36 chars, case-insensitive);
 * any other text is hashed (trimmed, lower-cased), so a word gives the same structure
 * wherever it is entered (main menu or debug panel).
 */
export function parseSeed(text: string): number {
  const clean = text.trim();
  if (/^[0-9a-z]{1,7}$/i.test(clean)) {
    const n = parseInt(clean, 36);
    if (n <= 0xffffffff) return n >>> 0;
  }
  return hashString(clean.toLowerCase());
}
