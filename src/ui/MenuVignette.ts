/**
 * Live physics vignette for the main menu: a slideshow of creatures from the
 * campaign, each on for SLOT seconds. The specimen walks into a small test
 * range in a real Simulation (same muscles, joints and failure model as the
 * game) while an automatic machine gun off to the left works on its weak
 * points: it limps, loses limbs, goes down. Stopped (or through the range)
 * before its time is up, another of the same kind walks in; then the view
 * fades to the next specimen.
 *
 * Rendered with one Graphics through a dedicated camera whose viewport is the
 * "test cell" rectangle, so everything is clipped to the cell for free. The
 * scene's other cameras ignore the graphics; the cell camera ignores
 * everything else (including objects added later).
 */
import * as Phaser from 'phaser';
import { Simulation } from '../sim/Simulation';
import { StructurePart } from '../sim/StructurePart';
import { Projectile } from '../sim/weapons/Projectile';
import { AutoGunner } from '../sim/weapons/AutoGunner';
import { BASE_MG_STATS } from '../sim/weapons/Weapon';
import { AMMO } from '../data/ammo';
import type { Creature } from '../sim/creature/Creature';
import '../sim/creature';
import { PPM } from '../config/constants';
import { THEME } from './theme';

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Specimens, in turn (blueprint ids and their level params). */
const SPECIMENS: Array<{ kind: string; params?: Record<string, number> }> = [
  { kind: 'stickman', params: { speed: 0.8 } },
  { kind: 'hound', params: { speed: 1.2 } },
  { kind: 'knight' },
  { kind: 'thrower' },
  { kind: 'blob' },
  { kind: 'smoker' },
  { kind: 'shifter', params: { hp: 0.6 } },
  { kind: 'bomber' },
  { kind: 'brood', params: { count: 3 } },
];

/** Middle of the range (sim m), metres shown across the cell, where specimens walk in. */
const CENTER_X = 27;
const VIEW_W_M = 38;
const SPAWN_X = CENTER_X + VIEW_W_M / 2 + 3;
/** Seconds each specimen is on; the gun holds fire this long after one walks in. */
const SLOT = 25;
const HOLD_FIRE = 3;
/** Seconds after one goes down (or walks out) before the next of its kind walks in, and the latest that can happen. */
const NEXT_AFTER = 2.5;
const LAST_ENTRY = SLOT - 6;
/** The gun: a starter machine gun with better rounds (the show should not drag). */
const GUN = { ...BASE_MG_STATS, damage: (BASE_MG_STATS.damage ?? 1) * 2.5 };

export class MenuVignette {
  readonly cam: Phaser.Cameras.Scene2D.Camera;
  private readonly g: Phaser.GameObjects.Graphics;
  private sim: Simulation | null = null;
  private gunner: AutoGunner | null = null;
  private creature: Creature | null = null;
  private index = 0;
  private clock = 0;
  /** When the latest one walked in, and when the next of its kind does (-1: not due). */
  private enteredAt = 0;
  private nextAt = -1;
  private fade = 0;
  private fadeDir = 1;
  private seed = 1;
  private readonly onAdded = (go: Phaser.GameObjects.GameObject): void => {
    if (go !== this.g) this.cam.ignore(go);
  };

  /** Current specimen label (for the cell caption). */
  name = '';

