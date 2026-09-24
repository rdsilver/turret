/**
 * FxParticle: a Phaser particle with its own tiny physics and appearance model,
 * so a handful of pooled emitters can render every kind of effect (dust,
 * chips, splinters, sparks, glints, glows, rings) with per-burst parameters.
 *
 * Usage (allocation-free): fill the shared `burst` params (resetBurst() first),
 * then `emitter.emitParticleAt(x, y, count)`. Each particle copies what it needs
 * in fire(); update() integrates drag, gravity, ground bounce (world y = 0 is
 * the ground surface), spin or velocity alignment, scale/alpha curves, tint
 * cooling and twinkle. Coordinates are world pixels.
 */
import * as Phaser from 'phaser';

const TAU = Math.PI * 2;

export interface BurstParams {
  tint: number;
  /** End tint (lerped over life), or -1 for none. */
  tintEnd: number;
  /** Random brightness variation 0..1. */
  tintVar: number;
  /** Emission direction (radians, screen space y down) and half-spread. */
  angle: number;
  spread: number;
  speedMin: number;
  speedMax: number;
  /** Base velocity added to every particle (px/s). */
  vx: number;
  vy: number;
  lifeMin: number;
  lifeMax: number;
  delayMax: number;
  scaleMin: number;
  scaleMax: number;
  /** End scale as a multiple of the start scale. */
  endScale: number;
  /** true = ease-out growth/shrink (smoke billows fast then slows). */
  easeOut: boolean;
  /** scaleY / scaleX. */
  aspect: number;
  alpha: number;
  alphaVar: number;
  /** Fraction of life spent fading in. */
  fadeIn: number;
  /** Fade-out curve exponent (1 linear, 2 = hold then fall). */
  fadePow: number;
  /** px/s^2, negative rises. */
  gravity: number;
  /** Velocity damping (1/s). */
  drag: number;
  /** Max spin (rad/s, random sign). */
  spin: number;
  /** >0: align to velocity and stretch length by (1 + speed * stretch). */
  stretch: number;
  /** <0: ignore ground; otherwise restitution against the ground (y = 0). */
  bounce: number;
  /** Spawn jitter radius (px) and vertical factor. */
  jitter: number;
  jitterY: number;
  /** 0..1 alpha flicker (glass glitter). */
  twinkle: number;
  /** Fixed initial rotation, or NaN for random. */
  rotation: number;
}

export const burst: BurstParams = {
  tint: 0xffffff,
  tintEnd: -1,
  tintVar: 0,
  angle: 0,
  spread: Math.PI,
  speedMin: 0,
  speedMax: 0,
  vx: 0,
  vy: 0,
  lifeMin: 500,
  lifeMax: 500,
  delayMax: 0,
  scaleMin: 1,
  scaleMax: 1,
  endScale: 1,
  easeOut: false,
  aspect: 1,
  alpha: 1,
  alphaVar: 0,
  fadeIn: 0,
  fadePow: 1,
  gravity: 0,
  drag: 0,
  spin: 0,
  stretch: 0,
  bounce: -1,
  jitter: 0,
  jitterY: 1,
  twinkle: 0,
  rotation: NaN,
};

/** Reset the shared burst params to neutral defaults and return them for filling in. */
export function resetBurst(): BurstParams {
  const b = burst;
  b.tint = 0xffffff;
  b.tintEnd = -1;
  b.tintVar = 0;
  b.angle = 0;
  b.spread = Math.PI;
  b.speedMin = 0;
  b.speedMax = 0;
  b.vx = 0;
  b.vy = 0;
  b.lifeMin = 500;
  b.lifeMax = 500;
  b.delayMax = 0;
  b.scaleMin = 1;
  b.scaleMax = 1;
  b.endScale = 1;
  b.easeOut = false;
  b.aspect = 1;
  b.alpha = 1;
  b.alphaVar = 0;
  b.fadeIn = 0;
  b.fadePow = 1;
  b.gravity = 0;
  b.drag = 0;
  b.spin = 0;
  b.stretch = 0;
  b.bounce = -1;
  b.jitter = 0;
  b.jitterY = 1;
  b.twinkle = 0;
  b.rotation = NaN;
  return b;
}

export class FxParticle extends Phaser.GameObjects.Particles.Particle {
  private s0 = 1;
  private s1 = 1;
  private a0 = 1;
  private fadeIn = 0;
  private fadePow = 1;
  private drag = 0;
  private grav = 0;
  private spin = 0;
  private stretch = 0;
  private restitution = -1;
  private twinkle = 0;
  private twPhase = 0;
  private aspect = 1;
  private easeOut = false;
  private r0 = 255;
  private g0 = 255;
  private b0 = 255;
  private dr = 0;
  private dg = 0;
  private db = 0;
  private cool = false;

