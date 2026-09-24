/**
 * Camera framing and shake. OWNER: effects agent.
 *
 * - frame(bounds): smoothly fit a sim-space rectangle (meters) into view
 *   (zoom + scroll), always keeping ground near the bottom; instant=true snaps.
 * - Trauma-based shake: addTrauma(0..1) accumulates; offset = maxOffset *
 *   trauma^2 * noise(t); decays over time. Subtle by default.
 * - punch(amount[, x, y]): brief zoom-in kick that springs back (big impacts),
 *   optionally anchored on a sim point so the action stays put on screen.
 * - focus(x, y, amount, seconds): gentle "lean in" towards a sim point (slow-mo moments).
 * - toSim(pointer): convert a canvas pointer to sim meters (ignores shake so aim never jitters).
 * - update(realDt) applies everything (uses real time so it works in slow-mo / hit-stop).
 */
import type * as Phaser from 'phaser';
import { PPM } from '../config/constants';

export interface SimRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Max shake offset in canvas pixels at trauma = 1. */
const MAX_OFFSET = 15;
/** Max shake roll (radians) at trauma = 1. */
const MAX_ROLL = 0.011;
/** Trauma lost per second. */
const TRAUMA_DECAY = 1.35;
/** Noise speed (Hz-ish). */
const SHAKE_FREQ = 16;
/** Framing smoothing (1/s). */
const FRAME_LAMBDA = 4.5;
/** Punch spring (rad/s) and damping ratio. */
const PUNCH_OMEGA = 22;
const PUNCH_ZETA = 0.55;

export class CameraDirector {
  /** Global multiplier for shake (settings / accessibility). 0 disables shake. */
  shakeScale = 1;

  private readonly cam: Phaser.Cameras.Scene2D.Camera;

  // Target and current framing (world pixels / zoom).
  private tgtCx = 0;
  private tgtCy = 0;
  private tgtZoom = 1;
  private cx = 0;
  private cy = 0;
  private zoom = 1;
  private hasFrame = false;

  // View actually shown before shake (used by toSim).
  private viewCx = 0;
  private viewCy = 0;
  private viewZoom = 1;

  private trauma = 0;
  private time = 0;

  // Zoom punch: damped spring on a fractional zoom offset.
  private kick = 0;
  private kickVel = 0;
  private kickX = 0;
  private kickY = 0;
  private kickAnchored = false;

  // Focus lean-in.
  private focusX = 0;
  private focusY = 0;
  private focusAmt = 0;
  private focusCur = 0;
  private focusHold = 0;

  constructor(readonly scene: Phaser.Scene) {
    this.cam = scene.cameras.main;
    this.cx = this.tgtCx = this.cam.scrollX + this.cam.width / 2;
    this.cy = this.tgtCy = this.cam.scrollY + this.cam.height / 2;
    this.zoom = this.tgtZoom = this.cam.zoom;
    this.viewCx = this.cx;
    this.viewCy = this.cy;
    this.viewZoom = this.zoom;
  }

  /** Current shake trauma 0..1 (read-only, for debug overlays). */
  get currentTrauma(): number {
    return this.trauma;
  }

  frame(bounds: SimRect, instant = false): void {
    const w = this.cam.width;
    const h = this.cam.height;
    const bw = Math.max(1, (bounds.right - bounds.left) * PPM);
    const bh = Math.max(1, (bounds.bottom - bounds.top) * PPM);
    const zoom = Math.max(0.05, Math.min(w / bw, h / bh));
    // Centre horizontally; anchor the bottom edge so the ground sits at the same
    // place on screen and any spare height opens up above the structure.
    this.tgtZoom = zoom;
    this.tgtCx = ((bounds.left + bounds.right) / 2) * PPM;
    this.tgtCy = bounds.bottom * PPM - h / zoom / 2;
    if (instant || !this.hasFrame) {
      this.cx = this.tgtCx;
      this.cy = this.tgtCy;
      this.zoom = this.tgtZoom;
      this.trauma = 0;
      this.kick = this.kickVel = 0;
      this.focusAmt = this.focusCur = this.focusHold = 0;
      this.hasFrame = true;
      this.apply(0, 0, 0);
    }
  }

  /**
   * Add shake trauma (0..1). `max` caps how far this source may push the total
   * (lets frequent small sources such as joint snaps never reach full shake).
   */
  addTrauma(amount: number, max = 1): void {
    if (!(amount > 0) || this.trauma >= max) return;
    this.trauma = Math.min(max, this.trauma + amount);
  }

  /**
   * Zoom kick: `amount` is the fractional zoom-in (0.01..0.06 feels right).
   * With (x, y) in sim meters the kick is anchored on that point.
   */
  punch(amount: number, x?: number, y?: number): void {
    if (!(amount > 0)) return;
    // Impulse on the spring; peak displacement ~ amount.
    this.kickVel += amount * PUNCH_OMEGA * 1.6;
    if (x !== undefined && y !== undefined) {
      this.kickX = x * PPM;
      this.kickY = y * PPM;
      this.kickAnchored = true;
    } else this.kickAnchored = false;
  }

