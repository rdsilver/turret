/**
 * Telekinetic haste (hasteners, see sim/creature/haste.ts). Owned by
 * WorldRenderer.
 *
 * - The beam: while a hastener's crystal holds an ally, a rippling violet
 *   beam runs from the crystal to the ally's body: a soft tapered glow, two
 *   strands (violet and cyan) twisting around it, and rings of force rolling
 *   down it that land on the ally as widening ripples. It fades in and out
 *   instead of popping. The crystal itself glows violet (brighter while it
 *   beams), so it reads as the hastener's organ, not a mender's lamp.
 * - The lasting cue: every creature a beam has hastened (speedMul > 1) trails
 *   speed streaks and faint violet afterimages behind it, and carries one to
 *   three chevrons above it — all stronger the faster it has been made — for
 *   as long as it is active. A creature that reaches its cap gets a violet
 *   ring burst.
 *
 * Everything is drawn into two additive Graphics (no textures): streaks and
 * afterimages behind the creatures, beams, chevrons and bursts in front.
 * Positions are interpolated like the parts' images.
 */
import * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import type { StructurePart } from '../sim/StructurePart';
import type { Creature } from '../sim/creature/Creature';
import { hasteSpec, hasteTarget } from '../sim/creature/haste';
import { PPM } from '../config/constants';
import { DEPTH } from './depths';

const VIOLET = 0xb48cff;
const CYAN = 0x7fe9ff;
const PALE = 0xe9dcff;
/** Seconds for a beam to fade in / out. */
const BEAM_FADE = 0.25;
/** speedMul at which the lasting cue is at full strength. */
const FULL_MUL = 1.6;
/** Seconds a cap burst lasts. */
const BURST_LIFE = 0.7;

interface Beam {
  /** 0..1 fade. */
  k: number;
  /** The ally last beamed at (the beam fades out onto it). */
  target: Creature | null;
  seed: number;
}

interface Burst {
  creature: Creature;
  life: number;
}

export class HasteView {
  private readonly back: Phaser.GameObjects.Graphics;
  private readonly front: Phaser.GameObjects.Graphics;
  private readonly beams = new Map<Creature, Beam>();
  private readonly bursts: Burst[] = [];
  /** Smoothed horizontal speed of each hastened creature (m/s, + = toward the turret). */
  private readonly pace = new Map<Creature, number>();
  /** Scratch: the parts of the creature being drawn. */
  private readonly parts: StructurePart[] = [];
  private readonly off: () => void;
  private time = 0;
  private drawn = false;

  constructor(
    scene: Phaser.Scene,
    private readonly sim: Simulation,
  ) {
    this.back = scene.add.graphics().setDepth(DEPTH.structure - 0.6).setBlendMode(Phaser.BlendModes.ADD);
    this.front = scene.add.graphics().setDepth(DEPTH.joints - 0.5).setBlendMode(Phaser.BlendModes.ADD);
    this.off = sim.events.on('creatureHasted', ({ creature, maxed }) => {
      if (maxed) this.bursts.push({ creature, life: 1 });
    });
  }

