/**
 * Sound recipes: one function per SoundId that renders a mono Float32Array at
 * dsp.SR. Each call gets its own seeded Rng so the SOUND_VARIANTS differ
 * slightly (pitch, decay, grain timing) while staying recognisable.
 *
 * Design notes (physics laboratory, readable, not cartoony):
 *  - impacts are modal "struck object" models per material family;
 *  - snaps get a very sharp broadband transient + fibre/grit micro-cracks +
 *    a body resonance so the moment of failure reads instantly;
 *  - creaks/groans are stick-slip pulse trains through resonator banks with a
 *    slow pitch warble (foreshadowing);
 *  - booms are sub sine sweeps + filtered noise, lightly saturated, with room.
 */
import type { SoundId } from './SoundSynth';
import {
  Rng,
  SR,
  addClick,
  addModes,
  addNoise,
  addStickSlip,
  addTone,
  buffer,
  dcBlock,
  filter,
  finish,
  normalize,
  onePoleLP,
  reverb,
  saturate,
  scatter,
} from './dsp';

export type Recipe = (rng: Rng) => Float32Array;

function done(buf: Float32Array, peak = 0.95): Float32Array {
  dcBlock(buf);
  normalize(buf, peak);
  return finish(buf);
}

// ------------------------------------------------------------------ weapon

const cannon: Recipe = (r) => {
  const b = buffer(2.2);
  const f = r.vary(0.08);
  // Sub boom with a fast downward glide (the "chest" of the shot).
  addTone(b, { f0: 118 * f, f1: 36 * f, glide: 0.07, amp: 1, attack: 0.002, decay: 0.34 * r.vary(0.12) });
  addTone(b, { f0: 190 * f, f1: 70 * f, glide: 0.03, amp: 0.45, attack: 0.001, decay: 0.09 });
  // Muzzle crack: bright, very short.
  addNoise(b, r, { dur: 0.05, amp: 0.95, attack: 0.0004, decay: 0.009, type: 'highpass', freq: 1400 });
  addNoise(b, r, { dur: 0.16, amp: 0.55, attack: 0.001, decay: 0.035, type: 'bandpass', freq: 700, q: 0.6 });
  // Gas blast and rolling tail.
  addNoise(b, r, { dur: 1.9, amp: 0.55, attack: 0.004, decay: 0.42 * r.vary(0.15), color: 'brown', type: 'lowpass', freq: 900, freqEnd: 160, glide: 0.35 });
  addNoise(b, r, { dur: 0.9, amp: 0.18, attack: 0.01, decay: 0.2, color: 'pink', type: 'lowpass', freq: 3500, freqEnd: 400, glide: 0.18 });
  saturate(b, 2.2);
  reverb(b, 0.22, 0.84, 0.45, 1.3);
  return done(b);
};

/** Machine-gun report: a tight crack with a short body and a little room. */
const gunshot: Recipe = (r) => {
  const b = buffer(0.5);
  const f = r.vary(0.1);
  addNoise(b, r, { dur: 0.03, amp: 1, attack: 0.0003, decay: 0.006, type: 'highpass', freq: 1800 * f });
  addNoise(b, r, { dur: 0.12, amp: 0.6, attack: 0.0006, decay: 0.022, type: 'bandpass', freq: 900 * f, q: 0.8 });
  addTone(b, { f0: 160 * f, f1: 70 * f, glide: 0.03, amp: 0.55, attack: 0.001, decay: 0.05 });
  addNoise(b, r, { dur: 0.4, amp: 0.2, attack: 0.002, decay: 0.08, color: 'pink', type: 'lowpass', freq: 2500, freqEnd: 500, glide: 0.1 });
  saturate(b, 1.8);
  reverb(b, 0.12, 0.7, 0.5, 0.5);
  return done(b, 0.9);
};