  /** Lean in towards a sim point by `amount` (fractional zoom, ~0.03-0.06) for `seconds` (real time). */
  focus(x: number, y: number, amount: number, seconds: number): void {
    this.focusX = x * PPM;
    this.focusY = y * PPM;
    this.focusAmt = Math.max(0, amount);
    this.focusHold = Math.max(0, seconds);
  }

  toSim(screenX: number, screenY: number, out: { x: number; y: number }): { x: number; y: number } {
    const cam = this.cam;
    const hw = cam.width / 2;
    const hh = cam.height / 2;
    // Inverse of the (unshaken) camera transform: world = centre + (screen - viewport centre) / zoom.
    const wx = this.viewCx + (screenX - cam.x - hw) / this.viewZoom;
    const wy = this.viewCy + (screenY - cam.y - hh) / this.viewZoom;
    out.x = wx / PPM;
    out.y = wy / PPM;
    return out;
  }

  update(realDt: number): void {
    const dt = Math.min(0.1, Math.max(0, realDt));
    this.time += dt;

    // Smooth framing (log-space for zoom so zooming feels uniform).
    const k = 1 - Math.exp(-FRAME_LAMBDA * dt);
    this.cx += (this.tgtCx - this.cx) * k;
    this.cy += (this.tgtCy - this.cy) * k;
    this.zoom = Math.exp(Math.log(this.zoom) + (Math.log(this.tgtZoom) - Math.log(this.zoom)) * k);

    // Punch spring (semi-implicit Euler, sub-stepped for stability).
    const sub = dt > 1 / 60 ? 2 : 1;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const acc = -PUNCH_OMEGA * PUNCH_OMEGA * this.kick - 2 * PUNCH_ZETA * PUNCH_OMEGA * this.kickVel;
      this.kickVel += acc * h;
      this.kick += this.kickVel * h;
    }
    if (Math.abs(this.kick) < 1e-5 && Math.abs(this.kickVel) < 1e-4) this.kick = this.kickVel = 0;

    // Focus: ease in quickly, hold, ease out slowly.
    if (this.focusHold > 0) {
      this.focusHold -= dt;
      this.focusCur += (this.focusAmt - this.focusCur) * (1 - Math.exp(-6 * dt));
    } else if (this.focusCur > 0) {
      this.focusCur += (0 - this.focusCur) * (1 - Math.exp(-2.5 * dt));
      if (this.focusCur < 1e-4) this.focusCur = 0;
    }

    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    const shake = this.trauma * this.trauma * this.shakeScale;
    let ox = 0;
    let oy = 0;
    let roll = 0;
    if (shake > 0) {
      const t = this.time * SHAKE_FREQ;
      ox = MAX_OFFSET * shake * noise1(t, 11.3);
      oy = MAX_OFFSET * shake * noise1(t, 47.9);
      roll = MAX_ROLL * shake * noise1(t * 0.7, 83.1);
    }
    this.apply(ox, oy, roll);
  }

  private apply(ox: number, oy: number, roll: number): void {
    const cam = this.cam;
    let cx = this.cx;
    let cy = this.cy;
    let zoom = this.zoom;

    // Lean in: zoom about the focus point (that point stays fixed on screen).
    if (this.focusCur > 0) {
      const f = 1 + this.focusCur;
      cx = this.focusX + (cx - this.focusX) / f;
      cy = this.focusY + (cy - this.focusY) / f;
      // ...and drift the point a little towards the centre (less vertically, keep the ground in view).
      const pull = Math.min(0.25, this.focusCur * 1.5);
      cx += (this.focusX - cx) * pull;
      cy += (this.focusY - cy) * pull * 0.4;
      zoom *= f;
    }
    // Punch: zoom about the anchor (or the view centre).
    if (this.kick !== 0) {
      const f = Math.max(0.8, 1 + this.kick);
      if (this.kickAnchored) {
        cx = this.kickX + (cx - this.kickX) / f;
        cy = this.kickY + (cy - this.kickY) / f;
      }
      zoom *= f;
    }

    this.viewCx = cx;
    this.viewCy = cy;
    this.viewZoom = zoom;

    cam.setZoom(zoom);
    cam.setScroll(cx - cam.width / 2 + ox / zoom, cy - cam.height / 2 + oy / zoom);
    cam.setRotation(roll);
  }
}

// ------------------------------------------------------------------ noise

/** Smooth 1D gradient noise in [-1, 1] (Perlin-style), seeded by `seed`. Allocation-free. */
function noise1(x: number, seed: number): number {
  const xi = Math.floor(x);
  const xf = x - xi;
  const g0 = grad(xi, seed);
  const g1 = grad(xi + 1, seed);
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  // Scale ~2 maps the typical +/-0.5 gradient-noise range onto roughly +/-1.
  return (g0 * xf + (g1 * (xf - 1) - g0 * xf) * u) * 2;
}

function grad(i: number, seed: number): number {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul((seed * 1000) | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h & 0xffff) / 0x7fff) - 1;
}