  update(alpha: number, realDt: number): void {
    this.time += realDt;
    const list = this.sim.creatures.list;
    let any = false;
    for (const c of list) {
      if (hasteSpec(c)) {
        const tg = hasteTarget(c);
        let b = this.beams.get(c);
        if (!b && (tg || c.active)) this.beams.set(c, (b = { k: 0, target: null, seed: Math.random() }));
        if (b) {
          if (tg) b.target = tg;
          b.k = Math.max(0, Math.min(1, b.k + (tg ? 1 : -1) * (realDt / BEAM_FADE)));
        }
      }
      if (c.active && c.speedMul > 1.005) any = true;
    }
    for (const [c, b] of this.beams) if ((b.k <= 0 && !c.active) || !list.includes(c)) this.beams.delete(c);
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const u = this.bursts[i]!;
      u.life -= realDt / BURST_LIFE;
      if (u.life <= 0 || u.creature.core.removed) this.bursts.splice(i, 1);
    }
    for (const c of this.pace.keys()) if (!c.active || !list.includes(c)) this.pace.delete(c);
    if (!any && !this.beams.size && !this.bursts.length) {
      if (this.drawn) {
        this.back.clear();
        this.front.clear();
        this.drawn = false;
      }
      return;
    }
    this.drawn = true;
    this.back.clear();
    this.front.clear();
    const t = this.time;
    for (const c of list) if (c.active && c.speedMul > 1.005) this.drawHastened(c, alpha, t, realDt);
    for (const [c, b] of this.beams) this.drawCrystal(c, b, alpha, t);
    for (const [c, b] of this.beams) if (b.k > 0 && b.target) this.drawBeam(c, b, alpha, t);
    for (const u of this.bursts) this.drawBurst(u, alpha);
  }

  clear(): void {
    this.beams.clear();
    this.bursts.length = 0;
    this.pace.clear();
    this.back.clear();
    this.front.clear();
    this.drawn = false;
  }

  destroy(): void {
    this.off();
    this.clear();
    this.back.destroy();
    this.front.destroy();
  }

  /** Interpolated position of a part (world px). */
  private at(p: StructurePart, alpha: number): { x: number; y: number } {
    return { x: (p.px + (p.x - p.px) * alpha) * PPM, y: (p.py + (p.y - p.py) * alpha) * PPM };
  }

  /**
   * Where a creature's body is for the beam and burst (world px) and how big it
   * is (m): its core, or for a wheel (whose core turns round the rim) the middle
   * of the ring and its radius.
   */
  private anchor(c: Creature, alpha: number): { x: number; y: number; r: number } {
    if (!c.wheel) return { ...this.at(c.core, alpha), r: c.core.extent };
    let x = 0;
    let y = 0;
    let m = 0;
    for (const p of c.structure.parts) {
      if (p.removed || !c.owns(p)) continue;
      x += (p.px + (p.x - p.px) * alpha) * p.mass;
      y += (p.py + (p.y - p.py) * alpha) * p.mass;
      m += p.mass;
    }
    if (m <= 0) return { ...this.at(c.core, alpha), r: c.core.extent };
    return { x: (x / m) * PPM, y: (y / m) * PPM, r: c.wheel.outer };
  }

  private organOf(c: Creature): StructurePart | null {
    const spec = hasteSpec(c);
    const organ = spec ? c.structure.part(spec.part) : undefined;
    return organ && !organ.removed && !organ.wrecked && c.owns(organ) ? organ : null;
  }

  /** The crystal's own violet glow (while its hastener flies), brighter while it beams. */
  private drawCrystal(c: Creature, b: Beam, alpha: number, t: number): void {
    const organ = c.active ? this.organOf(c) : null;
    if (!organ) return;
    const o = this.at(organ, alpha);
    const r = organ.extent * PPM;
    const pulse = 0.8 + 0.2 * Math.sin(t * 6 + b.seed * 10);
    const g = this.front;
    g.fillStyle(VIOLET, (0.08 + 0.1 * b.k) * pulse);
    g.fillCircle(o.x, o.y, r * (1.25 + 0.35 * b.k));
    g.fillStyle(VIOLET, (0.2 + 0.2 * b.k) * pulse);
    g.fillCircle(o.x, o.y, r * 0.75);
  }

  private drawBeam(c: Creature, b: Beam, alpha: number, t: number): void {
    const organ = this.organOf(c);
    const k = b.target!;
    if (!organ || k.core.removed) return;
    const o = this.at(organ, alpha);
    const p = this.anchor(k, alpha);
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const f = b.k;
    const g = this.front;
    const w0 = 0.1 * PPM;
    const w1 = Math.max(0.5, Math.min(1.6, p.r * 0.7)) * PPM;
    // Soft tapered glow.
    const flicker = 0.85 + 0.15 * Math.sin(t * 11 + b.seed * 30);
    const a0 = 0.22 * f * flicker;
    const a1 = 0.08 * f * flicker;
    g.fillGradientStyle(VIOLET, VIOLET, VIOLET, VIOLET, a0, a0, a1);
    g.fillTriangle(o.x + nx * w0, o.y + ny * w0, o.x - nx * w0, o.y - ny * w0, p.x - nx * w1, p.y - ny * w1);
    g.fillGradientStyle(VIOLET, VIOLET, VIOLET, VIOLET, a0, a1, a1);
    g.fillTriangle(o.x + nx * w0, o.y + ny * w0, p.x - nx * w1, p.y - ny * w1, p.x + nx * w1, p.y + ny * w1);
    // Two strands twisting around the axis, running from the crystal to the ally.
    const n = Math.max(12, Math.min(48, Math.round(len / 10)));
    const turns = len / (1.6 * PPM);
    for (let s = 0; s < 2; s++) {
      g.lineStyle(s === 0 ? 3 : 2.5, s === 0 ? VIOLET : CYAN, 0.55 * f);
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const amp = (w0 + (w1 * 0.55 - w0) * u) * Math.sin(Math.PI * Math.min(1, u * 4));
        const wave = Math.sin((u * turns - t * 1.8) * Math.PI * 2 + s * Math.PI);
        const x = o.x + dx * u + nx * amp * wave;
        const y = o.y + dy * u + ny * amp * wave;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
    }
    // Rings of force rolling down the beam (ellipses around its axis).
    for (let i = 0; i < 4; i++) {
      const u = (t * 0.7 + b.seed + i / 4) % 1;
      const s = Math.sin(Math.PI * u);
      const r = w0 + (w1 - w0) * u;
      this.ring(g, o.x + dx * u, o.y + dy * u, ux, uy, nx, ny, r * 1.2, r * 0.35, i % 2 ? CYAN : PALE, 0.5 * f * s, 2);
    }
    // Where it lands: ripples spreading out around the beam over the ally's body.
    const kr = Math.max(0.8, Math.min(3, p.r)) * PPM;
    for (let i = 0; i < 2; i++) {
      const u = (t * 1.1 + b.seed + i * 0.5) % 1;
      this.ring(g, p.x, p.y, ux, uy, nx, ny, kr * (0.5 + 0.9 * u), kr * (0.14 + 0.2 * u), VIOLET, 0.5 * f * (1 - u), 2.5);
    }
    g.fillStyle(VIOLET, 0.1 * f * flicker);
    g.fillCircle(p.x, p.y, kr * 0.8);
  }

  /** An ellipse with semi-axes a (along n) and b (along u) around (cx, cy). */
  private ring(g: Phaser.GameObjects.Graphics, cx: number, cy: number, ux: number, uy: number, nx: number, ny: number, a: number, b: number, color: number, alphaV: number, width: number): void {
    if (alphaV <= 0.01) return;
    g.lineStyle(width, color, alphaV);
    g.beginPath();
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const th = (i / n) * Math.PI * 2;
      const c = Math.cos(th) * a;
      const s = Math.sin(th) * b;
      const x = cx + nx * c + ux * s;
      const y = cy + ny * c + uy * s;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokePath();
  }

  /** Speed streaks and afterimages behind a hastened creature, chevrons above it. */
  private drawHastened(c: Creature, alpha: number, t: number, realDt: number): void {
    const k = Math.max(0, Math.min(1, (c.speedMul - 1) / (FULL_MUL - 1)));
    const a = 0.35 + 0.65 * k;
    // Its body: every part still attached (interpolated), its extent and middle.
    // (Sim y points down: its top is the smallest y.)
    let topY = Infinity;
    let bottomY = -Infinity;
    let mx = 0;
    let m = 0;
    const parts = this.parts;
    parts.length = 0;
    for (const p of c.structure.parts) {
      if (p.removed || p.wrecked || !c.owns(p)) continue;
      parts.push(p);
      const y = p.py + (p.y - p.py) * alpha;
      topY = Math.min(topY, y - p.halfHeightNow);
      bottomY = Math.max(bottomY, y + p.halfHeightNow);
      mx += (p.px + (p.x - p.px) * alpha) * p.mass;
      m += p.mass;
    }
    if (!parts.length || m <= 0) return;
    mx /= m;
    // How fast it is going (smoothed): afterimages trail by where it was a moment ago.
    const v0 = this.pace.get(c) ?? -c.core.vx;
    const v = v0 + (-c.core.vx - v0) * Math.min(1, realDt / 0.3);
    this.pace.set(c, v);
    const g = this.back;
    // Afterimages: faint violet copies of its silhouette where it just was.
    for (let i = 1; i <= 2; i++) {
      const off = Math.max(0.25 + 0.35 * k, Math.max(0, v) * 0.12) * i * PPM;
      g.fillStyle(i === 1 ? VIOLET : CYAN, (0.24 - 0.08 * i) * a);
      for (const p of parts) this.silhouette(g, p, alpha, off);
    }
    // Speed streaks: lines trailing from the back of the body at several heights.
    const lines = 3 + Math.round(4 * k);
    const span = bottomY - topY;
    const len = (1.4 + 2.6 * k) * PPM;
    for (let i = 0; i < lines; i++) {
      const h = topY + span * ((i + 0.5) / lines);
      // The back edge of whatever is at this height.
      let edge = -Infinity;
      for (const p of parts) {
        const y = p.py + (p.y - p.py) * alpha;
        if (Math.abs(y - h) > p.halfHeightNow) continue;
        edge = Math.max(edge, p.px + (p.x - p.px) * alpha + p.halfWidthNow);
      }
      if (edge === -Infinity) continue;
      const jitter = ((i * 0.618 + c.id * 0.31) % 1) - 0.5;
      const u = (t * (1.2 + 0.8 * k) + jitter + i * 0.37) % 1;
      const x0 = (edge + 0.15) * PPM + u * len * 0.6;
      const l = len * (0.55 + 0.45 * Math.sin(Math.PI * u)) * (0.8 + 0.4 * jitter);
      const fade = Math.sin(Math.PI * u) * a;
      const th = (2 + 2 * k) * (0.8 + 0.4 * Math.abs(jitter));
      const col = i % 2 ? CYAN : PALE;
      g.fillGradientStyle(col, col, col, col, 0.55 * fade, 0, 0.55 * fade, 0);
      g.fillRect(x0, h * PPM - th / 2, l, th);
    }
    // Chevrons above it (pointing the way it goes): one to three, by how hastened it is.
    const count = c.speedMul >= 1.45 ? 3 : c.speedMul >= 1.25 ? 2 : 1;
    const f = this.front;
    const cy = (topY - 1.3) * PPM;
    const s = 0.55 * PPM;
    for (let i = 0; i < count; i++) {
      // (A pulse running forward along the row, the way it goes.)
      const pulse = 0.6 + 0.4 * Math.sin(t * 5 + i * 0.9);
      const cx = mx * PPM + (i - (count - 1) / 2) * s * 0.9;
      f.lineStyle(6, VIOLET, 0.8 * pulse * a);
      f.beginPath();
      f.moveTo(cx + s * 0.4, cy - s * 0.5);
      f.lineTo(cx - s * 0.2, cy);
      f.lineTo(cx + s * 0.4, cy + s * 0.5);
      f.strokePath();
    }
  }

  /** A part's outline, filled, shifted `off` px behind it (toward +x). */
  private silhouette(g: Phaser.GameObjects.Graphics, p: StructurePart, alpha: number, off: number): void {
    const x = (p.px + (p.x - p.px) * alpha) * PPM + off;
    const y = (p.py + (p.y - p.py) * alpha) * PPM;
    const s = p.shape;
    if (s.kind === 'circle') {
      g.fillCircle(x, y, s.r * PPM);
      return;
    }
    const a = p.pangle + (p.angle - p.pangle) * alpha;
    const c = Math.cos(a);
    const n = Math.sin(a);
    g.beginPath();
    if (s.kind === 'box') {
      const hw = s.hw * PPM;
      const hh = s.hh * PPM;
      g.moveTo(x - c * hw + n * hh, y - n * hw - c * hh);
      g.lineTo(x + c * hw + n * hh, y + n * hw - c * hh);
      g.lineTo(x + c * hw - n * hh, y + n * hw + c * hh);
      g.lineTo(x - c * hw - n * hh, y - n * hw + c * hh);
    } else {
      for (let i = 0; i < s.points.length; i += 2) {
        const px = s.points[i]! * PPM;
        const py = s.points[i + 1]! * PPM;
        if (i === 0) g.moveTo(x + c * px - n * py, y + n * px + c * py);
        else g.lineTo(x + c * px - n * py, y + n * px + c * py);
      }
    }
    g.closePath();
    g.fillPath();
  }

  /** A creature that just reached its cap: a violet ring bursting outward. */
  private drawBurst(u: Burst, alpha: number): void {
    const c = u.creature;
    const p = this.anchor(c, alpha);
    const r = Math.max(1, Math.min(4, p.r * 1.4)) * PPM * (0.6 + 1.2 * (1 - u.life));
    const g = this.front;
    g.lineStyle(5, VIOLET, 0.7 * u.life);
    g.strokeCircle(p.x, p.y, r);
    g.lineStyle(3, CYAN, 0.5 * u.life);
    g.strokeCircle(p.x, p.y, r * 0.75);
  }
}