const reload: Recipe = (r) => {
  const b = buffer(0.6);
  const t2 = 0.26 * r.vary(0.1);
  // Breech latch click.
  addClick(b, 0, 3100 * r.vary(0.08), 9, 0.7);
  addModes(b, r, 0, 2100 * r.vary(0.06), [1, 1.63, 2.71], [1, 0.5, 0.3], [0.03, 0.02, 0.012], 0.25);
  // Shell sliding in.
  addNoise(b, r, { start: 0.04, dur: t2 - 0.04, amp: 0.12, attack: 0.05, release: 0.03, type: 'bandpass', freq: 1400, freqEnd: 2600, glide: 0.1, q: 2.5 });
  // Heavy "chunk" as the block closes.
  addClick(b, t2, 1300 * r.vary(0.08), 5, 0.9);
  addTone(b, { start: t2, f0: 220, f1: 140, glide: 0.02, amp: 0.55, decay: 0.035 });
  addModes(b, r, t2, 900 * r.vary(0.06), [1, 2.4, 3.9], [1, 0.4, 0.2], [0.06, 0.03, 0.02], 0.3);
  reverb(b, 0.12, 0.6, 0.5, 0.6);
  return done(b, 0.9);
};

// ------------------------------------------------------------------ impacts

const impactWood: Recipe = (r) => {
  const b = buffer(0.45);
  const f0 = r.range(170, 250);
  addModes(b, r, 0, f0, [1, 2.32, 3.87, 5.61], [1, 0.55, 0.3, 0.14], [0.085, 0.05, 0.032, 0.02], 1, 0.02);
  addTone(b, { f0: 110, f1: 80, glide: 0.02, amp: 0.5, decay: 0.045 });
  addNoise(b, r, { dur: 0.03, amp: 0.55, attack: 0.0003, decay: 0.004, type: 'lowpass', freq: 3200 });
  addNoise(b, r, { dur: 0.08, amp: 0.12, attack: 0.001, decay: 0.02, type: 'bandpass', freq: 900, q: 1.2 });
  reverb(b, 0.1, 0.65, 0.5, 0.7);
  return done(b);
};

const impactStone: Recipe = (r) => {
  const b = buffer(0.6);
  addTone(b, { f0: r.range(95, 120), f1: 62, glide: 0.04, amp: 1, decay: 0.07 });
  addNoise(b, r, { dur: 0.25, amp: 0.8, attack: 0.0005, decay: 0.035, type: 'lowpass', freq: 1400, freqEnd: 500, glide: 0.05 });
  addModes(b, r, 0, r.range(420, 560), [1, 1.73, 2.9], [0.5, 0.3, 0.2], [0.025, 0.018, 0.012], 0.45, 0.05);
  // Grit crumbling off.
  scatter(r, r.int(8, 14), 0.01, 0.25, 0.07, (t, w) => {
    addNoise(b, r, { start: t, dur: 0.012, amp: 0.22 * w * r.range(0.4, 1), attack: 0.0003, decay: 0.002, type: 'bandpass', freq: r.range(1800, 5000), q: 1.5 });
  });
  reverb(b, 0.12, 0.7, 0.5, 0.8);
  return done(b);
};

const impactMetal: Recipe = (r) => {
  const b = buffer(1.5);
  const f0 = r.range(280, 420);
  // Free beam / plate partials, a couple detuned for beating shimmer.
  addModes(b, r, 0, f0, [1, 1.006, 2.76, 5.4, 8.93, 3.91], [1, 0.6, 0.55, 0.35, 0.18, 0.25], [0.55, 0.5, 0.35, 0.22, 0.12, 0.28], 0.85, 0.008);
  addTone(b, { f0: 140, f1: 95, glide: 0.02, amp: 0.55, decay: 0.05 });
  addNoise(b, r, { dur: 0.02, amp: 0.6, attack: 0.0002, decay: 0.003, type: 'highpass', freq: 2200 });
  reverb(b, 0.2, 0.8, 0.3, 1);
  return done(b, 0.9);
};

