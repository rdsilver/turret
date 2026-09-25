/**
 * Game feel: particles, dust, splinters, sparks, shockwaves, flashes, camera
 * trauma, hit-stop and slow motion. OWNER: effects agent.
 *
 * Listens to sim.events (impact, projectileFired, projectileImpact,
 * jointStressed, jointBroken, partShattered, explosion, bigCollapse,
 * objectiveComplete, chainStarted) and reacts proportionally to physical
 * magnitude (energy, impulse, joint rating). Keep effects SUBTLE by default.
 *
 * Time control: `timeScale` is the value GameScene applies to
 * sim.physics.timeScale each frame (unless debug overrides it):
 *  - hit-stop: ~45-90 ms freeze (timeScale 0) on heavy projectile impacts,
 *    then a short ramp back so motion resumes smoothly;
 *  - slow motion: on bigCollapse, ease to ~0.35 over 80 ms, hold 0.6-0.9 s
 *    real time, ease back to 1 (one at a time, never stacked).
 *
 * Rendering: eight pooled Phaser particle emitters (one per texture/blend)
 * drive every effect through FxParticle's per-burst parameters, so events
 * never create game objects. Counts scale with magnitude, are rate-limited
 * (token buckets) and shrink when the scene is already busy.
 */
import * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import type { SimEvents } from '../sim/SimEvents';
import { MATERIALS, type MaterialId } from '../sim/Materials';
import { StructurePart } from '../sim/StructurePart';
import type { Projectile } from '../sim/weapons/Projectile';
import { PPM } from '../config/constants';
import type { CameraDirector } from './CameraDirector';
import { DEPTH } from './depths';
import { TEX } from './TextureKeys';
import { FxParticle, mixColor, resetBurst } from './fx/FxParticle';
import { FX_RING_RADIUS, FX_TEX, ensureFxTextures, resolveTexture } from './fx/FxTextures';
import { ScreenOverlay } from './fx/ScreenOverlay';

type Family = 'wood' | 'stone' | 'metal' | 'glass' | 'rubber';
type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

const HALF_PI = Math.PI / 2;
const UP = -HALF_PI;
/** Particle gravity (px/s^2): sim gravity 12 m/s^2 * PPM, a touch heavier so debris reads snappy. */
const G = 12 * PPM * 1.15;
const GROUND_DUST = 0x8f8a7e;

const SLOW_TARGET = 0.35;
const SLOW_IN = 0.08;
const SLOW_OUT = 0.45;
const HITSTOP_RECOVER = 0.09;

