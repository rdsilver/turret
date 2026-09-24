/**
 * Tiny offline DSP toolkit for procedural sound effects (pure TS, no Web
 * Audio dependency, runs in Node too). Everything renders into mono
 * Float32Array buffers at `SR`; SoundSynth wraps the result in AudioBuffers.
 *
 * Building blocks: seeded noise, RBJ biquads (with swept cutoff), decaying
 * tones with pitch glide/vibrato, modal (inharmonic partial) synthesis,
 * grain scatter, a small Schroeder/Freeverb-style room, soft saturation and
 * normalisation. Only used at boot, so clarity beats micro-optimisation, but
 * inner loops still avoid per-sample allocation and most transcendental calls.
 */

export const SR = 44100;
const TAU = Math.PI * 2;

/** Deterministic PRNG (mulberry32) so variants are stable between runs. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  /** Uniform in [-1, 1). */
  bi(): number {
    return this.next() * 2 - 1;
  }
  /** Multiplicative jitter: 1 +/- amount. */
  vary(amount: number): number {
    return 1 + (this.next() * 2 - 1) * amount;
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
}

export function buffer(seconds: number): Float32Array {
  return new Float32Array(Math.max(1, Math.ceil(seconds * SR)));
}

// ------------------------------------------------------------------ filters

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peak';

/** RBJ cookbook biquad, transposed direct form II. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  constructor(
    readonly type: FilterType,
    freq: number,
    q = 0.707,
    gainDb = 0,
  ) {
    this.set(freq, q, gainDb);
  }

  set(freq: number, q = 0.707, gainDb = 0): void {
    const f = Math.min(Math.max(freq, 10), SR * 0.49);
    const w0 = (TAU * f) / SR;
    const cw = Math.cos(w0);
    const sw = Math.sin(w0);
    const alpha = sw / (2 * Math.max(0.05, q));
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    switch (this.type) {
      case 'lowpass':
        b0 = (1 - cw) / 2;
        b1 = 1 - cw;
        b2 = (1 - cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'highpass':
        b0 = (1 + cw) / 2;
        b1 = -(1 + cw);
        b2 = (1 + cw) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'bandpass': // constant 0 dB peak gain
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cw;
        a2 = 1 - alpha;
        break;
      case 'peak': {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + alpha * A;
        b1 = -2 * cw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cw;
        a2 = 1 - alpha / A;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = this.z2 = 0;
  }
}

/** Filter a whole buffer in place (optionally sweeping the cutoff exponentially from f0 to f1 with time constant `glide`). */
export function filter(buf: Float32Array, type: FilterType, f0: number, q = 0.707, f1 = f0, glide = 0.2, gainDb = 0): Float32Array {
  const bq = new Biquad(type, f0, q, gainDb);
  const sweep = f1 !== f0;
  const k = sweep ? Math.exp(-1 / (glide * SR)) : 1;
  let g = 1;
  for (let i = 0; i < buf.length; i++) {
    if (sweep && (i & 15) === 0) bq.set(f1 + (f0 - f1) * g, q, gainDb);
    g *= k;
    buf[i] = bq.process(buf[i]!);
  }
  return buf;
}

/** Simple one-pole lowpass (6 dB/oct), in place. */
export function onePoleLP(buf: Float32Array, freq: number): Float32Array {
  const a = Math.exp((-TAU * freq) / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = buf[i]! * (1 - a) + y * a;
    buf[i] = y;
  }
  return buf;
}

// ------------------------------------------------------------------ sources

export type NoiseColor = 'white' | 'pink' | 'brown';

export interface NoiseOpts {
  start?: number;
  dur: number;
  amp: number;
  attack?: number;
  /** Exponential decay time constant (s). Omit for a flat (held) envelope. */
  decay?: number;
  /** Linear release at the end of `dur` (s). */
  release?: number;
  color?: NoiseColor;
  /** Optional filter applied to the burst before mixing. */
  type?: FilterType;
  freq?: number;
  freqEnd?: number;
  glide?: number;
  q?: number;
  /** Amplitude modulation: rate (Hz) and depth 0..1. */
  amRate?: number;
  amDepth?: number;
}