const impactGlass: Recipe = (r) => {
  const b = buffer(0.5);
  const f0 = r.range(1900, 2700);
  addModes(b, r, 0, f0, [1, 2.32, 4.25, 6.63], [1, 0.55, 0.3, 0.16], [0.16, 0.09, 0.05, 0.03], 1, 0.01);
  addNoise(b, r, { dur: 0.015, amp: 0.35, attack: 0.0002, decay: 0.002, type: 'highpass', freq: 4500 });
  reverb(b, 0.14, 0.72, 0.25, 0.7);
  return done(b, 0.85);
};

const impactRubber: Recipe = (r) => {
  const b = buffer(0.35);
  const f = r.vary(0.1);
  addTone(b, { f0: 270 * f, f1: 135 * f, glide: 0.045, amp: 1, attack: 0.002, decay: 0.08 });
  addTone(b, { f0: 540 * f, f1: 270 * f, glide: 0.045, amp: 0.2, attack: 0.002, decay: 0.04 });
  addNoise(b, r, { dur: 0.05, amp: 0.25, attack: 0.001, decay: 0.012, type: 'lowpass', freq: 700 });
  return done(b, 0.85);
};

const impactGround: Recipe = (r) => {
  const b = buffer(0.8);
  addTone(b, { f0: r.range(62, 75), f1: 38, glide: 0.06, amp: 1, attack: 0.001, decay: 0.14 });
  addNoise(b, r, { dur: 0.4, amp: 0.7, attack: 0.001, decay: 0.07, color: 'brown', type: 'lowpass', freq: 600, freqEnd: 220, glide: 0.08 });
  addNoise(b, r, { dur: 0.06, amp: 0.25, attack: 0.0005, decay: 0.01, type: 'bandpass', freq: 1100, q: 0.8 });
  scatter(r, r.int(6, 10), 0.02, 0.35, 0.1, (t, w) => {
    addNoise(b, r, { start: t, dur: 0.02, amp: 0.12 * w, attack: 0.0005, decay: 0.004, type: 'bandpass', freq: r.range(700, 2200), q: 1.2 });
  });
  saturate(b, 1.4);
  reverb(b, 0.1, 0.7, 0.55, 0.9);
  return done(b);
};

// ------------------------------------------------------------------ snaps

const snapWood: Recipe = (r) => {
  const b = buffer(0.9);
  // The CRACK: a razor transient...
  addClick(b, 0, 2600 * r.vary(0.15), 1.6, 1);
  addNoise(b, r, { dur: 0.03, amp: 1, attack: 0.0001, decay: 0.0035, type: 'highpass', freq: 700 });
  // ...then fibres tearing in a quick irregular burst.
  scatter(r, r.int(9, 15), 0.002, 0.14, 0.03, (t, w) => {
    const f = r.range(1500, 5200);
    addNoise(b, r, { start: t, dur: 0.012, amp: 0.65 * w * r.range(0.4, 1), attack: 0.0001, decay: r.range(0.0008, 0.003), type: 'bandpass', freq: f, q: 1.1 });
    if (r.next() < 0.35) addClick(b, t, f * 0.6, 3, 0.35 * w);
  });
  // Body "thock" of the beam giving way.
  addModes(b, r, 0.001, r.range(130, 200), [1, 2.08, 3.7], [1, 0.5, 0.25], [0.11, 0.06, 0.035], 0.7, 0.03);
  addTone(b, { f0: 95, f1: 62, glide: 0.03, amp: 0.45, decay: 0.06 });
  saturate(b, 1.8);
  reverb(b, 0.2, 0.78, 0.35, 1);
  return done(b);
};