  override fire(x?: number, y?: number): boolean {
    const B = burst;
    const em = this.emitter;
    this.frame = em.getFrame();
    this.texture = this.frame.texture;

    let px = x ?? 0;
    let py = y ?? 0;
    if (B.jitter > 0) {
      const r = Math.sqrt(Math.random()) * B.jitter;
      const ja = Math.random() * TAU;
      px += Math.cos(ja) * r;
      py += Math.sin(ja) * r * B.jitterY;
    }
    this.x = px;
    this.y = py;

    const a = B.angle + (Math.random() * 2 - 1) * B.spread;
    const sp = B.speedMin + Math.random() * (B.speedMax - B.speedMin);
    this.velocityX = Math.cos(a) * sp + B.vx;
    this.velocityY = Math.sin(a) * sp + B.vy;
    this.accelerationX = 0;
    this.accelerationY = 0;

    this.life = B.lifeMin + Math.random() * (B.lifeMax - B.lifeMin);
    this.lifeCurrent = this.life;
    this.lifeT = 0;
    this.delayCurrent = B.delayMax > 0 ? Math.random() * B.delayMax : 0;
    this.holdCurrent = 0;

    this.s0 = B.scaleMin + Math.random() * (B.scaleMax - B.scaleMin);
    this.s1 = this.s0 * B.endScale;
    this.easeOut = B.easeOut;
    this.aspect = B.aspect;
    this.a0 = B.alpha * (1 - Math.random() * B.alphaVar);
    this.fadeIn = B.fadeIn;
    this.fadePow = B.fadePow;
    this.drag = B.drag;
    this.grav = B.gravity;
    this.spin = B.spin > 0 ? (Math.random() * 2 - 1) * B.spin : 0;
    this.stretch = B.stretch;
    this.restitution = B.bounce;
    this.twinkle = B.twinkle;
    this.twPhase = Math.random() * TAU;
    this.rotation = Number.isNaN(B.rotation) ? Math.random() * TAU : B.rotation;
    this.angle = 0;

    // Tint (+ optional brightness jitter and end colour).
    let t = B.tint;
    if (B.tintVar > 0) t = scaleColor(t, 1 - Math.random() * B.tintVar);
    this.r0 = (t >> 16) & 255;
    this.g0 = (t >> 8) & 255;
    this.b0 = t & 255;
    this.cool = B.tintEnd >= 0;
    if (this.cool) {
      this.dr = ((B.tintEnd >> 16) & 255) - this.r0;
      this.dg = ((B.tintEnd >> 8) & 255) - this.g0;
      this.db = (B.tintEnd & 255) - this.b0;
    }
    this.tint = t;

    this.scaleX = this.s0;
    this.scaleY = this.s0 * this.aspect;
    this.alpha = this.delayCurrent > 0 || this.fadeIn > 0 ? 0 : this.a0;
    return true;
  }

  override update(delta: number, step: number): boolean {
    if (this.lifeCurrent <= 0) return true;
    if (this.delayCurrent > 0) {
      this.delayCurrent -= delta;
      if (this.delayCurrent > 0) {
        this.alpha = 0;
        return false;
      }
    }
    const t = 1 - this.lifeCurrent / this.life;
    this.lifeT = t;

    let vx = this.velocityX;
    let vy = this.velocityY;
    if (this.drag > 0) {
      const k = Math.max(0, 1 - this.drag * step);
      vx *= k;
      vy *= k;
    }
    vy += this.grav * step;
    let x = this.x + vx * step;
    let y = this.y + vy * step;
    if (this.restitution >= 0 && y > 0) {
      y = 0;
      if (vy > 0) {
        vy = vy > 40 ? -vy * this.restitution : 0;
        vx *= 0.55;
        this.spin *= 0.5;
      }
    }
    this.x = x;
    this.y = y;
    this.velocityX = vx;
    this.velocityY = vy;

    const e = this.easeOut ? 1 - (1 - t) * (1 - t) : t;
    const s = this.s0 + (this.s1 - this.s0) * e;
    if (this.stretch > 0) {
      const sp2 = vx * vx + vy * vy;
      if (sp2 > 1) this.rotation = Math.atan2(vy, vx);
      this.scaleX = s * (1 + Math.sqrt(sp2) * this.stretch);
    } else {
      this.rotation += this.spin * step;
      this.scaleX = s;
    }
    this.scaleY = s * this.aspect;

    let a = this.a0;
    if (t < this.fadeIn) a *= t / this.fadeIn;
    else {
      const u = (t - this.fadeIn) / (1 - this.fadeIn);
      a *= 1 - (this.fadePow === 1 ? u : Math.pow(u, this.fadePow));
    }
    if (this.twinkle > 0) a *= 1 - this.twinkle * 0.5 * (1 + Math.sin(this.lifeCurrent * 0.045 + this.twPhase));
    this.alpha = a < 0 ? 0 : a > 1 ? 1 : a;

    if (this.cool) {
      this.tint = (((this.r0 + this.dr * t) | 0) << 16) | (((this.g0 + this.dg * t) | 0) << 8) | ((this.b0 + this.db * t) | 0);
    }

    this.lifeCurrent -= delta;
    return this.lifeCurrent <= 0;
  }
}

export function scaleColor(c: number, k: number): number {
  const r = Math.min(255, ((c >> 16) & 255) * k) | 0;
  const g = Math.min(255, ((c >> 8) & 255) * k) | 0;
  const b = Math.min(255, (c & 255) * k) | 0;
  return (r << 16) | (g << 8) | b;
}

export function mixColor(a: number, b: number, t: number): number {
  const r = (((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t)) | 0;
  const g = (((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t)) | 0;
  const bl = ((a & 255) + (((b & 255) - (a & 255)) * t)) | 0;
  return (r << 16) | (g << 8) | bl;
}
