/**
 * Healing light (menders, see sim/creature/healing.ts). Owned by WorldRenderer.
 *
 * - The cone: while a healer's lamp shines, a soft green cone of light opens
 *   downward from the lamp, exactly as wide as the zone it heals in, fading
 *   toward the ground and breathing slowly. It brightens while it is
 *   actually mending something, and fades in and out instead of popping.
 * - Beams: every part it mends (partHealed) gets a tapered beam from the lamp
 *   with motes running down it, and a soft halo on the part, for as long as
 *   the healing goes on (each partHealed refreshes the link).
 * The part itself flashes green and loses its damage tint in WorldRenderer.
 *
 * Everything is drawn into two additive Graphics (no textures): the cones
 * behind the creatures, beams and halos in front. Positions are interpolated
 * like the parts' images.
 */
import * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import type { StructurePart } from '../sim/StructurePart';
import type { Creature } from '../sim/creature/Creature';
import { healCone, healSpec, healing } from '../sim/creature/healing';
import { PPM } from '../config/constants';
import { DEPTH } from './depths';

const LIGHT = 0x7dffc0;
const BEAM = 0x9dffd0;
/** Seconds a beam lingers after the last heal tick on its part. */
const LINK_LIFE = 0.35;
/** Seconds for a cone to fade in / out. */
const CONE_FADE = 0.4;

interface Link {
  part: StructurePart;
  organ: StructurePart;
  healer: Creature;
  /** 1..0, refreshed by every heal tick. */
  life: number;
  seed: number;
}

export class HealBeams {
  private readonly back: Phaser.GameObjects.Graphics;
  private readonly front: Phaser.GameObjects.Graphics;
  private readonly links = new Map<StructurePart, Link>();
  /** Cone brightness per healer (fades in and out). */
  private readonly cones = new Map<Creature, number>();
  private readonly off: () => void;
  private time = 0;
  private drawn = false;

  constructor(
    scene: Phaser.Scene,
    private readonly sim: Simulation,
  ) {
    this.back = scene.add.graphics().setDepth(DEPTH.structure - 0.6).setBlendMode(Phaser.BlendModes.ADD);
    this.front = scene.add.graphics().setDepth(DEPTH.joints - 0.5).setBlendMode(Phaser.BlendModes.ADD);
    this.off = sim.events.on('partHealed', ({ part, organ, healer }) => {
      const l = this.links.get(part);
      if (l) {
        l.life = 1;
        l.organ = organ;
        l.healer = healer;
      } else this.links.set(part, { part, organ, healer, life: 1, seed: Math.random() });
    });
  }

