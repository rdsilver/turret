/**
 * Plays synthesized sounds in response to sim events. OWNER: audio agent.
 * - bind(sim): subscribe to impact, jointBroken, jointStressed (creaks),
 *   partShattered, explosion, projectileFired, projectileImpact, bigCollapse,
 *   objectiveComplete, partFallen. Volume (log scale) and pitch scale with
 *   physical magnitude; material selects the family; stereo pan from x
 *   position relative to the camera.
 * - Voice limiting: per-category max concurrent voices + min interval, and a
 *   global cap so collapses never turn into noise. Within a frame the loudest
 *   candidates of each event category win (pending slots flushed in update()).
 *   Random variant (never the same twice in a row) + rate jitter.
 * - Plays through Phaser's sound manager (scene.sound.play(key, config)).
 * - Rates follow sim time scale (slow-mo lowers pitch slightly).
 * - play() works without bind() (UI scenes); voice bookkeeping is shared by
 *   every AudioManager instance.
 */
import type * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import type { SimEvents } from '../sim/SimEvents';
import { MATERIALS, type MaterialId } from '../sim/Materials';
import { StructurePart } from '../sim/StructurePart';
import { PPM } from '../config/constants';
import { SOUND_VARIANTS, setMasterMuffle, soundDuration, soundKey, type SoundId } from './SoundSynth';

type Category = 'boom' | 'gun' | 'impact' | 'ground' | 'snap' | 'creak' | 'shatter' | 'ambient' | 'rattle' | 'air' | 'sting' | 'ui';

interface CategorySpec {
  max: number;
  /** Minimum ms between two starts in this category. */
  interval: number;
  /** Counts towards the global voice cap. */
  global: boolean;
}

const CATEGORIES: Record<Category, CategorySpec> = {
  boom: { max: 3, interval: 40, global: true },
  gun: { max: 4, interval: 45, global: false },
  impact: { max: 5, interval: 35, global: true },
  ground: { max: 2, interval: 90, global: true },
  snap: { max: 4, interval: 45, global: true },
  creak: { max: 2, interval: 170, global: true },
  shatter: { max: 2, interval: 90, global: true },
  ambient: { max: 2, interval: 400, global: true },
  rattle: { max: 2, interval: 250, global: true },
  air: { max: 1, interval: 500, global: true },
  sting: { max: 1, interval: 1500, global: false },
  ui: { max: 4, interval: 25, global: false },
};

const GLOBAL_CAP = 14;
/**
 * Real seconds after a hit-stop freeze during which the time scale is ignored:
 * EffectsManager ramps back to full speed over 90 ms (HITSTOP_RECOVER), which
 * would otherwise read as slow motion.
 */
const HITSTOP_HOLD = 0.12;

interface SoundSpec {
  cat: Category;
  /** Base volume (0..1) before magnitude scaling. */
  vol: number;
  /** +/- fractional rate jitter. */
  jitter: number;
}

const SOUNDS: Record<SoundId, SoundSpec> = {
  cannon: { cat: 'boom', vol: 0.8, jitter: 0.04 },
  gunshot: { cat: 'gun', vol: 0.42, jitter: 0.07 },
  reload: { cat: 'ui', vol: 0.3, jitter: 0.04 },
  impact_wood: { cat: 'impact', vol: 0.75, jitter: 0.08 },
  impact_stone: { cat: 'impact', vol: 0.8, jitter: 0.08 },
  impact_metal: { cat: 'impact', vol: 0.55, jitter: 0.06 },
  impact_glass: { cat: 'impact', vol: 0.5, jitter: 0.08 },
  impact_rubber: { cat: 'impact', vol: 0.6, jitter: 0.1 },
  impact_ground: { cat: 'ground', vol: 0.8, jitter: 0.08 },
  snap_wood: { cat: 'snap', vol: 0.85, jitter: 0.1 },
  snap_stone: { cat: 'snap', vol: 0.85, jitter: 0.08 },
  snap_metal: { cat: 'snap', vol: 0.6, jitter: 0.06 },
  creak_wood: { cat: 'creak', vol: 0.6, jitter: 0.12 },
  groan_metal: { cat: 'creak', vol: 0.45, jitter: 0.08 },
  shatter: { cat: 'shatter', vol: 0.65, jitter: 0.08 },
  explosion: { cat: 'boom', vol: 0.95, jitter: 0.05 },
  rumble: { cat: 'ambient', vol: 0.6, jitter: 0.05 },
  debris: { cat: 'rattle', vol: 0.45, jitter: 0.1 },
  whoosh: { cat: 'air', vol: 0.35, jitter: 0.1 },
  ui_click: { cat: 'ui', vol: 0.45, jitter: 0.03 },
  ui_buy: { cat: 'ui', vol: 0.55, jitter: 0.02 },
  ui_deny: { cat: 'ui', vol: 0.5, jitter: 0.02 },
  cash: { cat: 'ui', vol: 0.55, jitter: 0.02 },
  collapse_sting: { cat: 'sting', vol: 0.5, jitter: 0.01 },
};