/** Mix a (filtered, enveloped) noise burst into `out`. */
export function addNoise(out: Float32Array, rng: Rng, o: NoiseOpts): void {
  const s0 = Math.floor((o.start ?? 0) * SR);
  const n = Math.min(out.length - s0, Math.ceil(o.dur * SR));
  if (n <= 0) return;
  const tmp = new Float32Array(n);
  const color = o.color ?? 'white';
  let b0 = 0,
    b1 = 0,
    b2 = 0,
    brown = 0;
  for (let i = 0; i < n; i++) {
    const w = rng.bi();
    if (color === 'white') tmp[i] = w;
    else if (color === 'pink') {
      // Paul Kellet's economy pink filter.
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      tmp[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      tmp[i] = brown * 3.5;
    }
  }
  if (o.type) filter(tmp, o.type, o.freq ?? 1000, o.q ?? 0.707, o.freqEnd ?? o.freq ?? 1000, o.glide ?? 0.2);
  const attack = Math.max(1 / SR, o.attack ?? 0.001);
  const kd = o.decay ? Math.exp(-1 / (o.decay * SR)) : 1;
  const rel = o.release ?? 0.004;
  const relStart = n - Math.floor(rel * SR);
  const amW = o.amRate ? (TAU * o.amRate) / SR : 0;
  const amD = o.amDepth ?? 0;
  let env = 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let a = t < attack ? t / attack : 1;
    a *= env;
    env *= kd;
    if (i > relStart) a *= (n - i) / (n - relStart);
    if (amW) a *= 1 - amD * 0.5 * (1 + Math.sin(amW * i));
    out[s0 + i]! += tmp[i]! * a * o.amp;
  }
}

export interface ToneOpts {
  start?: number;
  /** Start frequency (Hz). */
  f0: number;
  /** Frequency approached exponentially (Hz); defaults to f0. */
  f1?: number;
  /** Pitch glide time constant (s). */
  glide?: number;
  amp: number;
  attack?: number;
  /** Amplitude decay time constant (s). */
  decay: number;
  /** Maximum duration (s); defaults to ~7 decay constants. */
  dur?: number;
  vibRate?: number;
  /** Vibrato depth as a fraction of frequency. */
  vibDepth?: number;
  /** Vibrato depth decay (s). */
  vibDecay?: number;
  /** 0 = sine, >0 adds odd harmonics (soft square-ish). */
  shape?: number;
  phase?: number;
}

/** Mix a decaying tone with optional exponential pitch glide and vibrato into `out`. */
export function addTone(out: Float32Array, o: ToneOpts): void {
  const s0 = Math.floor((o.start ?? 0) * SR);
  const dur = o.dur ?? o.decay * 7;
  const n = Math.min(out.length - s0, Math.ceil(dur * SR));
  if (n <= 0) return;
  const f1 = o.f1 ?? o.f0;
  const kg = o.glide ? Math.exp(-1 / (o.glide * SR)) : 0;
  const kd = Math.exp(-1 / (o.decay * SR));
  const attack = Math.max(1 / SR, o.attack ?? 0.001);
  const vibW = o.vibRate ? (TAU * o.vibRate) / SR : 0;
  const vibD = o.vibDepth ?? 0;
  const kv = o.vibDecay ? Math.exp(-1 / (o.vibDecay * SR)) : 1;
  const shape = o.shape ?? 0;
  const tail = Math.floor(0.004 * SR);
  let ph = o.phase ?? 0;
  let g = 1;
  let env = 1;
  let vib = 1;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let f = f1 + (o.f0 - f1) * g;
    g *= kg;
    if (vibW) {
      f *= 1 + vibD * vib * Math.sin(vibW * i);
      vib *= kv;
    }
    ph += (TAU * f) / SR;
    if (ph > TAU) ph -= TAU;
    let a = t < attack ? t / attack : 1;
    a *= env;
    env *= kd;
    if (i > n - tail) a *= (n - i) / tail;
    const sn = Math.sin(ph);
    let v = sn;
    if (shape > 0) {
      // sin(3x), sin(5x), sin(7x) as Chebyshev-style polynomials of sin(x): one sin() per sample.
      const s2 = sn * sn;
      const s3 = s2 * sn;
      const s5 = s3 * s2;
      const h3 = 3 * sn - 4 * s3;
      const h5 = 5 * sn - 20 * s3 + 16 * s5;
      const h7 = 7 * sn - 56 * s3 + 112 * s5 - 64 * s5 * s2;
      v += shape * (h3 / 3 + h5 / 5 + h7 / 7);
    }
    out[s0 + i]! += v * a * o.amp;
    if (env < 1e-4) break;
  }
}