function family(id: MaterialId): Family {
  switch (id) {
    case 'wood':
    case 'explosive':
      return 'wood';
    case 'concrete':
    case 'stone':
    case 'ground':
      return 'stone';
    case 'steel':
    case 'iron':
    case 'cable':
    case 'core':
      return 'metal';
    case 'glass':
      return 'glass';
    case 'rubber':
      return 'rubber';
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 250 J -> 0, ~100 kJ -> 1 (log scale). */
const energyScale = (e: number): number => clamp01(Math.log10(Math.max(1, e) / 250) / 2.6);
/** 8 kN -> 0, 800 kN -> 1 (log scale). */
const ratingScale = (r: number): number => clamp01(Math.log10(Math.max(1, r) / 8000) / 2);

interface EmitterSpec {
  key: string;
  add: boolean;
  cap: number;
  depth: number;
  /** Runs at max(simTimeScale, realFloor) so flashes don't hang during hit-stop. */
  realFloor: number;
}

export class EffectsManager {
  /** Desired simulation time scale (1 = normal). */
  timeScale = 1;
  /** Allow slow-motion moments (settings/debug). */
  slowMoEnabled = true;
  /** Allow hit-stop freezes (settings/debug). */
  hitStopEnabled = true;
  /** Global multiplier on particle counts (settings / low-end devices). */
  intensity = 1;

  private readonly dust: Emitter;
  private readonly chips: Emitter;
  private readonly splinters: Emitter;
  private readonly sparks: Emitter;
  private readonly glints: Emitter;
  private readonly glow: Emitter;
  private readonly rings: Emitter;
  private readonly emitters: Emitter[] = [];
  private readonly floors: number[] = [];
  private readonly caps: number[] = [];
  private readonly overlay: ScreenOverlay;
  private offs: Array<() => void> = [];

  private readonly dustColor = {} as Record<MaterialId, number>;
  private readonly chipColor = {} as Record<MaterialId, number>;

  // Time control.
  private hitStopT = 0;
  private hitRecoverT = 0;
  private slowPhase: 0 | 1 | 2 | 3 = 0;
  private slowT = 0;
  private slowHold = 0.75;
  private slowFactor = 1;

  // Rate limiting / load.
  private impactTokens = 14;
  private stressTokens = 6;
  private snapLoad = 0;
  private density = 1;
  private firstSnapPending = false;
  private destroyed = false;

  constructor(
    readonly scene: Phaser.Scene,
    readonly sim: Simulation,
    readonly camera: CameraDirector,
  ) {
    const specs: EmitterSpec[] = [
      { key: TEX.soft, add: false, cap: 700, depth: DEPTH.particles, realFloor: 0 },
      { key: TEX.shard, add: false, cap: 450, depth: DEPTH.particles, realFloor: 0 },
      { key: TEX.sliver, add: false, cap: 450, depth: DEPTH.particles, realFloor: 0 },
      { key: TEX.sliver, add: true, cap: 450, depth: DEPTH.particles + 1, realFloor: 0 },
      { key: TEX.dot, add: true, cap: 300, depth: DEPTH.particles + 1, realFloor: 0 },
      { key: TEX.glow, add: true, cap: 90, depth: DEPTH.flash, realFloor: 0.5 },
      { key: FX_TEX.ring, add: false, cap: 40, depth: DEPTH.flash, realFloor: 0.5 },
    ];
    ensureFxTextures(scene);
    const mk = (s: EmitterSpec): Emitter => {
      const em = scene.add.particles(0, 0, resolveTexture(scene, s.key), {
        emitting: false,
        particleClass: FxParticle,
        maxAliveParticles: s.cap,
        reserve: Math.min(64, s.cap),
      });
      em.setDepth(s.depth);
      if (s.add) em.setBlendMode(Phaser.BlendModes.ADD);
      this.emitters.push(em);
      this.floors.push(s.realFloor);
      this.caps.push(s.cap);
      return em;
    };
    this.dust = mk(specs[0]!);
    this.chips = mk(specs[1]!);
    this.splinters = mk(specs[2]!);
    this.sparks = mk(specs[3]!);
    this.glints = mk(specs[4]!);
    this.glow = mk(specs[5]!);
    this.rings = mk(specs[6]!);
    this.overlay = new ScreenOverlay(scene);

    for (const id of Object.keys(MATERIALS) as MaterialId[]) {
      const pc = MATERIALS[id].particleColor;
      // Dust is paler and greyer than the material's chips.
      this.dustColor[id] = mixColor(pc, 0xd4cfc6, 0.45);
      this.chipColor[id] = pc;
    }
    this.dustColor.ground = GROUND_DUST;
    this.dustColor.steel = 0x9aa3ad;
    this.dustColor.iron = 0x8d9096;

    this.bind();
  }

  // ------------------------------------------------------------------ public

  update(realDt: number): void {
    if (this.destroyed) return;
    const dt = Math.min(0.1, Math.max(0, realDt));

    // Hit-stop: freeze, then a short ramp back to full speed.
    let hs = 1;
    if (this.hitStopT > 0) {
      this.hitStopT -= dt;
      hs = 0;
      if (this.hitStopT <= 0) this.hitRecoverT = HITSTOP_RECOVER;
    } else if (this.hitRecoverT > 0) {
      this.hitRecoverT = Math.max(0, this.hitRecoverT - dt);
      const u = 1 - this.hitRecoverT / HITSTOP_RECOVER;
      hs = 0.25 + 0.75 * u * u;
    }

    // Slow motion state machine (real time).
    let s = 1;
    switch (this.slowPhase) {
      case 1: {
        this.slowT += dt;
        const u = Math.min(1, this.slowT / SLOW_IN);
        s = 1 + (SLOW_TARGET - 1) * (1 - (1 - u) * (1 - u));
        if (u >= 1) {
          this.slowPhase = 2;
          this.slowT = 0;
        }
        break;
      }
      case 2:
        this.slowT += dt;
        s = SLOW_TARGET;
        if (this.slowT >= this.slowHold) {
          this.slowPhase = 3;
          this.slowT = 0;
        }
        break;
      case 3: {
        this.slowT += dt;
        const u = Math.min(1, this.slowT / SLOW_OUT);
        s = SLOW_TARGET + (1 - SLOW_TARGET) * (0.5 - 0.5 * Math.cos(Math.PI * u));
        if (u >= 1) {
          this.slowPhase = 0;
          s = 1;
        }
        break;
      }
    }
    this.slowFactor = s;
    this.timeScale = hs * s;

    // Particles follow simulation time (slow-mo / hit-stop / debug pause), flashes keep a floor.
    const ph = this.sim.physics;
    const simTs = ph.paused ? 0 : ph.timeScale;
    let alive = 0;
    for (let i = 0; i < this.emitters.length; i++) {
      const em = this.emitters[i]!;
      em.timeScale = ph.paused ? 0 : Math.max(simTs, this.floors[i]!);
      alive += em.getAliveParticleCount() / this.caps[i]!;
    }
    // Busy scene => smaller bursts (keeps big collapses readable and cheap).
    this.density = this.intensity / (1 + Math.max(0, alive - 0.6) * 1.5);

    // Rate-limit buckets refill in real time.
    this.impactTokens = Math.min(14, this.impactTokens + dt * 40);
    this.stressTokens = Math.min(6, this.stressTokens + dt * 10);
    this.snapLoad *= Math.exp(-dt * 2.2);

    const slowAmt = (1 - s) / (1 - SLOW_TARGET);
    this.overlay.update(dt, slowAmt);
  }

  /** Slow-motion component of the time scale (1 = none, ~0.35 at the deepest). */
  get slowMotion(): number {
    return this.slowFactor;
  }

  /** Is a slow-motion moment currently running? */
  get slowMoActive(): boolean {
    return this.slowPhase !== 0;
  }

  /** Freeze the simulation for `seconds` of real time (max-merged, never stacked). */
  hitStop(seconds: number): void {
    if (!this.hitStopEnabled || seconds <= 0) return;
    this.hitStopT = Math.max(this.hitStopT, Math.min(0.12, seconds));
    this.hitRecoverT = 0;
  }

  /** Start a slow-motion moment (ignored if one is already running). */
  slowMo(intensity = 1): void {
    if (!this.slowMoEnabled || this.slowPhase !== 0) return;
    this.slowPhase = 1;
    this.slowT = 0;
    this.slowHold = 0.6 + 0.3 * clamp01(intensity - 1);
  }

  /** Remove transient visuals (level change). */
  clear(): void {
    for (const em of this.emitters) em.killAll();
    this.hitStopT = this.hitRecoverT = 0;
    this.slowPhase = 0;
    this.slowT = 0;
    this.slowFactor = 1;
    this.timeScale = 1;
    this.impactTokens = 14;
    this.stressTokens = 6;
    this.snapLoad = 0;
    this.firstSnapPending = false;
    this.overlay.reset();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const off of this.offs) off();
    this.offs = [];
    for (const em of this.emitters) em.destroy();
    this.emitters.length = 0;
    this.overlay.destroy();
  }

  // ------------------------------------------------------------------ events

  private bind(): void {
    this.on('projectileFired', this.onFired);
    this.on('projectileImpact', this.onProjectileImpact);
    this.on('impact', this.onImpact);
    this.on('jointStressed', this.onJointStressed);
    this.on('jointBroken', this.onJointBroken);
    this.on('partShattered', this.onShattered);
    this.on('explosion', this.onExplosion);
    this.on('bigCollapse', this.onBigCollapse);
    this.on('objectiveComplete', this.onObjectiveComplete);
    this.on('chainStarted', this.onChainStarted);
  }

  /** Subscribe a handler; events are ignored while the level pre-settles. */
  private on<K extends keyof SimEvents>(type: K, fn: (e: SimEvents[K]) => void): void {
    this.offs.push(
      this.sim.events.on(type, (e) => {
        if (!this.sim.settling && !this.destroyed) fn.call(this, e);
      }),
    );
  }

  private onChainStarted(): void {
    this.firstSnapPending = true;
  }

  private onFired(e: SimEvents['projectileFired']): void {
    const x = e.x * PPM;
    const y = e.y * PPM;
    const a = Math.atan2(e.vy, e.vx);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rec = Math.max(0.3, Math.min(2, e.recoil));

    // Muzzle flash: hot core + a forward tongue.
    this.flash(x + ca * 8, y + sa * 8, 34 + 12 * rec, 0xfff1cf, 85, 0.95);
    this.flash(x + ca * 30, y + sa * 30, 22 + 8 * rec, 0xffb45e, 110, 0.7);

    // A few hot sparks thrown forward.
    const b = resetBurst();
    b.tint = 0xfff0c0;
    b.tintEnd = 0xff7a2a;
    b.angle = a;
    b.spread = 0.32;
    b.speedMin = 260;
    b.speedMax = 720;
    b.lifeMin = 90;
    b.lifeMax = 220;
    b.scaleMin = 0.5;
    b.scaleMax = 0.8;
    b.aspect = 0.8;
    b.stretch = 0.004;
    b.gravity = G * 0.5;
    b.drag = 2;
    b.alpha = 0.9;
    this.emit(this.sparks, x, y, 7 * rec);

    // Smoke puff drifting along the barrel line, then rising.
    resetBurst();
    b.tint = 0xb4b9c2;
    b.tintVar = 0.15;
    b.angle = a;
    b.spread = 0.45;
    b.speedMin = 50;
    b.speedMax = 230;
    b.lifeMin = 900;
    b.lifeMax = 1700;
    b.scaleMin = 0.45;
    b.scaleMax = 0.8;
    b.endScale = 3.2;
    b.easeOut = true;
    b.alpha = 0.3;
    b.alphaVar = 0.4;
    b.fadeIn = 0.06;
    b.fadePow = 1.6;
    b.drag = 2.4;
    b.gravity = -26;
    b.jitter = 6;
    this.emit(this.dust, x + ca * 10, y + sa * 10, 7 * rec);

    this.ring(x + ca * 6, y + sa * 6, 34 * rec, 170, 0.22, 0xfff1cf);
    this.camera.addTrauma(0.3 * rec);
  }

  private onProjectileImpact(e: SimEvents['projectileImpact']): void {
    const x = e.x * PPM;
    const y = e.y * PPM;
    const p = e.projectile;
    // Debris sprays back towards the shooter / off the surface.
    const back = Math.atan2(-p.preVy, -p.preVx);
    const mat: MaterialId | null = e.target instanceof StructurePart ? e.target.material.id : e.hitGround ? 'ground' : null;
    if (!e.first) {
      if (e.speed > 6 && mat) {
        const m = clamp01((e.speed - 6) / 20) * 0.5;
        if (e.hitGround) this.groundDust(x, m, GROUND_DUST);
        else this.materialBurst(mat, x, y, m, back, 1.2);
      }
      return;
    }
    const m = clamp01(e.impulse / 4500);
    if (!e.hitGround && e.target) this.hitStop(0.045 + 0.045 * m);

    this.flash(x, y, 24 + 26 * m, 0xffffff, 70, 0.85);
    this.ring(x, y, 34 + 40 * m, 200, 0.4, 0xffffff);
    if (e.hitGround) {
      this.groundDust(x, 0.6 + 0.6 * m, GROUND_DUST);
      this.materialBurst('ground', x, y, 0.5 + 0.5 * m, UP, 0.9);
      this.camera.addTrauma(0.22 + 0.2 * m);
    } else {
      if (mat) this.materialBurst(mat, x, y, 0.55 + 0.6 * m, back, 1.25);
      this.camera.addTrauma(0.34 + 0.3 * m);
      this.camera.punch(0.01 + 0.016 * m, e.x, e.y);
    }
  }

  private onImpact(e: SimEvents['impact']): void {
    const ent = e.entity;
    if (ent.kind === 'projectile') {
      // The shot's own first contact is handled by projectileImpact; later bounces kick up dust.
      if (e.hitGround && e.dv > 3 && this.sim.physics.simTime - (ent as Projectile).impactAt > 0.15 && this.takeImpactToken(1)) {
        this.groundDust(e.x * PPM, clamp01(e.dv / 15) * 0.5, GROUND_DUST);
      }
      return;
    }
    const m = energyScale(e.energy);
    if (!this.takeImpactToken(m > 0.45 ? 0.5 : 1)) return;
    const x = e.x * PPM;
    const y = e.y * PPM;
    if (e.hitGround) {
      this.groundDust(x, 0.1 + 0.9 * m, mixColor(this.dustColor[e.material], GROUND_DUST, 0.5));
      this.materialBurst(e.material, x, y, m * 0.8, UP, 1.0);
    } else {
      this.puff(x, y, 1 + 5 * m, this.dustColor[e.material], 8 + 14 * m, 0.3 + 0.2 * m);
      this.materialBurst(e.material, x, y, m * 0.7, 0, Math.PI);
    }
    if (m > 0.72 && !(e.other && e.other.kind === 'projectile')) this.camera.addTrauma(0.05 + 0.22 * ((m - 0.72) / 0.28), 0.6);
  }

  private onJointStressed(e: SimEvents['jointStressed']): void {
    if (this.stressTokens < 1) return;
    this.stressTokens -= 1;
    const x = e.x * PPM;
    const y = e.y * PPM;
    const d = clamp01(e.damage);
    const fam = family(e.material);
    const b = resetBurst();

    // Fine dust trickling from the joint: the structure is telling you something.
    b.tint = this.dustColor[e.material];
    b.tintVar = 0.15;
    b.angle = HALF_PI;
    b.spread = 0.5;
    b.speedMin = 4;
    b.speedMax = 26;
    b.lifeMin = 700;
    b.lifeMax = 1300;
    b.scaleMin = 0.14;
    b.scaleMax = 0.28;
    b.endScale = 1.8;
    b.alpha = 0.3 + 0.35 * d;
    b.fadeIn = 0.1;
    b.gravity = 140;
    b.drag = 1.5;
    b.jitter = 5;
    this.emit(this.dust, x, y, 1 + 2.5 * d + Math.random());

    if (fam === 'wood' && Math.random() < 0.35 + 0.6 * d) {
      // Loose fibres.
      resetBurst();
      b.tint = this.chipColor[e.material];
      b.tintVar = 0.3;
      b.angle = HALF_PI;
      b.spread = 1.2;
      b.speedMin = 15;
      b.speedMax = 60;
      b.lifeMin = 600;
      b.lifeMax = 1100;
      b.scaleMin = 0.3;
      b.scaleMax = 0.55;
      b.aspect = 0.7;
      b.gravity = G;
      b.spin = 10;
      b.bounce = 0.15;
      b.fadePow = 3;
      this.emit(this.splinters, x, y, 1 + d * 1.5);
    } else if (fam === 'stone' && Math.random() < 0.3 + 0.6 * d) {
      resetBurst();
      b.tint = this.chipColor[e.material];
      b.tintVar = 0.25;
      b.angle = HALF_PI;
      b.spread = 1;
      b.speedMin = 10;
      b.speedMax = 50;
      b.lifeMin = 600;
      b.lifeMax = 1100;
      b.scaleMin = 0.22;
      b.scaleMax = 0.4;
      b.gravity = G;
      b.spin = 8;
      b.bounce = 0.2;
      b.fadePow = 3;
      this.emit(this.chips, x, y, 1 + d * 1.5);
    } else if ((fam === 'metal' || fam === 'glass') && d > 0.45) {
      // Stress glint.
      resetBurst();
      b.tint = fam === 'metal' ? 0xfff0c8 : 0xe6fbff;
      b.lifeMin = 90;
      b.lifeMax = 160;
      b.scaleMin = 0.35;
      b.scaleMax = 0.55;
      b.endScale = 0.3;
      b.alpha = 0.35 + 0.4 * d;
      b.jitter = 3;
      this.emit(this.glints, x, y, 1);
    }
  }

  private onJointBroken(e: SimEvents['jointBroken']): void {
    // Shattering parts drop their joints too; partShattered draws that moment.
    if (e.cause === 'removed' || e.cause === 'shatter') return;
    const x = e.x * PPM;
    const y = e.y * PPM;
    const r = ratingScale(e.rating);
    const fam = family(e.joint.bondMaterial);
    const metal = fam === 'metal' || family(e.materialA) === 'metal' || family(e.materialB) === 'metal';
    // Massive cascades (hundreds of joints in a few steps): draw a representative sample.
    this.snapLoad += 1;
    if (this.snapLoad > 14 && Math.random() * this.snapLoad > 14) return;
    const load = 1 / (1 + (this.snapLoad - 1) * 0.15);
    let s = (0.55 + 0.8 * r) * load;
    if (e.cause === 'explosion') s *= 0.45;
    const mat = e.joint.bondMaterial;
    const b = resetBurst();

    // The SNAP: a crisp glint exactly where the joint let go.
    this.flash(x, y, 12 + 18 * r, metal ? 0xfff2d0 : 0xffffff, 75, metal ? 0.95 : 0.6);

    switch (fam) {
      case 'wood': {
        b.tint = this.chipColor[mat];
        b.tintVar = 0.35;
        b.spread = Math.PI;
        b.speedMin = 70;
        b.speedMax = 300 * (0.75 + 0.6 * r);
        b.lifeMin = 700;
        b.lifeMax = 1400;
        b.scaleMin = 0.4;
        b.scaleMax = 1.05;
        b.aspect = 0.8;
        b.gravity = G;
        b.drag = 0.6;
        b.spin = 16;
        b.bounce = 0.25;
        b.fadePow = 3;
        b.jitter = 4;
        this.emit(this.splinters, x, y, 5 + 11 * s);
        this.puff(x, y, 2 + 4 * s, this.dustColor[mat], 10 + 10 * r, 0.3);
        break;
      }
      case 'stone': {
        b.tint = this.chipColor[mat];
        b.tintVar = 0.3;
        b.spread = Math.PI;
        b.speedMin = 50;
        b.speedMax = 240 * (0.75 + 0.5 * r);
        b.lifeMin = 800;
        b.lifeMax = 1500;
        b.scaleMin = 0.3;
        b.scaleMax = 0.85;
        b.gravity = G;
        b.drag = 0.5;
        b.spin = 12;
        b.bounce = 0.22;
        b.fadePow = 3;
        b.jitter = 4;
        this.emit(this.chips, x, y, 5 + 9 * s);
        this.puff(x, y, 4 + 6 * s, this.dustColor[mat], 14 + 14 * r, 0.3, 1.3);
        break;
      }
      case 'glass':
        this.glitter(x, y, 6 + 8 * s, 140);
        this.shards(x, y, 3 + 4 * s, MATERIALS.glass.particleColor, 160);
        break;
      case 'rubber':
        this.puff(x, y, 2 + 2 * s, this.dustColor[mat], 10, 0.25);
        break;
      case 'metal':
        this.puff(x, y, 1 + 2 * s, this.dustColor[mat], 9, 0.22);
        break;
    }
    if (metal) this.sparkBurst(x, y, 8 + 16 * s, 220 + 420 * r, 0, Math.PI);

    this.camera.addTrauma((0.07 + 0.1 * r) * load, 0.5);
    if (this.firstSnapPending && e.cause !== 'explosion') {
      // The first failure of a chain gets a little extra weight: this is THE moment.
      this.firstSnapPending = false;
      this.camera.punch(0.006 + 0.01 * r, e.x, e.y);
      this.camera.addTrauma(0.08, 0.6);
    }
  }

  private onShattered(e: SimEvents['partShattered']): void {
    const x = e.x * PPM;
    const y = e.y * PPM;
    const part = e.part;
    const a = clamp01(part.area / 1.5);
    const mat = part.material;
    if (family(mat.id) === 'glass') {
      this.shards(x, y, 8 + 14 * a, mat.particleColor, 300);
      this.glitter(x, y, 10 + 16 * a, 220);
      this.flash(x, y, 20 + 22 * a, 0xdff8ff, 90, 0.5);
      this.ring(x, y, 28 + 30 * a, 200, 0.22, 0xc8f4ff);
    } else {
      this.materialBurst(mat.id, x, y, 0.6 + 0.4 * a, 0, Math.PI);
    }
    this.puff(x, y, 2 + 3 * a, this.dustColor[mat.id], 10 + 10 * a, 0.2);
    this.camera.addTrauma(0.08 + 0.06 * a, 0.5);
  }

  private onExplosion(e: SimEvents['explosion']): void {
    const x = e.x * PPM;
    const y = e.y * PPM;
    const R = e.radius * PPM;
    const p = Math.max(0.2, Math.min(1.5, e.power));
    const b = resetBurst();

    this.flash(x, y, R * 1.25, 0xffe2b0, 150, 0.9);
    this.flash(x, y, R * 0.55, 0xffffff, 70, 1);

    // Fireball: additive blobs that rise, grow and cool from orange to deep red.
    b.tint = 0xffb050;
    b.tintVar = 0.15;
    b.tintEnd = 0x5a1a08;
    b.speedMin = 20;
    b.speedMax = 150 * p;
    b.lifeMin = 260;
    b.lifeMax = 560;
    b.scaleMin = (R * 0.22) / 32;
    b.scaleMax = (R * 0.45) / 32;
    b.endScale = 1.7;
    b.easeOut = true;
    b.alpha = 0.85;
    b.fadePow = 1.4;
    b.drag = 3;
    b.gravity = -90;
    b.jitter = R * 0.15;
    this.emit(this.glow, x, y, 7 + 7 * p);

    // Smoke: dark, billowing, lingering; slightly delayed behind the flash.
    resetBurst();
    b.tint = 0x34373e;
    b.tintVar = 0.25;
    b.speedMin = 30;
    b.speedMax = 170 * p;
    b.lifeMin = 1500;
    b.lifeMax = 2700;
    b.delayMax = 140;
    b.scaleMin = (R * 0.25) / 16;
    b.scaleMax = (R * 0.45) / 16;
    b.endScale = 2.3;
    b.easeOut = true;
    b.alpha = 0.5;
    b.alphaVar = 0.4;
    b.fadeIn = 0.08;
    b.fadePow = 1.5;
    b.drag = 2.2;
    b.gravity = -38;
    b.jitter = R * 0.25;
    this.emit(this.dust, x, y, 10 + 10 * p);

    this.sparkBurst(x, y, 18 + 26 * p, 300 + 500 * p, UP, Math.PI);

    // Dark debris flecks.
    resetBurst();
    b.tint = 0x3b3632;
    b.tintVar = 0.3;
    b.speedMin = 150;
    b.speedMax = 520 * p;
    b.lifeMin = 700;
    b.lifeMax = 1400;
    b.scaleMin = 0.35;
    b.scaleMax = 0.8;
    b.gravity = G;
    b.spin = 14;
    b.bounce = 0.25;
    b.fadePow = 3;
    b.jitter = R * 0.1;
    this.emit(this.chips, x, y, 10 + 10 * p);

    this.ring(x, y, R * 1.15, 300, 0.5, 0xfff1dc);
    this.ring(x, y, R * 1.9, 460, 0.14, 0xffffff);
    if (e.y > -2.5) this.groundDust(x, 0.7 + 0.3 * p, GROUND_DUST);

    this.overlay.flash(0.09 * p, 0xffe6c0, 9);
    this.camera.addTrauma(0.45 + 0.3 * p);
    this.camera.punch(0.018 + 0.02 * p, e.x, e.y);
    if (e.source !== 'debug') this.hitStop(0.03 + 0.03 * p);
  }

  private onBigCollapse(e: SimEvents['bigCollapse']): void {
    const k = clamp01(e.intensity - 1);
    this.slowMo(e.intensity);
    this.camera.focus(e.x, e.y, 0.03 + 0.02 * k, 0.9 + 0.4 * k);
    this.camera.addTrauma(0.18 + 0.12 * k, 0.7);
  }

  private onObjectiveComplete(): void {
    this.overlay.pulse(0x7fffd0, 0.65, 1.2);
    this.camera.punch(0.008);
  }

  // ------------------------------------------------------------------ building blocks

  private takeImpactToken(cost: number): boolean {
    if (this.impactTokens < cost) return false;
    this.impactTokens -= cost;
    return true;
  }

  private emit(em: Emitter, x: number, y: number, count: number): void {
    const n = Math.floor(count * this.density + Math.random());
    if (n > 0) em.emitParticleAt(x, y, n);
  }

  private flash(x: number, y: number, radius: number, color: number, life: number, alpha: number): void {
    const b = resetBurst();
    b.tint = color;
    b.lifeMin = life * 0.85;
    b.lifeMax = life * 1.15;
    b.scaleMin = b.scaleMax = radius / 32;
    b.endScale = 1.25;
    b.easeOut = true;
    b.alpha = alpha;
    b.fadePow = 1.5;
    this.glow.emitParticleAt(x, y, 1);
  }

  private ring(x: number, y: number, radius: number, life: number, alpha: number, color: number): void {
    const b = resetBurst();
    b.tint = color;
    b.lifeMin = b.lifeMax = life;
    b.scaleMin = b.scaleMax = (radius * 0.3) / FX_RING_RADIUS;
    b.endScale = 1 / 0.3;
    b.easeOut = true;
    b.alpha = alpha;
    b.fadePow = 1.3;
    b.rotation = 0;
    this.rings.emitParticleAt(x, y, 1);
  }

  /** Soft dust puff (radius in px). */
  private puff(x: number, y: number, count: number, color: number, radius: number, alpha: number, linger = 1): void {
    const b = resetBurst();
    b.tint = color;
    b.tintVar = 0.12;
    b.speedMin = 10;
    b.speedMax = 40 + radius * 2;
    b.lifeMin = 600 * linger;
    b.lifeMax = 1300 * linger;
    b.scaleMin = (radius * 0.5) / 16;
    b.scaleMax = radius / 16;
    b.endScale = 2.2;
    b.easeOut = true;
    b.alpha = alpha;
    b.alphaVar = 0.4;
    b.fadeIn = 0.08;
    b.fadePow = 1.6;
    b.drag = 3;
    b.gravity = -12;
    b.jitter = radius * 0.4;
    this.emit(this.dust, x, y, count);
  }

  /** Dust rolling out sideways along the ground (strength 0..1+). */
  private groundDust(x: number, strength: number, color: number): void {
    const s = Math.max(0.1, strength);
    const b = resetBurst();
    b.tint = color;
    b.tintVar = 0.15;
    b.speedMin = 20;
    b.speedMax = 70 + 150 * s;
    b.lifeMin = 900;
    b.lifeMax = 1900 + 600 * s;
    b.scaleMin = (7 + 8 * s) / 16;
    b.scaleMax = (14 + 16 * s) / 16;
    b.endScale = 2.6;
    b.easeOut = true;
    b.aspect = 0.75;
    b.alpha = 0.22 + 0.12 * s;
    b.alphaVar = 0.4;
    b.fadeIn = 0.1;
    b.fadePow = 1.8;
    b.drag = 2.6;
    b.gravity = -14;
    b.jitter = 10 + 10 * s;
    b.jitterY = 0.3;
    // Two lobes rolling left and right, hugging the ground.
    b.angle = Math.PI + 0.12;
    b.spread = 0.22;
    this.emit(this.dust, x, -4, 2 + 5 * s);
    b.angle = -0.12;
    this.emit(this.dust, x, -4, 2 + 5 * s);
    // A little plume straight up for heavy hits.
    if (s > 0.5) {
      b.angle = UP;
      b.spread = 0.5;
      b.speedMax = 40 + 90 * s;
      this.emit(this.dust, x, -6, 2 * s);
    }
  }

  /** Material-specific debris for an impact of strength m (0..1+) around direction `angle` +/- `spread`. */
  private materialBurst(mat: MaterialId, x: number, y: number, m: number, angle: number, spread: number): void {
    if (m <= 0.02) return;
    const b = resetBurst();
    switch (family(mat)) {
      case 'wood':
        b.tint = this.chipColor[mat];
        b.tintVar = 0.35;
        b.angle = angle;
        b.spread = spread;
        b.speedMin = 40;
        b.speedMax = 120 + 260 * m;
        b.lifeMin = 600;
        b.lifeMax = 1200;
        b.scaleMin = 0.35;
        b.scaleMax = 0.6 + 0.4 * m;
        b.aspect = 0.8;
        b.gravity = G;
        b.drag = 0.6;
        b.spin = 14;
        b.bounce = 0.25;
        b.fadePow = 3;
        b.jitter = 3;
        this.emit(this.splinters, x, y, 1 + 9 * m);
        this.puff(x, y, 1 + 3 * m, this.dustColor[mat], 8 + 8 * m, 0.25);
        break;
      case 'stone':
        b.tint = this.chipColor[mat];
        b.tintVar = 0.3;
        b.angle = angle;
        b.spread = spread;
        b.speedMin = 30;
        b.speedMax = 100 + 220 * m;
        b.lifeMin = 700;
        b.lifeMax = 1400;
        b.scaleMin = 0.25;
        b.scaleMax = 0.5 + 0.45 * m;
        b.gravity = G;
        b.drag = 0.5;
        b.spin = 12;
        b.bounce = 0.22;
        b.fadePow = 3;
        b.jitter = 3;
        this.emit(this.chips, x, y, 1 + 8 * m);
        this.puff(x, y, 2 + 5 * m, this.dustColor[mat], 10 + 14 * m, 0.3, 1.3);
        break;
      case 'metal':
        if (m > 0.25) this.sparkBurst(x, y, 3 + 14 * m, 160 + 380 * m, angle, spread);
        this.puff(x, y, 1 + 2 * m, this.dustColor[mat], 8, 0.18);
        break;
      case 'glass':
        this.glitter(x, y, 3 + 8 * m, 90 + 120 * m);
        if (m > 0.3) this.shards(x, y, 2 + 5 * m, MATERIALS.glass.particleColor, 140);
        break;
      case 'rubber':
        this.puff(x, y, 1 + 2 * m, this.dustColor[mat], 8, 0.2);
        break;
    }
  }

  private sparkBurst(x: number, y: number, count: number, speed: number, angle: number, spread: number): void {
    const b = resetBurst();
    b.tint = 0xfff4d0;
    b.tintEnd = 0xff5a1a;
    b.angle = angle;
    b.spread = spread;
    b.speedMin = speed * 0.35;
    b.speedMax = speed;
    b.lifeMin = 160;
    b.lifeMax = 480;
    b.scaleMin = 0.45;
    b.scaleMax = 0.75;
    b.aspect = 0.7;
    b.stretch = 0.0035;
    b.gravity = G;
    b.drag = 1.2;
    b.bounce = 0.35;
    b.alpha = 0.95;
    this.emit(this.sparks, x, y, count);
  }

  private glitter(x: number, y: number, count: number, speed: number): void {
    const b = resetBurst();
    b.tint = 0xe6fbff;
    b.tintVar = 0.2;
    b.speedMin = speed * 0.2;
    b.speedMax = speed;
    b.lifeMin = 400;
    b.lifeMax = 1000;
    b.scaleMin = 0.12;
    b.scaleMax = 0.3;
    b.alpha = 0.9;
    b.gravity = G * 0.45;
    b.drag = 1.5;
    b.twinkle = 1;
    b.bounce = 0.3;
    b.jitter = 6;
    this.emit(this.glints, x, y, count);
  }

  private shards(x: number, y: number, count: number, color: number, speed: number): void {
    const b = resetBurst();
    b.tint = color;
    b.tintVar = 0.2;
    b.speedMin = speed * 0.25;
    b.speedMax = speed;
    b.lifeMin = 900;
    b.lifeMax = 1600;
    b.scaleMin = 0.4;
    b.scaleMax = 0.9;
    b.alpha = 0.8;
    b.gravity = G;
    b.drag = 0.4;
    b.spin = 12;
    b.bounce = 0.3;
    b.fadePow = 3;
    b.jitter = 6;
    this.emit(this.chips, x, y, count);
  }
}