/** Voice bookkeeping shared by every AudioManager (the sound manager is global). */
interface VoiceSlot {
  spec: CategorySpec;
  /** End times (ms, performance.now) of the voices started in this category. */
  ends: Float64Array;
  last: number;
}
const VOICES = {} as Record<Category, VoiceSlot>;
const VOICE_LIST: VoiceSlot[] = [];
for (const c of Object.keys(CATEGORIES) as Category[]) {
  const slot = { spec: CATEGORIES[c], ends: new Float64Array(CATEGORIES[c].max), last: -1e9 };
  VOICES[c] = slot;
  VOICE_LIST.push(slot);
}
const lastVariant = {} as Partial<Record<SoundId, number>>;

/** A buffered candidate sound (best-of-frame selection). */
interface Pending {
  id: SoundId | null;
  prio: number;
  vol: number;
  rate: number;
  x: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
/** 250 J -> 0, ~100 kJ -> 1. */
const energyScale = (e: number): number => clamp01(Math.log10(Math.max(1, e) / 250) / 2.6);
/** 8 kN -> 0, 800 kN -> 1. */
const ratingScale = (r: number): number => clamp01(Math.log10(Math.max(1, r) / 8000) / 2);

function impactSound(mat: MaterialId): SoundId {
  switch (MATERIALS[mat]?.sound) {
    case 'wood':
    case 'crate':
      return 'impact_wood';
    case 'metal':
      return 'impact_metal';
    case 'glass':
      return 'impact_glass';
    case 'rubber':
      return 'impact_rubber';
    default:
      return 'impact_stone';
  }
}

function snapSound(mat: MaterialId): SoundId {
  switch (MATERIALS[mat]?.sound) {
    case 'metal':
      return 'snap_metal';
    case 'stone':
    case 'glass':
      return 'snap_stone';
    default:
      return 'snap_wood';
  }
}

export class AudioManager {
  muted = false;
  volume = 0.8;

  private sim: Simulation | null = null;
  private offs: Array<() => void> = [];
  private rateFactor = 1;
  private wasReady = true;
  private lastPartFallen = -1e9;
  private firstSnapPending = false;
  private muffle = 0;
  /** Real seconds since the time scale was last frozen by a hit-stop. */
  private sinceFreeze = Infinity;
  private readonly cfg = { volume: 1, rate: 1, pan: 0 };
  /** Best-of-frame candidates per event category. */
  private readonly pending: Record<'impact' | 'ground' | 'snap' | 'creak', Pending[]> = {
    impact: [mkPending(), mkPending()],
    ground: [mkPending()],
    snap: [mkPending(), mkPending()],
    creak: [mkPending()],
  };

  constructor(readonly scene: Phaser.Scene) {}

  bind(sim: Simulation): void {
    this.unbind();
    this.sim = sim;
    this.wasReady = sim.weapon.ready;
    const on = <K extends keyof SimEvents>(type: K, fn: (e: SimEvents[K]) => void): void => {
      this.offs.push(
        sim.events.on(type, (e) => {
          if (!sim.settling) fn.call(this, e);
        }),
      );
    };
    on('projectileFired', this.onFired);
    on('projectileImpact', this.onProjectileImpact);
    on('impact', this.onImpact);
    on('jointStressed', this.onStressed);
    on('jointBroken', this.onBroken);
    on('partShattered', this.onShattered);
    on('explosion', this.onExplosion);
    on('bigCollapse', this.onBigCollapse);
    on('objectiveComplete', this.onObjective);
    on('partFallen', this.onPartFallen);
    on('chainStarted', this.onChainStarted);
  }