/**
 * Modal synthesis: a struck object = sum of exponentially decaying partials.
 * `ratios` are relative to f0; `amps`/`decays` per partial.
 */
export function addModes(
  out: Float32Array,
  rng: Rng,
  start: number,
  f0: number,
  ratios: readonly number[],
  amps: readonly number[],
  decays: readonly number[],
  amp: number,
  detune = 0.01,
  attack = 0.0006,
): void {
  for (let k = 0; k < ratios.length; k++) {
    addTone(out, {
      start,
      f0: f0 * ratios[k]! * rng.vary(detune),
      amp: amp * amps[k]! * rng.vary(0.15),
      decay: decays[k]! * rng.vary(0.12),
      attack,
      phase: rng.next() * TAU,
    });
  }
}

/** Mix a single-sample-ish click through a resonant bandpass (crisp transient). */
export function addClick(out: Float32Array, start: number, freq: number, q: number, amp: number, dur = 0.03): void {
  const s0 = Math.floor(start * SR);
  const n = Math.min(out.length - s0, Math.ceil(dur * SR));
  if (n <= 0) return;
  const bq = new Biquad('bandpass', freq, q);
  for (let i = 0; i < n; i++) {
    const x = i === 0 ? 1 : i === 1 ? -0.6 : 0;
    out[s0 + i]! += bq.process(x) * amp * q * 0.9;
  }
}

/**
 * Stick-slip excitation (creaks, groans): an irregular impulse train whose rate
 * warbles slowly, fed through a bank of resonators.
 */
export function addStickSlip(
  out: Float32Array,
  rng: Rng,
  o: {
    start?: number;
    dur: number;
    amp: number;
    /** Base pulse rate (Hz) and a multiplicative drift from start to end. */
    rate: number;
    rateEnd?: number;
    /** Slow warble: depth (fraction) and rate (Hz). */
    warble: number;
    warbleHz: number;
    jitter: number;
    resonators: readonly { f: number; q: number; g: number }[];
    attack: number;
    release: number;
    /** Extra friction noise mixed per pulse (0..1). */
    grit?: number;
  },
): void {
  const s0 = Math.floor((o.start ?? 0) * SR);
  const n = Math.min(out.length - s0, Math.ceil(o.dur * SR));
  if (n <= 0) return;
  const exc = new Float32Array(n);
  let next = 0;
  const ph1 = rng.next() * TAU;
  const ph2 = rng.next() * TAU;
  const rateEnd = o.rateEnd ?? o.rate;
  const grit = o.grit ?? 0;
  while (next < n) {
    const t = next / SR;
    const u = t / o.dur;
    const rate = (o.rate + (rateEnd - o.rate) * u) * (1 + o.warble * Math.sin(TAU * o.warbleHz * t + ph1) + o.warble * 0.45 * Math.sin(TAU * o.warbleHz * 2.37 * t + ph2));
    const i = Math.floor(next);
    const a = 0.6 + 0.4 * rng.next();
    exc[i]! += a;
    if (grit > 0) {
      const len = Math.min(n - i, Math.floor(SR * 0.0025));
      for (let k = 1; k < len; k++) exc[i + k]! += rng.bi() * grit * a * (1 - k / len);
    }
    next += (SR / Math.max(4, rate)) * (1 + rng.bi() * o.jitter);
  }
  const bank = o.resonators.map((r) => ({ bq: new Biquad('bandpass', r.f, r.q), g: r.g * Math.sqrt(r.q) }));
  const att = o.attack * SR;
  const relStart = n - o.release * SR;
  for (let i = 0; i < n; i++) {
    const x = exc[i]!;
    let y = 0;
    for (let k = 0; k < bank.length; k++) y += bank[k]!.bq.process(x) * bank[k]!.g;
    let a = i < att ? i / att : 1;
    if (i > relStart) a *= Math.max(0, (n - i) / (n - relStart));
    out[s0 + i]! += y * a * o.amp;
  }
}