const snapStone: Recipe = (r) => {
  const b = buffer(1.0);
  addNoise(b, r, { dur: 0.04, amp: 1, attack: 0.0001, decay: 0.005, type: 'highpass', freq: 1400 });
  addClick(b, 0, 1900 * r.vary(0.15), 1.4, 0.8);
  addNoise(b, r, { dur: 0.3, amp: 0.8, attack: 0.0005, decay: 0.05, type: 'lowpass', freq: 1100, freqEnd: 400, glide: 0.08 });
  addTone(b, { f0: 85, f1: 50, glide: 0.04, amp: 0.7, decay: 0.09 });
  // Crumbling grit tail.
  scatter(r, r.int(18, 28), 0.02, 0.55, 0.14, (t, w) => {
    addNoise(b, r, { start: t, dur: 0.015, amp: 0.32 * w * r.range(0.3, 1), attack: 0.0002, decay: r.range(0.001, 0.004), type: 'bandpass', freq: r.range(900, 4200), q: 1.3 });
  });
  addNoise(b, r, { start: 0.02, dur: 0.5, amp: 0.12, attack: 0.02, decay: 0.15, type: 'bandpass', freq: 2200, q: 0.8 });
  saturate(b, 1.5);
  reverb(b, 0.2, 0.78, 0.45, 1);
  return done(b);
};

const snapMetal: Recipe = (r) => {
  const b = buffer(1.8);
  const f0 = r.range(680, 1050);
  addNoise(b, r, { dur: 0.02, amp: 0.9, attack: 0.0001, decay: 0.0025, type: 'highpass', freq: 3000 });
  addClick(b, 0, 4200, 2, 0.6);
  // Twang: the released member ringing, bending down slightly with decaying vibrato.
  addTone(b, { f0: f0 * 1.04, f1: f0, glide: 0.25, amp: 0.8, attack: 0.0005, decay: 0.45 * r.vary(0.15), vibRate: r.range(6, 9), vibDepth: 0.012, vibDecay: 0.3 });
  addTone(b, { f0: f0 * 2.02, f1: f0 * 2.0, glide: 0.2, amp: 0.3, attack: 0.0005, decay: 0.25 });
  addModes(b, r, 0, f0, [2.76, 4.1, 5.4], [0.3, 0.2, 0.12], [0.2, 0.12, 0.08], 0.6, 0.01);
  addTone(b, { f0: 190, f1: 150, glide: 0.05, amp: 0.45, decay: 0.2 });
  reverb(b, 0.24, 0.82, 0.25, 1.1);
  return done(b, 0.9);
};

// ------------------------------------------------------------------ stress

const creakWood: Recipe = (r) => {
  const b = buffer(1.1);
  const dur = r.range(0.7, 1.0);
  const base = r.range(360, 520);
  const rising = r.next() < 0.6;
  const rate = r.range(28, 55);
  addStickSlip(b, r, {
    dur,
    amp: 1,
    rate,
    rateEnd: rate * (rising ? r.range(1.3, 1.8) : r.range(0.6, 0.85)),
    warble: 0.22,
    warbleHz: r.range(0.9, 1.8),
    jitter: 0.12,
    resonators: [
      { f: base, q: 14, g: 1 },
      { f: base * 1.93, q: 16, g: 0.55 },
      { f: base * 3.1, q: 18, g: 0.3 },
      { f: base * 0.5, q: 6, g: 0.35 },
    ],
    attack: 0.14,
    release: 0.3,
    grit: 0.25,
  });
  onePoleLP(b, 5000);
  // Tame the pulse peaks so the creak carries at modest volume.
  normalize(b, 1);
  saturate(b, 2.5);
  reverb(b, 0.14, 0.7, 0.45, 0.8);
  return done(b, 0.9);
};

const groanMetal: Recipe = (r) => {
  const b = buffer(1.9);
  const dur = r.range(1.2, 1.6);
  const base = r.range(190, 260);
  const rate = r.range(22, 38);
  addStickSlip(b, r, {
    dur,
    amp: 1,
    rate,
    rateEnd: rate * r.range(0.7, 1.25),
    warble: 0.12,
    warbleHz: r.range(0.5, 1.1),
    jitter: 0.05,
    resonators: [
      { f: base, q: 28, g: 1 },
      { f: base * 1.87, q: 34, g: 0.7 },
      { f: base * 2.76, q: 40, g: 0.45 },
      { f: base * 4.03, q: 40, g: 0.25 },
    ],
    attack: 0.3,
    release: 0.55,
    grit: 0.1,
  });
  addTone(b, { f0: rate * 3, f1: rate * 2.6, glide: 0.8, amp: 0.05, attack: 0.25, decay: 0.6 });
  onePoleLP(b, 3500);
  normalize(b, 1);
  saturate(b, 1.6);
  reverb(b, 0.3, 0.84, 0.3, 1.2);
  return done(b, 0.85);
};

