/**
 * One rigid component of a structure (or a fragment/rubble piece).
 * Gameplay data lives here; the Rapier body is owned via Entity.
 */
import { Entity } from './Entity';
import { partMaxHp, type MaterialDef } from './Materials';
import type { PartDef } from './StructureDefinition';
import type { BreakableJoint } from './BreakableJoint';
import type { Structure } from './Structure';

/** Shape in SIMULATION space (y down), local to the body origin. */
export type PartShape =
  | { kind: 'box'; hw: number; hh: number }
  | { kind: 'circle'; r: number }
  /** Flat [x0, y0, x1, y1, ...] convex polygon, sim space, local. */
  | { kind: 'poly'; points: number[] };

export class StructurePart extends Entity {
  readonly kind = 'part' as const;

  readonly def: PartDef;
  readonly material: MaterialDef;
  readonly shape: PartShape;
  readonly tags: ReadonlySet<string>;
  readonly name: string | null;
  readonly fixed: boolean;

  structure: Structure | null = null;
  /** Index inside the owning structure's `parts` array (-1 for loose debris). */
  index = -1;

  /** Joints currently attached (broken joints are removed). */
  joints: BreakableJoint[] = [];

  /** Spawn transform (sim space) and spawn height of the center above ground (m). */
  x0 = 0;
  y0 = 0;
  angle0 = 0;
  h0 = 0;
  /** Approximate area (m^2) — explosion exposure, fracture sizing. */
  area = 0;
  /** Characteristic size (m): the longer half-extent / radius. */
  extent = 0;

  /** Created by fracture (shards) — not counted in structural metrics. */
  isFragment = false;
  /** Shattered/removed parts count as fully destroyed. */
  destroyed = false;
  /** Has dropped past its fallen threshold (latched). */
  fallen = false;
  /** Center currently below the objective destruction line. */
  belowLine = false;
  /** Center started above the destruction line (tracked by the line objective). */
  aboveLineAtStart = false;
  /** Visual wear 0..1 (max damage of joints it lost/has). */
  wear = 0;
  /** Seconds this part has been continuously asleep while detached (debris manager). */
  restTime = 0;
  /** Sim time when it lost its last joint (-1 = never). */
  detachedAt = -1;
  /** Detonation already scheduled/done. */
  armed = false;
  /** 0..1 weapon-damage integrity (1 = pristine). */
  integrity = 1;
  /** Hit points at integrity 1 (see partMaxHp). */
  maxHp = 10;
  /** Weapon damage broke it apart (limb severed / plate knocked off). */
  wrecked = false;
  /** 0..1+ heat (engines overheat when shot). */
  heat = 0;
  /**
   * Can't be hurt right now: weapon damage deflects (DamageSystem emits
   * partDeflected and changes nothing) and blasts don't break its joints to
   * other invulnerable parts. Set and cleared by whoever grants it (a roaming
   * weak spot keeps every other part of its creature invulnerable).
   */
  invulnerable = false;

  constructor(def: PartDef, material: MaterialDef, shape: PartShape) {
    super();
    this.def = def;
    this.material = material;
    this.shape = shape;
    this.tags = new Set(def.tags ?? []);
    this.name = def.id ?? null;
    this.fixed = !!def.fixed;
    switch (shape.kind) {
      case 'box':
        this.area = shape.hw * shape.hh * 4;
        this.extent = Math.max(shape.hw, shape.hh);
        break;
      case 'circle':
        this.area = Math.PI * shape.r * shape.r;
        this.extent = shape.r;
        break;
      case 'poly': {
        let a = 0;
        let ext = 0;
        const p = shape.points;
        for (let i = 0; i < p.length; i += 2) {
          const x1 = p[i]!;
          const y1 = p[i + 1]!;
          const x2 = p[(i + 2) % p.length]!;
          const y2 = p[(i + 3) % p.length]!;
          a += x1 * y2 - x2 * y1;
          ext = Math.max(ext, Math.hypot(x1, y1));
        }
        this.area = Math.abs(a) / 2;
        this.extent = ext;
        break;
      }
    }
    this.maxHp = partMaxHp(material, this.area) * (def.hpScale ?? 1);
  }

  get isCore(): boolean {
    return this.tags.has('core');
  }

  get isFoundation(): boolean {
    return this.tags.has('foundation') || this.fixed;
  }

  get detached(): boolean {
    return this.joints.length === 0;
  }

  /** Height of the center above ground (m). */
  get height(): number {
    return -this.y;
  }

  /** Half-height of the shape's axis-aligned bounds at its CURRENT angle (m). */
  get halfHeightNow(): number {
    const s = this.shape;
    if (s.kind === 'circle') return s.r;
    if (s.kind === 'box') {
      const c = Math.abs(Math.cos(this.angle));
      const sn = Math.abs(Math.sin(this.angle));
      return s.hw * sn + s.hh * c;
    }
    const c = Math.cos(this.angle);
    const sn = Math.sin(this.angle);
    let m = 0;
    for (let i = 0; i < s.points.length; i += 2) m = Math.max(m, Math.abs(sn * s.points[i]! + c * s.points[i + 1]!));
    return m;
  }

  /** Half-width of the shape's axis-aligned bounds at its CURRENT angle (m). */
  get halfWidthNow(): number {
    const s = this.shape;
    if (s.kind === 'circle') return s.r;
    if (s.kind === 'box') {
      const c = Math.abs(Math.cos(this.angle));
      const sn = Math.abs(Math.sin(this.angle));
      return s.hw * c + s.hh * sn;
    }
    const c = Math.cos(this.angle);
    const sn = Math.sin(this.angle);
    let m = 0;
    for (let i = 0; i < s.points.length; i += 2) m = Math.max(m, Math.abs(c * s.points[i]! - sn * s.points[i + 1]!));
    return m;
  }

  /** Lowest point of the shape (approx, uses extent). */
  get bottomHeight(): number {
    return -this.y - this.extent;
  }

  hasTag(tag: string): boolean {
    return this.tags.has(tag);
  }
}
