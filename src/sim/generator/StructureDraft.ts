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
import { overlapRegion, pointInPart, separation } from './modules/geom';

export interface PartOpts {
  id?: string;
  angle?: number;
  tags?: PartTag[];
  fixed?: boolean;
  densityScale?: number;
  friction?: number;
  restitution?: number;
  /** Weapon-damage hit point multiplier. */
  hpScale?: number;
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
  /** Per-pair strength override (b = -1 for the ground); undefined falls back to `strength`. */
  strengthOf?: (a: number, b: number) => number | undefined;
}

export interface OverlapWeldOpts {
  /** Candidate part indices (default: every other part). */
  among?: number[];
  /** Seam length (m) used for the weld strength (default: 1.5 x the thinner part dimension). */
  seam?: number;
  strength?: number;
  bond?: MaterialId;
  /** Minimum overlap area (m^2) to count as connected. Default 0.0025. */
  minArea?: number;
  tags?: string[];
}

/** Far above any real structure (benchmarks use 2000). */
const MAX_DRAFT_PARTS = 20000;

export class StructureDraft {
  readonly parts: PartDef[] = [];
  readonly joints: JointDef[] = [];
  readonly rng: Random;
  /** Free-form metadata copied into the StructureDef. */
  readonly meta: Record<string, unknown> = {};
  /**
   * Parts that must NOT receive automatic welds from other modules or the
   * ground (loose props, balanced weights, dry voussoirs). Their own module
   * may still weld them explicitly.
   */
  readonly loose = new Set<number>();

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
    // A runaway module loop (e.g. a zero brick size) must fail loudly, not hang the tab.
    if (this.parts.length >= MAX_DRAFT_PARTS) throw new Error(`StructureDraft: more than ${MAX_DRAFT_PARTS} parts (runaway module parameters?)`);
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

  /** Exclude parts from automatic inter-module / ground welding. */
  markLoose(indices: number | number[]): void {
    for (const i of Array.isArray(indices) ? indices : [indices]) this.loose.add(i);
  }

  hasJoint(a: number, b: number | 'ground'): boolean {
    return this.joints.some((j) => (j.a === a && j.b === b) || (j.a === b && j.b === a));
  }

  /** Weld every pair of touching axis-aligned parts (and parts touching the ground). */
  autoWeld(o: AutoWeldOpts = {}): number {
    const idx = o.among ?? this.parts.map((_, i) => i);
    const tol = o.tol ?? 0.03;
    let made = 0;
    // Existing joints as a pair set (same answers as hasJoint, but O(1): hasJoint per pair
    // made big drafts such as the 2000-part debug benchmark take ~10 s).
    const pairs = new Set<string>();
    const key = (a: number, b: number | 'ground'): string => (b === 'ground' ? `${a}|g` : a < b ? `${a}|${b}` : `${b}|${a}`);
    for (const j of this.joints) {
      if (typeof j.a === 'number' && (typeof j.b === 'number' || j.b === 'ground')) pairs.add(key(j.a, j.b));
    }
    for (let i = 0; i < idx.length; i++) {
      const a = idx[i]!;
      const pa = this.parts[a]!;
      if (o.toGround !== false && !pa.fixed && !pairs.has(key(a, 'ground'))) {
        const s = seamBetween(pa, null, tol);
        // Rotated parts only weld to the ground when they really rest on it.
        if (s && (isAlignedBox(pa) || boundsOf(pa).minY <= tol * 0.5) && (!o.filter || o.filter(a, -1))) {
          const strength = o.strengthOf?.(a, -1) ?? o.strength;
          this.joints.push({ kind: 'weld', a, b: 'ground', at: [s.x, s.y], seam: s.length, strength, bond: o.bond });
          pairs.add(key(a, 'ground'));
          made++;
        }
      }
      for (let k = i + 1; k < idx.length; k++) {
        const b = idx[k]!;
        const pb = this.parts[b]!;
        if (pa.fixed && pb.fixed) continue;
        if (pairs.has(key(a, b))) continue;
        const s = seamBetween(pa, pb, tol);
        if (!s) continue;
        // Bounds-based seams are only exact for axis-aligned boxes: for rotated
        // parts, polygons and circles require the outlines to really touch.
        if (!(isAlignedBox(pa) && isAlignedBox(pb)) && separation(pa, pb) > tol) continue;
        if (o.filter && !o.filter(a, b)) continue;
        const strength = o.strengthOf?.(a, b) ?? o.strength;
        this.joints.push({ kind: 'weld', a, b, at: [s.x, s.y], seam: s.length, strength, bond: o.bond });
        pairs.add(key(a, b));
        made++;
      }
    }
    return made;
  }

  /**
   * Weld part `a` to every part its outline OVERLAPS (diagonal braces, truss
   * webs, crossing struts). The anchor is the centroid of the overlap region.
   * The builder disables contacts between welded overlapping parts, so the
   * overlap must be real (> ~0.03 m deep) — extend struts into the members.
   * Returns the indices welded.
   */
  weldOverlaps(a: number, o: OverlapWeldOpts = {}): number[] {
    const pa = this.parts[a]!;
    const minArea = o.minArea ?? 0.0025;
    const out: number[] = [];
    const list = o.among ?? this.parts.map((_, i) => i);
    for (const b of list) {
      if (b === a || this.hasJoint(a, b)) continue;
      const pb = this.parts[b]!;
      if (pa.fixed && pb.fixed) continue;
      const r = overlapRegion(pa, pb);
      if (!r || r.area < minArea) continue;
      const seam = o.seam ?? 1.5 * Math.min(thinDim(pa), thinDim(pb));
      this.joints.push({ kind: 'weld', a, b, at: [r.x, r.y], seam, strength: o.strength, bond: o.bond, tags: o.tags });
      out.push(b);
    }
    return out;
  }

  /** Indices of parts whose outline contains (x, y) (grown by `pad`), topmost-last order. */
  partsAt(x: number, y: number, pad = 0.01, among?: number[]): number[] {
    const list = among ?? this.parts.map((_, i) => i);
    return list.filter((i) => pointInPart(this.parts[i]!, x, y, pad));
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

function isAlignedBox(p: PartDef): boolean {
  if (p.shape.kind !== 'box') return false;
  const ang = (((p.angle ?? 0) % 90) + 90) % 90;
  return ang < 0.01 || ang > 89.99;
}

function thinDim(p: PartDef): number {
  const s = p.shape;
  if (s.kind === 'box') return Math.min(s.w, s.h);
  if (s.kind === 'circle') return s.r;
  const b = boundsOf(p);
  return Math.min(b.maxX - b.minX, b.maxY - b.minY);
}