// ------------------------------------------------------------------ destruction

const shatter: Recipe = (r) => {
  const b = buffer(1.4);
  addNoise(b, r, { dur: 0.08, amp: 0.9, attack: 0.0002, decay: 0.022, type: 'highpass', freq: 2200 });
  addNoise(b, r, { dur: 0.05, amp: 0.4, attack: 0.0002, decay: 0.01, type: 'bandpass', freq: 5200, q: 1.5 });
  addModes(b, r, 0, r.range(1300, 1700), [1, 2.32, 4.25], [1, 0.5, 0.3], [0.08, 0.05, 0.03], 0.5, 0.02);
  // Tinkling shards.
  scatter(r, r.int(26, 40), 0.005, 0.85, 0.2, (t, w) => {
    const f = r.range(2400, 7800);
    addModes(b, r, t, f, [1, 2.41], [1, 0.4], [r.range(0.02, 0.07), 0.02], 0.3 * w * r.range(0.3, 1), 0.02);
  });
  reverb(b, 0.2, 0.75, 0.2, 0.9);
  return done(b, 0.9);
};

const explosion: Recipe = (r) => {
  const b = buffer(3.2);
  const f = r.vary(0.08);
  addTone(b, { f0: 75 * f, f1: 27 * f, glide: 0.18, amp: 1, attack: 0.003, decay: 0.7 * r.vary(0.12) });
  addNoise(b, r, { dur: 0.05, amp: 0.9, attack: 0.0002, decay: 0.01, type: 'highpass', freq: 1200 });
  addNoise(b, r, { dur: 2.6, amp: 0.95, attack: 0.002, decay: 0.45, type: 'lowpass', freq: 5200, freqEnd: 260, glide: 0.22 });
  addNoise(b, r, { dur: 3.0, amp: 0.55, attack: 0.05, decay: 1.0, color: 'brown', type: 'lowpass', freq: 220 });
  // Crackle / debris pops.
  scatter(r, r.int(30, 50), 0.01, 1.3, 0.35, (t, w) => {
    addNoise(b, r, { start: t, dur: 0.008, amp: 0.3 * w * r.range(0.3, 1), attack: 0.0001, decay: r.range(0.0006, 0.002), type: 'highpass', freq: r.range(1500, 4000) });
  });
  saturate(b, 2.6);
  reverb(b, 0.28, 0.86, 0.5, 1.4);
  return done(b);
};

const rumble: Recipe = (r) => {
  const b = buffer(3.4);
  addNoise(b, r, { dur: 3.3, amp: 1, attack: 0.35, release: 1.6, color: 'brown', type: 'lowpass', freq: r.range(100, 140), q: 0.9, amRate: r.range(1.4, 2.4), amDepth: 0.45 });
  addNoise(b, r, { dur: 3.0, amp: 0.25, attack: 0.3, release: 1.4, color: 'pink', type: 'lowpass', freq: 700, amRate: r.range(3, 5), amDepth: 0.6 });
  scatter(r, r.int(5, 9), 0.05, 2.2, 0.9, (t, w) => {
    addTone(b, { start: t, f0: r.range(50, 70), f1: 38, glide: 0.05, amp: 0.5 * w, attack: 0.005, decay: 0.12 });
  });
  scatter(r, r.int(20, 30), 0.1, 2.4, 1.0, (t, w) => {
    addNoise(b, r, { start: t, dur: 0.02, amp: 0.1 * w, attack: 0.0005, decay: 0.004, type: 'bandpass', freq: r.range(500, 1800), q: 1.2 });
  });
  reverb(b, 0.2, 0.8, 0.6, 1.2);
  return done(b, 0.9);
};

