/**
 * Procedurally synthesized sound effects (no audio files). OWNER: audio agent.
 * registerSynthSounds(scene) renders AudioBuffers (a few variants each) and
 * adds them to scene.cache.audio so Phaser's WebAudio sound manager can play
 * them by key (`scene.sound.play('snap_wood_1', { volume, rate, pan })`).
 * Must no-op gracefully if WebAudio is unavailable.
 *
 * The DSP lives in dsp.ts (pure TS) and the per-sound designs in recipes.ts.
 * Rendering (~0.5-1 s of CPU in total) runs in a Web Worker, most important
 * sounds first; each buffer becomes playable the moment it arrives. Without
 * Worker support it falls back to rendering one sound per main-thread tick.
 * Also installs a gentle master compressor on Phaser's WebAudio output so a
 * collapse with many overlapping voices never clips.
 */
import type * as Phaser from 'phaser';
import { SR } from './dsp';
import { SYNTH_PRIORITY, renderSound } from './recipes';

export type SoundId =
  | 'cannon'
  | 'gunshot'
  | 'reload'
  | 'impact_wood'
  | 'impact_stone'
  | 'impact_metal'
  | 'impact_glass'
  | 'impact_rubber'
  | 'impact_ground'
  | 'snap_wood'
  | 'snap_stone'
  | 'snap_metal'
  | 'creak_wood'
  | 'groan_metal'
  | 'shatter'
  | 'explosion'
  | 'rumble'
  | 'debris'
  | 'whoosh'
  | 'ui_click'
  | 'ui_buy'
  | 'ui_deny'
  | 'cash'
  | 'collapse_sting'
  | 'mend';

/** Number of variants generated per sound; keys are `${id}_${n}`. */
export const SOUND_VARIANTS = 3;

/** Duration (s) of every registered buffer, by cache key. */
const durations = new Map<string, number>();
let started = false;

export function soundKey(id: SoundId, variant: number): string {
  return `${id}_${variant}`;
}

/** Duration in seconds of a registered sound key (0 = not registered yet). */
export function soundDuration(key: string): number {
  return durations.get(key) ?? 0;
}

/** The WebAudio context behind the scene's sound manager, or null (HTML5 / NoAudio managers). */
export function webAudioContext(scene: Phaser.Scene): BaseAudioContext | null {
  const sm = scene.sound as unknown as { context?: BaseAudioContext } | undefined;
  const ctx = sm?.context;
  if (!ctx || typeof ctx.createBuffer !== 'function') return null;
  return ctx;
}

export function registerSynthSounds(scene: Phaser.Scene): void {
  const ctx = webAudioContext(scene);
  if (!ctx || started) return;
  started = true;
  installMasterBus(scene, ctx);
  const cache = scene.cache.audio;

  // Variant 0 of everything first (in priority order), then the extra variants.
  const jobs: { id: SoundId; variant: number }[] = [];
  for (let v = 0; v < SOUND_VARIANTS; v++) {
    for (const id of SYNTH_PRIORITY) {
      const key = soundKey(id, v);
      const existing = cache.exists(key) ? (cache.get(key) as AudioBuffer | undefined) : undefined;
      if (existing) durations.set(key, existing.duration);
      else jobs.push({ id, variant: v });
    }
  }
  if (!jobs.length) return;

  const add = (id: SoundId, variant: number, data: Float32Array): void => {
    const key = soundKey(id, variant);
    if (cache.exists(key)) return;
    try {
      const ab = ctx.createBuffer(1, data.length, SR);
      ab.getChannelData(0).set(data);
      cache.add(key, ab);
      durations.set(key, ab.duration);
    } catch (e) {
      console.warn(`[audio] could not register ${key}`, e);
    }
  };

  if (!startWorker(jobs, add)) renderOnMainThread(jobs, add);
}

function startWorker(jobs: { id: SoundId; variant: number }[], add: (id: SoundId, v: number, d: Float32Array) => void): boolean {
  if (typeof Worker === 'undefined') return false;
  let worker: Worker;
  try {
    worker = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return false;
  }
  let received = 0;
  let fellBack = false;
  const fallback = (): void => {
    if (fellBack) return;
    fellBack = true;
    worker.terminate();
    renderOnMainThread(
      jobs.filter((j) => soundDuration(soundKey(j.id, j.variant)) === 0),
      add,
    );
  };
  worker.onmessage = (e: MessageEvent<{ id?: SoundId; variant?: number; data?: Float32Array; error?: string; done?: boolean }>) => {
    const m = e.data;
    if (m.done) {
      worker.terminate();
      if (received < jobs.length) fallback();
      return;
    }
    if (m.id && m.variant !== undefined && m.data) {
      received++;
      add(m.id, m.variant, m.data);
    } else if (m.error) console.warn(`[audio] synth ${m.id}_${m.variant} failed: ${m.error}`);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    console.warn('[audio] synth worker unavailable, rendering on main thread');
    fallback();
  };
  worker.postMessage({ jobs });
  return true;
}

/** Fallback: one sound per tick so the main thread never stalls for long. */
function renderOnMainThread(jobs: { id: SoundId; variant: number }[], add: (id: SoundId, v: number, d: Float32Array) => void): void {
  let i = 0;
  const tick = (): void => {
    const t0 = performance.now();
    while (i < jobs.length && performance.now() - t0 < 8) {
      const j = jobs[i++]!;
      try {
        add(j.id, j.variant, renderSound(j.id, j.variant));
      } catch (e) {
        console.warn(`[audio] synth ${j.id}_${j.variant} failed`, e);
      }
    }
    if (i < jobs.length) setTimeout(tick, 16);
  };
  setTimeout(tick, 0);
}

/** Master low-pass used to muffle the world during slow motion (null until installed). */
let busFilter: BiquadFilterNode | null = null;
let busCtx: BaseAudioContext | null = null;
let muffle = 0;

/**
 * Muffle the whole mix: 0 = open (20 kHz), 1 = heavily low-passed (~2.4 kHz).
 * Smoothly automated; cheap to call every frame (ignores tiny changes).
 */
export function setMasterMuffle(amount: number): void {
  const a = Math.max(0, Math.min(1, amount));
  if (!busFilter || !busCtx || Math.abs(a - muffle) < 0.01) return;
  muffle = a;
  const f = 20000 * Math.pow(2400 / 20000, a);
  try {
    busFilter.frequency.setTargetAtTime(f, busCtx.currentTime, 0.04);
  } catch {
    busFilter.frequency.value = f;
  }
}

/**
 * Route Phaser's master volume node through a low-pass (slow-mo muffle) and a
 * soft compressor so dense collapses stay loud but never clip. Idempotent.
 */
function installMasterBus(scene: Phaser.Scene, ctx: BaseAudioContext): void {
  const sm = scene.sound as unknown as { masterVolumeNode?: GainNode; __turretBus?: boolean };
  const out = sm.masterVolumeNode;
  if (!out || sm.__turretBus || typeof ctx.createDynamicsCompressor !== 'function') return;
  try {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 20000;
    lp.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    out.disconnect();
    out.connect(lp);
    lp.connect(comp);
    comp.connect(ctx.destination);
    busFilter = lp;
    busCtx = ctx;
    sm.__turretBus = true;
  } catch (e) {
    // Leave Phaser's default routing intact if anything goes wrong.
    try {
      out.connect(ctx.destination);
    } catch {
      /* ignore */
    }
    console.warn('[audio] master bus setup failed', e);
  }
}
