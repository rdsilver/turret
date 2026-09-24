/**
 * StructureDraft: a small builder for StructureDefs in DEFINITION SPACE
 * (x right, y up = height above ground, angles in degrees CCW).
 *
 * Modules and level blueprints use it to place parts and connect them.
 * Output is plain data (StructureDef) — nothing here touches physics.
 */
import type { Random } from '../../core/Random';
import type { MaterialId } from '../Materials';
import type { JointDef, PartDef, PartTag, StructureDef } from '../StructureDefinition';
import { boundsOf, seamBetween } from '../StructureBuilder';

export interface PartOpts {
  id?: string;
  angle?: number;
  tags?: PartTag[];
  fixed?: boolean;
  densityScale?: number;
  friction?: number;
  restitution?: number;
}

export interface JointOpts {
  at?: readonly [number, number];
  strength?: number;
  seam?: number;
  bond?: MaterialId;
  tags?: string[];
}

export interface AutoWeldOpts {
  /** Only consider these part indices (default: all). */
  among?: number[];
  /** Also weld parts resting on the ground (y=0). Default true. */
  toGround?: boolean;
  strength?: number;
  bond?: MaterialId;
  /** Return false to skip a pair. */
  filter?: (a: number, b: number) => boolean;
  /** Seam tolerance (m). */
  tol?: number;
}

export class StructureDraft {
  readonly parts: PartDef[] = [];
  readonly joints: JointDef[] = [];
  readonly rng: Random;
  /** Free-form metadata copied into the StructureDef. */
  readonly meta: Record<string, unknown> = {};

  constructor(rng: Random) {
    this.rng = rng;
  }

  get count(): number {
    return this.parts.length;
  }

  /** Box by center. */
  box(x: number, y: number, w: number, h: number, material: MaterialId, o: PartOpts = {}): number {
    return this.add({ shape: { kind: 'box', w, h }, x, y, material, ...o });
  }

  /** Box by bottom-center (handy for stacking). */
  boxOn(x: number, bottom: number, w: number, h: number, material: MaterialId, o: PartOpts = {}): number {
    return this.box(x, bottom + h / 2, w, h, material, o);
  }

  circle(x: number, y: number, r: number, material: MaterialId, o: PartOpts = {}): number {
    return this.add({ shape: { kind: 'circle', r }, x, y, material, ...o });
  }

  /** Convex polygon; points local to (x, y), counter-clockwise, y up. */
  poly(x: number, y: number, points: [number, number][], material: MaterialId, o: PartOpts = {}): number {
    return this.add({ shape: { kind: 'poly', points }, x, y, material, ...o });
  }

  /** A straight member from (x1,y1) to (x2,y2) with the given thickness (rotated box). */
  strut(x1: number, y1: number, x2: number, y2: number, thickness: number, material: MaterialId, o: PartOpts = {}): number {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    return this.box((x1 + x2) / 2, (y1 + y2) / 2, len, thickness, material, { ...o, angle });
  }

  add(p: PartDef): number {
    this.parts.push(p);
    return this.parts.length - 1;
  }

  weld(a: number | string, b: number | string | 'ground', o: JointOpts = {}): void {
    this.joints.push({ kind: 'weld', a, b, ...o });
  }

  hinge(a: number | string, b: number | string | 'ground', at: readonly [number, number], o: Omit<JointOpts, 'at'> = {}): void {
    this.joints.push({ kind: 'hinge', a, b, at, ...o });
  }

  /** Tension-only cable between two world anchor points. */
  cable(
    a: number | string,
    b: number | string | 'ground',
    anchorA: readonly [number, number],
    anchorB: readonly [number, number],
    o: { length?: number; strength?: number; tags?: string[] } = {},
  ): void {
    this.joints.push({ kind: 'cable', a, b, anchorA, anchorB, ...o });
  }

  hasJoint(a: number, b: number | 'ground'): boolean {
    return this.joints.some((j) => (j.a === a && j.b === b) || (j.a === b && j.b === a));
  }

  /** Weld every pair of touching axis-aligned parts (and parts touching the ground). */
  autoWeld(o: AutoWeldOpts = {}): number {
    const idx = o.among ?? this.parts.map((_, i) => i);
    const tol = o.tol ?? 0.03;
    let made = 0;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[i]!;
      const pa = this.parts[a]!;
      if (o.toGround !== false && !pa.fixed && !this.hasJoint(a, 'ground')) {
        const s = seamBetween(pa, null, tol);
        if (s && (!o.filter || o.filter(a, -1))) {
          this.joints.push({ kind: 'weld', a, b: 'ground', at: [s.x, s.y], seam: s.length, strength: o.strength, bond: o.bond });
          made++;
        }
      }
      for (let k = i + 1; k < idx.length; k++) {
        const b = idx[k]!;
        const pb = this.parts[b]!;
        if (pa.fixed && pb.fixed) continue;
        if (this.hasJoint(a, b)) continue;
        const s = seamBetween(pa, pb, tol);
        if (!s) continue;
        if (o.filter && !o.filter(a, b)) continue;
        this.joints.push({ kind: 'weld', a, b, at: [s.x, s.y], seam: s.length, strength: o.strength, bond: o.bond });
        made++;
      }
    }
    return made;
  }

  /** Axis-aligned bounds (definition space) of a part. */
  bounds(i: number): { minX: number; maxX: number; minY: number; maxY: number } {
    return boundsOf(this.parts[i]!);
  }

  top(i: number): number {
    return this.bounds(i).maxY;
  }

  /** Bounds of everything so far. */
  extent(): { minX: number; maxX: number; minY: number; maxY: number } {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < this.parts.length; i++) {
      const b = this.bounds(i);
      minX = Math.min(minX, b.minX);
      maxX = Math.max(maxX, b.maxX);
      minY = Math.min(minY, b.minY);
      maxY = Math.max(maxY, b.maxY);
    }
    return { minX, maxX, minY, maxY };
  }

  /** Tag a set of parts (e.g. mark the whole module as 'foundation'). */
  tag(indices: number[], tag: PartTag): void {
    for (const i of indices) {
      const p = this.parts[i]!;
      p.tags = [...(p.tags ?? []), tag];
    }
  }

  toDef(originX: number, name?: string): StructureDef {
    return {
      originX,
      parts: this.parts.map((p) => ({ ...p })),
      joints: this.joints.map((j) => ({ ...j })),
      meta: { name, seed: this.rng.seed, ...this.meta },
    };
  }
}