const debris: Recipe = (r) => {
  const b = buffer(1.1);
  scatter(r, r.int(14, 24), 0.0, 0.85, 0.25, (t, w) => {
    const stone = r.next() < 0.5;
    const f = stone ? r.range(500, 1300) : r.range(260, 700);
    addModes(b, r, t, f, stone ? [1, 1.7] : [1, 2.3], [1, 0.4], stone ? [0.015, 0.01] : [0.03, 0.018], 0.45 * w * r.range(0.35, 1), 0.04);
    addNoise(b, r, { start: t, dur: 0.01, amp: 0.2 * w, attack: 0.0001, decay: 0.0015, type: 'bandpass', freq: r.range(1500, 4500), q: 1 });
  });
  reverb(b, 0.14, 0.7, 0.5, 0.9);
  return done(b, 0.9);
};

const whoosh: Recipe = (r) => {
  const b = buffer(0.7);
  const n = b.length;
  const src = new Float32Array(n);
  for (let i = 0; i < n; i++) src[i] = r.bi();
  // Band-pass sweep whose centre rises then falls with the envelope.
  filter(src, 'bandpass', 350, 1.3, 1500 * r.vary(0.15), 0.18);
  const peak = 0.32 * r.vary(0.15);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const e = t < peak ? Math.pow(t / peak, 2) : Math.exp(-(t - peak) / 0.09);
    b[i] = src[i]! * e;
  }
  onePoleLP(b, 4000);
  return done(b, 0.8);
};

// ------------------------------------------------------------------ UI

const uiClick: Recipe = (r) => {
  const b = buffer(0.08);
  const f = r.vary(0.05);
  addTone(b, { f0: 1750 * f, amp: 0.7, attack: 0.0005, decay: 0.012 });
  addTone(b, { f0: 2630 * f, amp: 0.25, attack: 0.0005, decay: 0.008 });
  addNoise(b, r, { dur: 0.006, amp: 0.25, attack: 0.0001, decay: 0.001, type: 'highpass', freq: 5000 });
  return done(b, 0.7);
};

const uiBuy: Recipe = (r) => {
  const b = buffer(0.7);
  const f = 660 * r.vary(0.03);
  const bell = (start: number, fr: number, amp: number): void => {
    addTone(b, { start, f0: fr, amp, attack: 0.002, decay: 0.2 });
    addTone(b, { start, f0: fr * 2, amp: amp * 0.3, attack: 0.002, decay: 0.12 });
    addTone(b, { start, f0: fr * 3.01, amp: amp * 0.1, attack: 0.002, decay: 0.07 });
  };
  bell(0, f, 0.7);
  bell(0.075, f * 1.5, 0.8);
  reverb(b, 0.18, 0.7, 0.3, 0.7);
  return done(b, 0.7);
};

const uiDeny: Recipe = (r) => {
  const b = buffer(0.32);
  const f = 150 * r.vary(0.04);
  addTone(b, { f0: f, amp: 0.6, attack: 0.003, decay: 0.2, dur: 0.075, shape: 1 });
  addTone(b, { start: 0.11, f0: f * 0.94, amp: 0.6, attack: 0.003, decay: 0.2, dur: 0.09, shape: 1 });
  filter(b, 'lowpass', 1400, 0.8);
  return done(b, 0.65);
};