  unbind(): void {
    for (const off of this.offs) off();
    this.offs = [];
    if (this.sim && this.muffle > 0) setMasterMuffle(0);
    this.muffle = 0;
    this.sim = null;
    for (const list of Object.values(this.pending)) for (const p of list) p.id = null;
  }

  /**
   * Play a sound now (subject to voice limits). `pan` -1..1; `rate` multiplies
   * the jittered, slow-mo adjusted playback rate. Returns true if it started.
   */
  play(id: SoundId, opts: { volume?: number; rate?: number; pan?: number } = {}): boolean {
    return this.start(id, opts.volume ?? 1, opts.rate ?? 1, opts.pan ?? 0, SOUNDS[id]?.cat === 'ui');
  }

  /** Called every frame with the current sim time scale. */
  update(realDt: number, timeScale: number): void {
    // Hit-stop (a freeze plus a short ramp back to speed) is too short to matter:
    // hold pitch and muffle through it so only real slow motion bends the sound.
    if (timeScale < 0.05) this.sinceFreeze = 0;
    else this.sinceFreeze += realDt;
    const hold = this.sinceFreeze < HITSTOP_HOLD;
    // Slow motion lowers pitch a little...
    const target = hold ? this.rateFactor : 0.72 + 0.28 * clamp01((timeScale - 0.2) / 0.8);
    this.rateFactor += (target - this.rateFactor) * 0.25;
    // ...and muffles the world (master low-pass), like the moment is holding its breath.
    const muffle = hold ? this.muffle : clamp01((0.9 - timeScale) / 0.55);
    if (this.sim && Math.abs(muffle - this.muffle) > 0.01) {
      this.muffle = muffle;
      setMasterMuffle(muffle * 0.85);
    }

    const sim = this.sim;
    if (!sim) return;
    // Loudest candidates of this frame win their category's voices.
    this.flush(this.pending.snap);
    this.flush(this.pending.impact);
    this.flush(this.pending.ground);
    this.flush(this.pending.creak);

    // Reload "chunk" when the breech is ready again after a real shot.
    const w = sim.weapon;
    const ready = w.ready;
    if (ready && !this.wasReady && !w.unlimited && w.stats.reloadTime > 0.4) {
      this.play('reload', { pan: this.panFor(w.pivotX * PPM) });
    }
    this.wasReady = ready;
  }

  /** Mute this manager's new sounds and (globally) everything already playing. */
  setMuted(m: boolean): void {
    this.muted = m;
    const sm = this.scene.sound as unknown as { mute?: boolean } | null;
    if (sm && 'mute' in sm) sm.mute = m;
  }

  // ------------------------------------------------------------------ events

  private onFired(e: SimEvents['projectileFired']): void {
    if (e.projectile.mass < 8) {
      this.start('gunshot', 0.9, 1, this.panFor(e.x * PPM), false);
      return;
    }
    const rec = clamp(e.recoil, 0.3, 2);
    this.start('cannon', 0.75 + 0.25 * Math.min(1, rec), 1.05 - 0.08 * Math.min(1, rec - 0.5), this.panFor(e.x * PPM), false);
  }

  private onProjectileImpact(e: SimEvents['projectileImpact']): void {
    const x = e.x * PPM;
    const m = clamp01(e.impulse / 4500);
    if (e.hitGround) {
      if (e.projectile.mass < 8) this.queue(this.pending.ground, 'impact_ground', 0.2, 0.12, 1.4, x);
      else this.queue(this.pending.ground, 'impact_ground', 2 + m, 0.55 + 0.45 * m, 0.95, x);
      return;
    }
    const mat = e.target instanceof StructurePart ? e.target.material.id : null;
    if (!mat) return;
    if (e.projectile.mass < 8) {
      // Bullet hits: quiet, high ticks (armour pings), rate-limited by the impact category.
      if (e.first) this.queue(this.pending.impact, impactSound(mat), 0.3, 0.22, 1.35, x);
      return;
    }
    if (e.first) {
      // Play immediately and loud: this is the moment everything hangs on.
      this.start(impactSound(mat), 0.7 + 0.3 * m, 0.9, this.panFor(x), false);
      if (m > 0.5) this.queue(this.pending.ground, 'impact_ground', 1 + m, 0.3 + 0.3 * m, 1.1, x);
    } else if (e.speed > 5) {
      this.queue(this.pending.impact, impactSound(mat), 1 + m, 0.3 + 0.4 * m, 1, x);
    }
  }

