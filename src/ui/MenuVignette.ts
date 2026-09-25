/**
 * Live physics vignette for the main menu: a small hand-built specimen in a
 * real Simulation (same joints, same failure model as the game) that gets
 * shot, collapses, and is replaced by the next specimen.
 *
 * Rendered with one Graphics through a dedicated camera whose viewport is the
 * "test cell" rectangle, so everything is clipped to the cell for free. The
 * scene's other cameras ignore the graphics; the cell camera ignores
 * everything else (including objects added later).
 */
import * as Phaser from 'phaser';
import { Simulation } from '../sim/Simulation';
import { StructureDraft } from '../sim/generator/StructureDraft';
import type { StructureDef } from '../sim/StructureDefinition';
import { StructurePart } from '../sim/StructurePart';
import { Projectile } from '../sim/weapons/Projectile';
import { solveAim } from '../sim/ballistics';
import { Random } from '../core/Random';
import { PPM } from '../config/constants';
import { BASE_WEAPON_STATS } from '../sim/weapons/Weapon';
import { THEME } from './theme';
import { SPECIMENS, type Specimen } from './menuSpecimens';

export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ORIGIN_X = 30;
/** Sim meters shown across the cell. */
const VIEW_W_M = 17;

export class MenuVignette {
  readonly cam: Phaser.Cameras.Scene2D.Camera;
  private readonly g: Phaser.GameObjects.Graphics;
  private sim: Simulation | null = null;
  private index = 0;
  private clock = 0;
  private shots = 0;
  private lastShot = 0;
  private endAt = -1;
  private fade = 0;
  private fadeDir = 1;
  private dirty = true;
  private seed = 1;
  private readonly trail = new Float32Array(48);
  private trailN = 0;
  private trailHead = 0;
  private trackId = -1;
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
    this.cam.centerOn(ORIGIN_X * PPM, -viewH / 2 + viewH * 0.11);
    this.seed = (Math.random() * 1e9) >>> 0;
    this.index = this.seed % SPECIMENS.length;
    this.load();
  }

  /** Live stats for the caption: joints intact / total, sim time. */
  stats(out: { joints: number; intact: number; time: number; name: string }): void {
    const s = this.sim?.structure;
    out.joints = s ? s.joints.length : 0;
    out.intact = s ? s.joints.length - s.jointsBroken : 0;
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
      this.dirty = true;
      if (this.fadeDir > 0 && this.fade >= 1) this.fadeDir = 0;
      if (this.fadeDir < 0 && this.fade <= 0) {
        this.index = (this.index + 1) % SPECIMENS.length;
        this.load();
        return;
      }
    }

    // Script: wait, fire, watch; fire again if it survived; move on after it settles.
    const spec = SPECIMENS[this.index]!;
    if (this.endAt < 0) {
      const due = this.shots === 0 ? 1.6 : this.lastShot + 3.2;
      if (this.clock >= due && sim.phase === 'standing' && this.shots < 3) this.fireAt(spec);
      if (sim.phase === 'settled' || (this.shots >= 3 && this.clock > this.lastShot + 5) || this.clock > 16) this.endAt = this.clock + 1.6;
    } else if (this.clock >= this.endAt && this.fadeDir === 0) {
      this.fadeDir = -1;
    }

    sim.update(dt);
    if (sim.physics.stats.active > 0 || sim.projectiles.count > 0) this.dirty = true;
    if (this.dirty) this.draw();
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, this.onAdded);
    this.sim?.destroy();
    this.sim = null;
    this.g.destroy();
    this.scene.cameras.remove(this.cam);
  }

  // ------------------------------------------------------------------ internals

  private load(): void {
    this.sim?.destroy();
    const spec = SPECIMENS[this.index]!;
    // Demo shells are heavier than the starting cannon's: the vignette should collapse on cue.
    const sim = new Simulation({ seed: this.seed + this.index, weaponStats: { ...BASE_WEAPON_STATS, projectileMass: 320, muzzleVelocity: 38 } });
    const d = new StructureDraft(new Random(this.seed + this.index));
    spec.build(d);
    d.autoWeld();
    const def: StructureDef = d.toDef(ORIGIN_X, spec.name);
    sim.loadStructure(def, undefined, 1.5);
    this.sim = sim;
    this.name = spec.name;
    this.clock = 0;
    this.shots = 0;
    this.lastShot = 0;
    this.endAt = -1;
    this.fade = 0;
    this.fadeDir = 1;
    this.trailN = 0;
    this.trackId = -1;
    this.dirty = true;
  }

  private fireAt(spec: Specimen): void {
    const sim = this.sim!;
    const w = sim.weapon;
    const aim = spec.aims[Math.min(this.shots, spec.aims.length - 1)]!;
    const tx = ORIGIN_X + aim[0];
    const ty = -aim[1];
    let angle = w.angle;
    for (let k = 0; k < 4; k++) {
      w.setAngle(angle);
      const m = w.muzzle();
      const sol = solveAim(m.x, m.y, tx, ty, w.speed, sim.physics.gravity);
      if (!sol.length) return;
      angle = sol[spec.arc ?? 0]!;
    }
    w.setAngle(angle);
    w.reload = 0;
    if (sim.fire()) {
      this.shots++;
      this.lastShot = this.clock;
    }
  }

  private draw(): void {
    const sim = this.sim;
    if (!sim) return;
    this.dirty = false;
    const g = this.g;
    g.clear();
    const a = sim.physics.alpha;
    const fadeA = this.fade;
    g.setAlpha(fadeA);

    // Ground + measuring marks
    const x0 = (ORIGIN_X - VIEW_W_M) * PPM;
    const x1 = (ORIGIN_X + VIEW_W_M) * PPM;
    g.fillStyle(THEME.bgDeep, 0.9);
    g.fillRect(x0, 0, x1 - x0, 6 * PPM);
    g.lineStyle(2, 0x6b7585, 1);
    g.lineBetween(x0, 0, x1, 0);
    g.lineStyle(1, THEME.rule, 1);
    for (let m = ORIGIN_X - VIEW_W_M; m <= ORIGIN_X + VIEW_W_M; m += 1) {
      const major = m % 5 === 0;
      g.lineBetween(m * PPM, 0, m * PPM, major ? 12 : 5);
    }

    let proj: Projectile | null = null;
    for (const e of sim.physics.entities.values()) {
      const ex = (e.px + (e.x - e.px) * a) * PPM;
      const ey = (e.py + (e.y - e.py) * a) * PPM;
      if (e instanceof StructurePart) {
        const ang = e.pangle + (e.angle - e.pangle) * a;
        const fadeK = e.fading > 0 && e.fadeDuration > 0 ? e.fading / e.fadeDuration : 1;
        this.drawPart(e, ex, ey, ang, fadeK);
      } else if (e instanceof Projectile) {
        proj = e;
        g.fillStyle(0x23272e, 1);
        g.fillCircle(ex, ey, e.radius * PPM);
        g.lineStyle(1.5, 0xe8ecf1, 0.9);
        g.strokeCircle(ex, ey, e.radius * PPM);
      }
    }
    // Welds: small marks coloured by measured stress (white -> amber -> red).
    const st = sim.structure;
    if (st) {
      for (const j of st.joints) {
        if (j.broken || j.isGround) continue;
        const k = j.stressVis;
        const col = k < 0.35 ? 0xe8ecf1 : k < 0.75 ? THEME.accentNum : THEME.badNum;
        g.fillStyle(col, k < 0.35 ? 0.55 : 0.95);
        g.fillRect(j.wx * PPM - 2, j.wy * PPM - 2, 4, 4);
      }
    }
    this.drawTrail(proj);
  }

  private drawPart(p: StructurePart, x: number, y: number, ang: number, fadeK: number): void {
    const g = this.g;
    const col = p.material.color;
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

  private drawTrail(p: Projectile | null): void {
    const g = this.g;
    const cap = this.trail.length / 2;
    if (p) {
      if (p.id !== this.trackId) {
        this.trackId = p.id;
        this.trailN = 0;
      }
      this.trail[this.trailHead * 2] = p.x * PPM;
      this.trail[this.trailHead * 2 + 1] = p.y * PPM;
      this.trailHead = (this.trailHead + 1) % cap;
      if (this.trailN < cap) this.trailN++;
    } else if (this.trailN > 0) {
      this.trailN--;
      this.dirty = true;
    }
    for (let i = 1; i < this.trailN; i++) {
      const i0 = (this.trailHead - i - 1 + cap * 2) % cap;
      const i1 = (this.trailHead - i + cap * 2) % cap;
      g.lineStyle(2, 0xf2f5f8, 0.5 * (1 - i / this.trailN));
      g.lineBetween(this.trail[i0 * 2]!, this.trail[i0 * 2 + 1]!, this.trail[i1 * 2]!, this.trail[i1 * 2 + 1]!);
    }
  }
}

function shade(c: number, k: number): number {
  const r = ((c >> 16) & 255) * k;
  const g = ((c >> 8) & 255) * k;
  const b = (c & 255) * k;
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}