  update(alpha: number, realDt: number): void {
    this.time += realDt;
    // Which lamps shine (a handful of creatures at most).
    for (const c of this.sim.creatures.list) {
      if (!healSpec(c)) continue;
      const on = healing(c);
      const k = this.cones.get(c) ?? 0;
      const next = Math.max(0, Math.min(1, k + (on ? 1 : -1) * (realDt / CONE_FADE)));
      if (next > 0 || this.cones.has(c)) this.cones.set(c, next);
    }
    for (const [c, k] of this.cones) if (k <= 0 || !this.sim.creatures.list.includes(c)) this.cones.delete(c);
    for (const [p, l] of this.links) {
      l.life -= realDt / LINK_LIFE;
      if (l.life <= 0 || p.removed || l.organ.removed) this.links.delete(p);
    }
    if (!this.cones.size && !this.links.size) {
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
    for (const [c, k] of this.cones) this.drawCone(c, k, alpha, t);
    for (const l of this.links.values()) this.drawBeam(l, alpha, t);
  }

  clear(): void {
    this.links.clear();
    this.cones.clear();
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

  private drawCone(c: Creature, k: number, alpha: number, t: number): void {
    const spec = healSpec(c);
    const organ = spec ? c.structure.part(spec.part) : undefined;
    if (!spec || !organ || organ.removed) return;
    const cone = healCone(spec);
    const o = this.at(organ, alpha);
    // Down to the ground (or as far as it reaches).
    const depth = Math.min(cone.reach, Math.max(0, -organ.y));
    if (depth <= 0.5) return;
    let busy = 0;
    for (const l of this.links.values()) if (l.healer === c) busy = Math.max(busy, l.life);
    const breathe = 0.85 + 0.15 * Math.sin(t * 2.4 + c.id);
    const a = k * breathe * (0.1 + 0.08 * busy);
    const g = this.back;
    const bottom = o.y + depth * PPM;
    const half = (cone.r0 + depth * cone.tan) * PPM;
    const r0 = cone.r0 * PPM;
    // Wide soft cone (the exact healing zone: a symmetric fan, dimmer toward
    // the bottom but still there), then a brighter core down the middle.
    const b = a * 0.35;
    g.fillGradientStyle(LIGHT, LIGHT, LIGHT, LIGHT, a, b, b);
    g.fillTriangle(o.x - r0, o.y, o.x - half, bottom, o.x, bottom);
    g.fillGradientStyle(LIGHT, LIGHT, LIGHT, LIGHT, a, a, b);
    g.fillTriangle(o.x - r0, o.y, o.x + r0, o.y, o.x, bottom);
    g.fillGradientStyle(LIGHT, LIGHT, LIGHT, LIGHT, a, b, b);
    g.fillTriangle(o.x + r0, o.y, o.x + half, bottom, o.x, bottom);
    g.fillGradientStyle(LIGHT, LIGHT, LIGHT, LIGHT, a * 1.2, 0, 0);
    g.fillTriangle(o.x, o.y, o.x - half * 0.45, bottom, o.x + half * 0.45, bottom);
    // Where the light lands: a pool on the ground.
    if (depth < cone.reach) {
      g.fillStyle(LIGHT, a * 0.5);
      g.fillEllipse(o.x, 0, half * 2, 26);
      g.fillStyle(LIGHT, a * 0.5);
      g.fillEllipse(o.x, 0, half * 1.2, 14);
    }
    // The lamp itself glows harder while it works.
    const lr = organ.extent * PPM;
    const pulse = 0.8 + 0.2 * Math.sin(t * 5 + c.id);
    this.front.fillStyle(LIGHT, 0.1 * k * pulse);
    this.front.fillCircle(o.x, o.y, lr * 2.4);
    this.front.fillStyle(LIGHT, (0.12 + 0.12 * busy) * k * pulse);
    this.front.fillCircle(o.x, o.y, lr * 1.5);
  }

  private drawBeam(l: Link, alpha: number, t: number): void {
    const o = this.at(l.organ, alpha);
    const p = this.at(l.part, alpha);
    const dx = p.x - o.x;
    const dy = p.y - o.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const nx = -dy / len;
    const ny = dx / len;
    const k = Math.min(1, l.life * 1.5);
    const w0 = 0.12 * PPM;
    const w1 = Math.max(0.25, Math.min(1.2, l.part.extent * 0.6)) * PPM;
    const g = this.front;
    // Tapered beam: narrow at the lamp, as wide as the part at its end.
    const flicker = 0.85 + 0.15 * Math.sin(t * 13 + l.seed * 40);
    const a0 = 0.26 * k * flicker;
    const a1 = 0.12 * k * flicker;
    g.fillGradientStyle(BEAM, BEAM, BEAM, BEAM, a0, a0, a1);
    g.fillTriangle(o.x + nx * w0, o.y + ny * w0, o.x - nx * w0, o.y - ny * w0, p.x - nx * w1, p.y - ny * w1);
    g.fillGradientStyle(BEAM, BEAM, BEAM, BEAM, a0, a1, a1);
    g.fillTriangle(o.x + nx * w0, o.y + ny * w0, p.x - nx * w1, p.y - ny * w1, p.x + nx * w1, p.y + ny * w1);
    // Motes running down the beam.
    for (let i = 0; i < 3; i++) {
      const u = (t * 0.9 + l.seed + i / 3) % 1;
      const s = Math.sin(Math.PI * u);
      g.fillStyle(0xe8fff4, 0.55 * k * s);
      g.fillCircle(o.x + dx * u, o.y + dy * u, (0.07 + 0.05 * s) * PPM);
    }
    // A soft halo on the part being mended.
    const r = Math.max(0.4, Math.min(2.2, l.part.extent)) * PPM;
    const pulse = 0.75 + 0.25 * Math.sin(t * 7 + l.seed * 20);
    g.fillStyle(LIGHT, 0.08 * k * pulse);
    g.fillCircle(p.x, p.y, r * 1.25);
    g.fillStyle(LIGHT, 0.1 * k * pulse);
    g.fillCircle(p.x, p.y, r * 0.75);
  }
}