  private onImpact(e: SimEvents['impact']): void {
    const ent = e.entity;
    const m = energyScale(e.energy);
    const x = e.x * PPM;
    // Smaller bodies sound higher, heavy ones lower.
    const rate = clamp(1.15 - 0.18 * Math.log10(Math.max(1, e.mass) / 200), 0.8, 1.4);
    const vol = 0.12 + 0.88 * m;
    if (ent.kind === 'projectile') {
      if (e.hitGround) this.queue(this.pending.ground, 'impact_ground', m, vol * 0.7, 1.05, x);
      return;
    }
    this.queue(this.pending.impact, impactSound(e.material), m, vol, rate, x);
    if (e.hitGround && m > 0.45) this.queue(this.pending.ground, 'impact_ground', m, 0.2 + 0.7 * (m - 0.45) / 0.55, clamp(rate, 0.85, 1.15), x);
  }

  private onStressed(e: SimEvents['jointStressed']): void {
    const fam = MATERIALS[e.material]?.sound;
    const d = clamp01(e.damage);
    const x = e.x * PPM;
    if (fam === 'metal') this.queue(this.pending.creak, 'groan_metal', d, 0.2 + 0.5 * d, 0.9 + 0.2 * Math.random(), x);
    else if (fam === 'stone') {
      // Stone does not creak: a faint grit trickle instead.
      if (d > 0.35) this.queue(this.pending.creak, 'debris', d * 0.5, 0.08 + 0.2 * d, 1.3, x);
    } else if (fam !== 'glass') this.queue(this.pending.creak, 'creak_wood', d + e.rate, 0.18 + 0.5 * d, 0.85 + 0.35 * Math.random(), x);
  }

  private onBroken(e: SimEvents['jointBroken']): void {
    if (e.cause === 'removed' || e.cause === 'shatter') return;
    const r = ratingScale(e.rating);
    // The weaker side of the bond is what snapped.
    const a = MATERIALS[e.materialA];
    const b = MATERIALS[e.materialB];
    const weak = b && e.materialB !== 'ground' && b.bond.tension < a.bond.tension ? e.materialB : e.materialA;
    const vol = (0.45 + 0.55 * r) * (e.cause === 'explosion' ? 0.6 : 1);
    if (this.firstSnapPending && e.cause !== 'explosion') {
      // The first failure of a chain is THE moment: play it now, a touch louder.
      this.firstSnapPending = false;
      if (this.start(snapSound(weak), Math.min(1.2, vol * 1.2), 1.1 - 0.3 * r, this.panFor(e.x * PPM), false)) return;
    }
    this.queue(this.pending.snap, snapSound(weak), 1 + r, vol, 1.15 - 0.3 * r, e.x * PPM);
  }

  private onChainStarted(): void {
    this.firstSnapPending = true;
  }

  private onShattered(e: SimEvents['partShattered']): void {
    const a = clamp01(e.part.area / 1.5);
    this.start('shatter', 0.45 + 0.55 * a, 1.1 - 0.2 * a, this.panFor(e.x * PPM), false);
  }

  private onExplosion(e: SimEvents['explosion']): void {
    const p = clamp(e.power, 0.2, 1.5);
    const x = e.x * PPM;
    this.start('explosion', 0.6 + 0.35 * Math.min(1, p), 1.1 - 0.15 * Math.min(1, p), this.panFor(x), false);
    if (p > 0.6) this.start('debris', 0.35, 1, this.panFor(x), false);
  }

  private onBigCollapse(e: SimEvents['bigCollapse']): void {
    const k = clamp01(e.intensity - 1);
    const x = e.x * PPM;
    this.start('rumble', 0.55 + 0.35 * k, 1, this.panFor(x) * 0.5, false);
    this.start('debris', 0.5 + 0.3 * k, 0.95, this.panFor(x), false);
    // Air rushing as the mass goes (ambient category; skipped if both voices are busy).
    this.start('whoosh', 0.35 + 0.25 * k, 0.7, this.panFor(x), false);
  }

  private onObjective(): void {
    this.start('collapse_sting', 0.6, 1, 0, false);
  }