const cash: Recipe = (r) => {
  const b = buffer(1.2);
  addClick(b, 0, 2200, 4, 0.6);
  addTone(b, { f0: 180, f1: 120, glide: 0.02, amp: 0.4, decay: 0.035 });
  addNoise(b, r, { start: 0.01, dur: 0.05, amp: 0.15, attack: 0.002, decay: 0.015, type: 'bandpass', freq: 3000, q: 2 });
  const f0 = r.range(1950, 2150);
  const bell = [1, 1.5, 2.0, 2.76, 3.01];
  const amps = [1, 0.45, 0.35, 0.2, 0.12];
  const dec = [0.45, 0.3, 0.25, 0.15, 0.12];
  addModes(b, r, 0.06, f0, bell, amps, dec, 0.45, 0.004);
  addModes(b, r, 0.13, f0 * 1.26, bell, amps, dec, 0.4, 0.004);
  reverb(b, 0.2, 0.75, 0.25, 0.8);
  return done(b, 0.75);
};

const collapseSting: Recipe = (r) => {
  const b = buffer(3.0);
  const root = 55 * r.vary(0.02);
  // Sub hit.
  addTone(b, { f0: root * 1.2, f1: root * 0.8, glide: 0.25, amp: 0.9, attack: 0.004, decay: 0.8 });
  // Low minor voicing swelling in, lowpassed later.
  const chord = [1, 1.5, 2, 2.378, 3];
  for (let i = 0; i < chord.length; i++) {
    addTone(b, { f0: root * chord[i]! * r.vary(0.002), amp: 0.22 / (1 + i * 0.3), attack: 0.06, decay: 1.1, shape: 0.25 });
    addTone(b, { f0: root * chord[i]! * 1.004, amp: 0.12 / (1 + i * 0.3), attack: 0.08, decay: 1.0 });
  }
  // Air swell + high shimmer.
  addNoise(b, r, { dur: 1.8, amp: 0.3, attack: 0.08, decay: 0.5, type: 'bandpass', freq: 500, freqEnd: 250, glide: 0.8, q: 0.7 });
  addTone(b, { start: 0.02, f0: 880 * r.vary(0.01), amp: 0.06, attack: 0.15, decay: 0.9, vibRate: 5, vibDepth: 0.004 });
  addTone(b, { start: 0.02, f0: 1318.5 * r.vary(0.01), amp: 0.04, attack: 0.2, decay: 0.8, vibRate: 5.5, vibDepth: 0.004 });
  filter(b, 'lowpass', 2400, 0.7);
  saturate(b, 1.3);
  reverb(b, 0.4, 0.86, 0.4, 1.4);
  return done(b, 0.85);
};

export const RECIPES: Record<SoundId, Recipe> = {
  cannon,
  gunshot,
  reload,
  impact_wood: impactWood,
  impact_stone: impactStone,
  impact_metal: impactMetal,
  impact_glass: impactGlass,
  impact_rubber: impactRubber,
  impact_ground: impactGround,
  snap_wood: snapWood,
  snap_stone: snapStone,
  snap_metal: snapMetal,
  creak_wood: creakWood,
  groan_metal: groanMetal,
  shatter,
  explosion,
  rumble,
  debris,
  whoosh,
  ui_click: uiClick,
  ui_buy: uiBuy,
  ui_deny: uiDeny,
  cash,
  collapse_sting: collapseSting,
};

/** Synthesis priority: gameplay-critical sounds first (they become playable as soon as rendered). */
export const SYNTH_PRIORITY: SoundId[] = [
  'ui_click',
  'cannon',
  'gunshot',
  'impact_wood',
  'impact_stone',
  'snap_wood',
  'snap_stone',
  'impact_ground',
  'impact_metal',
  'snap_metal',
  'creak_wood',
  'impact_glass',
  'shatter',
  'explosion',
  'debris',
  'rumble',
  'groan_metal',
  'impact_rubber',
  'reload',
  'whoosh',
  'ui_buy',
  'ui_deny',
  'cash',
  'collapse_sting',
];

function seedFor(id: string, variant: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0;
}

/** Render one variant of a sound (pure, deterministic; used by the worker and the main-thread fallback). */
export function renderSound(id: SoundId, variant: number): Float32Array {
  return RECIPES[id](new Rng(seedFor(id, variant)));
}