  constructor(
    readonly scene: Phaser.Scene,
    readonly cell: CellRect,
  ) {
    this.g = scene.add.graphics();
    // Other cameras must not draw the vignette.
    for (const c of scene.cameras.cameras) c.ignore(this.g);
    this.cam = scene.cameras.add(cell.x, cell.y, cell.w, cell.h, false, 'vignette');
    this.cam.setBackgroundColor('rgba(0,0,0,0)');
    for (const go of scene.children.list) if (go !== this.g) this.cam.ignore(go);
    scene.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAdded);
    const zoom = cell.w / (VIEW_W_M * PPM);
    this.cam.setZoom(zoom);
    const viewH = cell.h / zoom;
    // Ground ~11% above the bottom of the cell.
    this.cam.centerOn(CENTER_X * PPM, -viewH / 2 + viewH * 0.11);
    this.seed = (Math.random() * 1e9) >>> 0;
    this.index = this.seed % SPECIMENS.length;
    this.load();
  }

  /** Live stats for the caption: joints intact / total (the specimen on the range and its brood), time into its slot. */
  stats(out: { joints: number; intact: number; time: number; name: string }): void {
    let joints = 0;
    let intact = 0;
    const seen = new Set<unknown>();
    const list = this.sim?.creatures.list ?? [];
    const on = list.filter((c) => c.active);
    for (const c of on.length ? on : this.creature ? [this.creature] : []) {
      if (seen.has(c.structure)) continue;
      seen.add(c.structure);
      for (const j of c.structure.joints) {
        joints++;
        if (!j.broken) intact++;
      }
    }
    out.joints = joints;
    out.intact = intact;
    out.time = this.clock;
    out.name = this.name;
  }

  update(realDt: number): void {
    const sim = this.sim;
    if (!sim) return;
    const dt = Math.min(0.05, realDt);
    this.clock += dt;

    // Fade between specimens.
    if (this.fadeDir !== 0) {
      this.fade = Math.max(0, Math.min(1, this.fade + (this.fadeDir * dt) / 0.5));
      if (this.fadeDir > 0 && this.fade >= 1) this.fadeDir = 0;
      if (this.fadeDir < 0 && this.fade <= 0) {
        this.index = (this.index + 1) % SPECIMENS.length;
        this.load();
        return;
      }
    }

    // Script: let it walk in, open fire, watch it go down; another of its kind
    // if there is time; the next specimen when its slot is up.
    if (this.gunner) this.gunner.enabled = this.clock - this.enteredAt >= HOLD_FIRE;
    for (const c of sim.creatures.list) {
      // Out of the range to the left: it has made it (off the stage).
      if (c.active && c.frontX < CENTER_X - VIEW_W_M / 2) c.neutralize('stuck');
    }
    if (this.nextAt < 0 && !sim.creatures.list.some((c) => c.active) && this.clock + NEXT_AFTER <= LAST_ENTRY) this.nextAt = this.clock + NEXT_AFTER;
    if (this.nextAt >= 0 && this.clock >= this.nextAt) this.enter();
    if (this.clock >= SLOT - 0.5 && this.fadeDir === 0) this.fadeDir = -1;

    sim.update(dt);
    this.draw();
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAdded);
    this.gunner?.dispose();
    this.sim?.destroy();
    this.sim = null;
    this.g.destroy();
    this.scene.cameras.remove(this.cam);
  }

  // ------------------------------------------------------------------ internals

  private load(): void {
    this.gunner?.dispose();
    this.sim?.destroy();
    const sim = new Simulation({ seed: this.seed + this.index, weaponStats: GUN, ammo: AMMO.bullet });
    sim.autoCleanup = false;
    this.gunner = new AutoGunner(sim, sim.weapon);
    this.gunner.enabled = false;
    this.sim = sim;
    this.clock = 0;
    this.fade = 0;
    this.fadeDir = 1;
    this.enter();
    this.name = this.creature!.spec.name.toUpperCase();
  }

  /** The specimen (another of its kind, after the first) walks in from the right. */
  private enter(): void {
    const sim = this.sim!;
    const spec = SPECIMENS[this.index]!;
    this.creature = sim.creatures.spawn(spec.kind, SPAWN_X, spec.params ?? {}, this.seed + this.index * 101 + Math.floor(this.clock * 7));
    this.enteredAt = this.clock;
    this.nextAt = -1;
  }

  private draw(): void {
    const sim = this.sim;
    if (!sim) return;
    const g = this.g;
    g.clear();
    const a = sim.physics.alpha;
    g.setAlpha(this.fade);

    // Ground + measuring marks
    const x0 = (CENTER_X - VIEW_W_M) * PPM;
    const x1 = (CENTER_X + VIEW_W_M) * PPM;
    g.fillStyle(THEME.bgDeep, 0.9);
    g.fillRect(x0, 0, x1 - x0, 6 * PPM);
    g.lineStyle(2, 0x6b7585, 1);
    g.lineBetween(x0, 0, x1, 0);
    g.lineStyle(1, THEME.rule, 1);
    for (let m = Math.ceil(CENTER_X - VIEW_W_M); m <= CENTER_X + VIEW_W_M; m += 1) {
      const major = m % 5 === 0;
      g.lineBetween(m * PPM, 0, m * PPM, major ? 12 : 5);
    }

    for (const e of sim.physics.entities.values()) {
      const ex = (e.px + (e.x - e.px) * a) * PPM;
      const ey = (e.py + (e.y - e.py) * a) * PPM;
      if (e instanceof StructurePart) {
        const ang = e.pangle + (e.angle - e.pangle) * a;
        const fadeK = e.fading > 0 && e.fadeDuration > 0 ? e.fading / e.fadeDuration : 1;
        this.drawPart(e, ex, ey, ang, fadeK);
      } else if (e instanceof Projectile) {
        // A round: a short tracer streak behind it.
        const k = 0.035 * PPM;
        g.lineStyle(2, 0xffe9b0, 0.85);
        g.lineBetween(ex - e.vx * k, ey - e.vy * k, ex, ey);
      }
    }
    // Joints: small marks coloured by measured stress (white -> amber -> red).
    for (const c of sim.creatures.list) {
      if (!c.active) continue;
      for (const j of c.structure.joints) {
        if (j.broken || j.isGround || !c.owns(j.a)) continue;
        const k = j.stressVis;
        const col = k < 0.35 ? 0xe8ecf1 : k < 0.75 ? THEME.accentNum : THEME.badNum;
        g.fillStyle(col, k < 0.35 ? 0.55 : 0.95);
        g.fillRect(j.wx * PPM - 3, j.wy * PPM - 3, 6, 6);
      }
    }
  }

  private drawPart(p: StructurePart, x: number, y: number, ang: number, fadeK: number): void {
    const g = this.g;
    // Worn parts redden as they do in the game.
    const col = lerp(p.material.color, 0xd8433a, Math.min(1, (1 - p.integrity) * 1.2));
    const glass = p.material.id === 'glass';
    g.fillStyle(col, (glass ? 0.45 : 0.95) * fadeK);
    g.lineStyle(1.5, shade(col, 0.45), fadeK);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const sh = p.shape;
    if (sh.kind === 'circle') {
      g.fillCircle(x, y, sh.r * PPM);
      g.strokeCircle(x, y, sh.r * PPM);
      return;
    }
    g.beginPath();
    if (sh.kind === 'box') {
      const hw = sh.hw * PPM;
      const hh = sh.hh * PPM;
      g.moveTo(x + (-hw * c - -hh * s), y + (-hw * s + -hh * c));
      g.lineTo(x + (hw * c - -hh * s), y + (hw * s + -hh * c));
      g.lineTo(x + (hw * c - hh * s), y + (hw * s + hh * c));
      g.lineTo(x + (-hw * c - hh * s), y + (-hw * s + hh * c));
    } else {
      const pts = sh.points;
      for (let i = 0; i < pts.length; i += 2) {
        const lx = pts[i]! * PPM;
        const ly = pts[i + 1]! * PPM;
        const wx = x + lx * c - ly * s;
        const wy = y + lx * s + ly * c;
        if (i === 0) g.moveTo(wx, wy);
        else g.lineTo(wx, wy);
      }
    }
    g.closePath();
    g.fillPath();
    g.strokePath();
  }
}

function shade(c: number, k: number): number {
  const r = ((c >> 16) & 255) * k;
  const g = ((c >> 8) & 255) * k;
  const b = (c & 255) * k;
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

function lerp(a: number, b: number, t: number): number {
  const ch = (s: number) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) & 255;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