  private onPartFallen(e: SimEvents['partFallen']): void {
    // Occasional rattle of rubble settling (ambient category rate-limits it further).
    const now = performance.now();
    if (now - this.lastPartFallen < 700 || e.part.mass < 60) return;
    this.lastPartFallen = now;
    this.start('debris', 0.2 + 0.2 * clamp01(e.part.mass / 1500), 1.05, this.panFor(e.part.x * PPM), false);
  }

  // ------------------------------------------------------------------ voices

  private queue(list: Pending[], id: SoundId, prio: number, vol: number, rate: number, x: number): void {
    // Replace the weakest slot if this candidate is stronger.
    let slot: Pending | null = null;
    for (const p of list) {
      if (p.id === null) {
        slot = p;
        break;
      }
      if (!slot || p.prio < slot.prio) slot = p;
    }
    if (!slot || (slot.id !== null && slot.prio >= prio)) return;
    slot.id = id;
    slot.prio = prio;
    slot.vol = vol;
    slot.rate = rate;
    slot.x = x;
  }

  private flush(list: Pending[]): void {
    // Highest priority first.
    for (;;) {
      let best: Pending | null = null;
      for (const p of list) if (p.id !== null && (!best || p.prio > best.prio)) best = p;
      if (!best) return;
      this.start(best.id!, best.vol, best.rate, this.panFor(best.x), false);
      best.id = null;
    }
  }

  private panFor(xPx: number): number {
    const view = this.scene.cameras?.main?.worldView;
    if (!view || view.width <= 0) return 0;
    return clamp((xPx - view.centerX) / (view.width * 0.5), -1, 1) * 0.7;
  }

  private start(id: SoundId, vol: number, rate: number, pan: number, ui: boolean): boolean {
    if (this.muted || this.volume <= 0) return false;
    const spec = SOUNDS[id];
    if (!spec) return false;
    const sm = this.scene.sound as unknown as {
      locked?: boolean;
      context?: BaseAudioContext;
      play(key: string, cfg: object): boolean;
    } | null;
    if (!sm || sm.locked) return false;
    // Nothing is audible while the context is suspended; playing would only pile up never-ending voices.
    if (!sm.context || sm.context.state !== 'running') return false;

    const now = performance.now();
    const slot = VOICES[spec.cat];
    const cs = slot.spec;
    if (now - slot.last < cs.interval) return false;
    const ends = slot.ends;
    let free = -1;
    for (let i = 0; i < ends.length; i++) if (ends[i]! <= now) free = i;
    if (free < 0) return false;
    if (cs.global && activeGlobal(now) >= GLOBAL_CAP) return false;

    // Pick a variant that exists, avoiding an immediate repeat.
    const lastV = lastVariant[id] ?? -1;
    let v = Math.floor(Math.random() * SOUND_VARIANTS);
    if (v === lastV) v = (v + 1) % SOUND_VARIANTS;
    let key = '';
    let dur = 0;
    for (let k = 0; k < SOUND_VARIANTS; k++) {
      const cand = soundKey(id, (v + k) % SOUND_VARIANTS);
      dur = soundDuration(cand);
      if (dur > 0) {
        key = cand;
        v = (v + k) % SOUND_VARIANTS;
        break;
      }
    }
    if (!key) return false; // still being synthesized

    const r = clamp(rate * (1 + (Math.random() * 2 - 1) * spec.jitter) * (ui ? 1 : this.rateFactor), 0.25, 4);
    const cfg = this.cfg;
    cfg.volume = clamp(spec.vol * vol * this.volume, 0, 1.5);
    cfg.rate = r;
    cfg.pan = clamp(pan, -1, 1);
    try {
      if (!sm.play(key, cfg)) return false;
    } catch (e) {
      console.warn(`[audio] play ${key} failed`, e);
      return false;
    }
    slot.last = now;
    lastVariant[id] = v;
    ends[free] = now + (dur / r) * 1000;
    return true;
  }
}

function mkPending(): Pending {
  return { id: null, prio: 0, vol: 0, rate: 1, x: 0 };
}

function activeGlobal(now: number): number {
  let n = 0;
  for (let k = 0; k < VOICE_LIST.length; k++) {
    const v = VOICE_LIST[k]!;
    if (!v.spec.global) continue;
    for (let i = 0; i < v.ends.length; i++) if (v.ends[i]! > now) n++;
  }
  return n;
}