/**
 * Scatter `count` short events over [start, start+spread] (density falls off
 * exponentially with time constant `tau`); `fn(t, weight)` renders each one.
 */
export function scatter(rng: Rng, count: number, start: number, spread: number, tau: number, fn: (t: number, w: number) => void): void {
  for (let i = 0; i < count; i++) {
    const u = -Math.log(1 - rng.next() * (1 - Math.exp(-spread / tau))) * tau;
    fn(start + u, Math.exp(-u / (tau * 1.6)));
  }
}

// ------------------------------------------------------------------ processing

/** Small mono Freeverb-style room: 4 damped combs + 2 allpasses. Adds `mix` of wet signal. */
export function reverb(buf: Float32Array, mix: number, room = 0.78, damp = 0.35, size = 1): Float32Array {
  if (mix <= 0) return buf;
  const scale = SR / 44100;
  const combLens = [1116, 1188, 1277, 1356].map((d) => Math.floor(d * scale * size));
  const apLens = [556, 441].map((d) => Math.floor(d * scale * size));
  const wet = new Float32Array(buf.length);
  for (const len of combLens) {
    const line = new Float32Array(len);
    let idx = 0;
    let store = 0;
    for (let i = 0; i < buf.length; i++) {
      const y = line[idx]!;
      store = y * (1 - damp) + store * damp;
      line[idx] = buf[i]! * 0.25 + store * room;
      wet[i]! += y;
      if (++idx >= len) idx = 0;
    }
  }
  for (const len of apLens) {
    const line = new Float32Array(len);
    let idx = 0;
    for (let i = 0; i < wet.length; i++) {
      const b = line[idx]!;
      const x = wet[i]!;
      line[idx] = x + b * 0.5;
      wet[i] = b - x;
      if (++idx >= len) idx = 0;
    }
  }
  for (let i = 0; i < buf.length; i++) buf[i]! += wet[i]! * mix;
  return buf;
}

/** tanh soft clipper normalised so full-scale input stays full scale. */
export function saturate(buf: Float32Array, drive: number): Float32Array {
  const norm = 1 / Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i]! * drive) * norm;
  return buf;
}

/** Remove DC offset with a gentle one-pole highpass (~20 Hz). */
export function dcBlock(buf: Float32Array): Float32Array {
  const R = 1 - (TAU * 20) / SR;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i]!;
    const y = x - x1 + R * y1;
    x1 = x;
    y1 = y;
    buf[i] = y;
  }
  return buf;
}

export function normalize(buf: Float32Array, peak = 0.95): Float32Array {
  let m = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]!);
    if (a > m) m = a;
  }
  if (m < 1e-9) return buf;
  const g = peak / m;
  for (let i = 0; i < buf.length; i++) buf[i]! *= g;
  return buf;
}

/** Trim trailing near-silence (keeps a short tail) and fade the edges to avoid clicks. */
export function finish(buf: Float32Array, threshold = 0.0015): Float32Array {
  let end = buf.length - 1;
  while (end > 0 && Math.abs(buf[end]!) < threshold) end--;
  const len = Math.min(buf.length, end + Math.floor(0.02 * SR));
  const out = len < buf.length ? buf.slice(0, len) : buf;
  const fin = Math.min(Math.floor(0.0015 * SR), out.length);
  for (let i = 0; i < fin; i++) out[i]! *= i / fin;
  const fout = Math.min(Math.floor(0.012 * SR), out.length);
  for (let i = 0; i < fout; i++) out[out.length - 1 - i]! *= i / fout;
  return out;
}
