/**
 * Shared building blocks for creature blueprints. Definition space: y up,
 * facing LEFT (toward the turret). Positive muscle angles swing a limb
 * forward (toward the turret).
 */
import type { CreatureSpec, MuscleGait } from '../CreatureTypes';
import type { StructureDraft, PartOpts } from '../../generator/StructureDraft';
import type { MaterialId } from '../../Materials';
import type { PartDef, PartShapeDef } from '../../StructureDefinition';
import { MATERIALS, material } from '../../Materials';
import type { Random } from '../../../core/Random';

export const G = 12;

export interface LegBuild {
  hip: string;
  knee: string;
  thigh: string;
  shin: string;
  foot: string;
  /** The ankle muscle (only with `ankle`; otherwise the foot is welded on). */
  ankle: string;
}

/**
 * Thigh + shin + foot hanging from a hip point; returns part/joint ids. The
 * foot is welded to the shin, or with `ankle` hinged on an ankle muscle
 * (drive it with a gait term to tip the toe up while the foot is in the air).
 */
export function buildLeg(
  d: StructureDraft,
  side: string,
  hipX: number,
  hipY: number,
  o: { thigh: number; shin: number; w: number; mat: MaterialId; density: number; hipTorque: number; kneeTorque: number; hp?: number; footW?: number; omega?: number; strength?: number; ankle?: { torque: number; omega?: number } },
  body: string,
): LegBuild {
  const footH = 0.12;
  const kneeY = footH + o.shin;
  const ids = { thigh: `thigh${side}`, shin: `shin${side}`, foot: `foot${side}`, hip: `hip${side}`, knee: `knee${side}`, ankle: `ankle${side}` };
  // Far-side limbs (names ending in R) are drawn darker in the side view.
  const far = side.endsWith('R') ? ['back'] : [];
  d.box(hipX, kneeY + (hipY - kneeY) / 2, o.w, hipY - kneeY + 0.08, o.mat, { id: ids.thigh, densityScale: o.density, tags: ['limb', ...far], hpScale: o.hp });
  d.box(hipX, footH + o.shin / 2, o.w * 0.88, o.shin + 0.06, o.mat, { id: ids.shin, densityScale: o.density, tags: ['limb', ...far], hpScale: o.hp });
  d.box(hipX - 0.1, footH / 2, o.footW ?? 0.46, footH, o.mat, { id: ids.foot, densityScale: o.density, friction: 1.2, tags: ['limb', 'foot', ...far] });
  d.joints.push({ kind: 'muscle', id: ids.hip, a: body, b: ids.thigh, at: [hipX, hipY], seam: o.w, strength: o.strength ?? 2.5, muscle: { torque: o.hipTorque, min: -65, max: 80, omega: o.omega ?? 42 } });
  d.joints.push({ kind: 'muscle', id: ids.knee, a: ids.thigh, b: ids.shin, at: [hipX, kneeY], seam: o.w, strength: o.strength ?? 2.5, muscle: { torque: o.kneeTorque, min: -140, max: 6, omega: o.omega ?? 42 } });
  if (o.ankle) d.joints.push({ kind: 'muscle', id: ids.ankle, a: ids.shin, b: ids.foot, at: [hipX, footH], seam: o.w * 0.8, strength: 3, muscle: { torque: o.ankle.torque, min: -40, max: 70, omega: o.ankle.omega ?? 42 } });
  else d.weld(ids.foot, ids.shin, { at: [hipX, footH], seam: o.w * 0.8, strength: 3 });
  return ids;
}

export function walkerGait(amp: number): Record<string, MuscleGait> {
  return {
    hipL: { shape: 'sin', amp, bias: 0.04, phase: 0 },
    hipR: { shape: 'sin', amp, bias: 0.04, phase: 0.5 },
    kneeL: { shape: 'swing', amp: -0.95, bias: -0.06, phase: 0.25 },
    kneeR: { shape: 'swing', amp: -0.95, bias: -0.06, phase: 0.75 },
    shoulderL: { shape: 'sin', amp: 0.35, bias: 0, phase: 0.5 },
    shoulderR: { shape: 'sin', amp: 0.35, bias: 0, phase: 0 },
  };
}

/** Approximate mass of everything drafted so far (kg) — used to size muscles. */
export function draftMass(d: StructureDraft): number {
  let m = 0;
  for (const p of d.parts) {
    const s = p.shape;
    const area = s.kind === 'box' ? s.w * s.h : s.kind === 'circle' ? Math.PI * s.r * s.r : 0.1;
    const dens = { wood: 520, steel: 7000, armor: 5200, rubber: 1100, core: 1500, iron: 7800, concrete: 2100, glass: 2400, stone: 2500, explosive: 700, cable: 3000, ground: 0 }[p.material] ?? 1000;
    m += area * dens * (p.densityScale ?? 1);
  }
  return m;
}

/** Convex polygon from absolute (definition-space) points, counter-clockwise; placed at their centroid. */
export function polyAt(d: StructureDraft, pts: Array<[number, number]>, mat: MaterialId, o: PartOpts): number {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    cx += x / pts.length;
    cy += y / pts.length;
  }
  return d.poly(cx, cy, pts.map(([x, y]) => [x - cx, y - cy] as [number, number]), mat, o);
}

/** Mass of one drafted part (kg; kit's draftMass counts every polygon as 0.1 m², too rough for this body). */
export function partMass(d: StructureDraft, i: number): number {
  const p = d.parts[i]!;
  const s = p.shape;
  let area = 0;
  if (s.kind === 'box') area = s.w * s.h;
  else if (s.kind === 'circle') area = Math.PI * s.r * s.r;
  else {
    for (let k = 0; k < s.points.length; k++) {
      const [x0, y0] = s.points[k]!;
      const [x1, y1] = s.points[(k + 1) % s.points.length]!;
      area += (x0 * y1 - x1 * y0) / 2;
    }
    area = Math.abs(area);
  }
  return area * material(p.material).density * (p.densityScale ?? 1);
}

/** Mass of everything drafted so far (kg). */
export function bodyMass(d: StructureDraft): number {
  let m = 0;
  for (let i = 0; i < d.parts.length; i++) m += partMass(d, i);
  return m;
}

/** Centre of mass (x) of everything drafted so far. */
export function draftComX(d: StructureDraft): number {
  let m = 0;
  let mx = 0;
  for (let i = 0; i < d.parts.length; i++) {
    const pm = partMass(d, i);
    m += pm;
    mx += pm * d.parts[i]!.x;
  }
  return m > 0 ? mx / m : 0;
}

/** Make a wooden draft part steel that weighs what the wood did (a gait doesn't notice). */
export function steelInWood(p: PartDef): void {
  p.material = 'steel';
  p.densityScale = ((p.densityScale ?? 1) * MATERIALS.wood.density) / MATERIALS.steel.density;
}

/**
 * Swap a random `share` of a creature's wooden parts (at least one) for steel
 * that weighs what they did. Weak points still of wood move ahead of the
 * swapped ones, so gunners go for the wood first.
 */
export function swapWoodForSteel(d: StructureDraft, spec: CreatureSpec, share: number, rng: Random): void {
  const wood = d.parts.filter((p) => p.material === 'wood');
  if (!wood.length || share <= 0) return;
  const exact = wood.length * Math.min(1, share);
  const n = Math.max(1, Math.floor(exact) + (rng.next() < exact - Math.floor(exact) ? 1 : 0));
  for (let i = wood.length - 1; i > 0; i--) {
    const k = Math.floor(rng.next() * (i + 1));
    [wood[i], wood[k]] = [wood[k]!, wood[i]!];
  }
  const swapped = new Set<string>();
  for (const p of wood.slice(0, n)) {
    steelInWood(p);
    if (p.id) swapped.add(p.id);
  }
  if (spec.weakPoints) spec.weakPoints = [...spec.weakPoints.filter((w) => !swapped.has(w)), ...spec.weakPoints.filter((w) => swapped.has(w))];
}

/**
 * Uniformly scale a drafted creature by `s` (all creatures spawn at
 * CREATURE_SCALE). Geometry and anchors scale by s, so masses scale by s².
 * To behave like the same creature, just bigger: muscle torques scale by s³
 * (mass × lever arm) and joint strength by s (a joint's yield scales with its
 * seam, s or s², while its loads scale with s² or s³), so nothing that held at
 * size 1 snaps under its own weight. Part hit points grow only mildly. Strides and ability distances scale by
 * s (thrown shields by √s); walking speeds (m/s) stay as specified, so
 * level pacing is unchanged.
 */
export function scaleCreature(d: StructureDraft, spec: CreatureSpec, s: number): void {
  if (s === 1) return;
  for (const p of d.parts) {
    p.x *= s;
    p.y *= s;
    // Hit points would grow with part area (partMaxHp); let them grow only
    // mildly (×1.3 at 3.6× size), since bigger parts are also easier to hit.
    const a = shapeArea(p.shape);
    p.hpScale = (p.hpScale ?? 1) * ((0.35 + Math.sqrt(a)) / (0.35 + Math.sqrt(a * s * s))) * Math.pow(s, 0.205);
    const sh = p.shape;
    if (sh.kind === 'box') p.shape = { kind: 'box', w: sh.w * s, h: sh.h * s };
    else if (sh.kind === 'circle') p.shape = { kind: 'circle', r: sh.r * s };
    else p.shape = { kind: 'poly', points: sh.points.map(([x, y]) => [x * s, y * s] as const) };
  }
  for (const j of d.joints) {
    if (j.at) j.at = [j.at[0] * s, j.at[1] * s];
    if (j.anchorA) j.anchorA = [j.anchorA[0] * s, j.anchorA[1] * s];
    if (j.anchorB) j.anchorB = [j.anchorB[0] * s, j.anchorB[1] * s];
    if (j.length !== undefined) j.length *= s;
    if (j.seam !== undefined) j.seam *= s;
    j.strength = (j.strength ?? 1) * s;
    if (j.muscle) j.muscle = { ...j.muscle, torque: j.muscle.torque * s * s * s };
  }
  spec.gait.stride *= s;
  if (spec.crawl) spec.crawl.stride *= s;
  if (spec.float) spec.float.bob *= s;
  if (spec.fly) spec.fly.swoop *= s;
  for (const a of spec.abilities ?? []) {
    if (typeof a.ahead === 'number') a.ahead *= s;
    // Thrown shields grow less than the thrower: full-size ones become walls.
    if (typeof a.size === 'number') a.size *= Math.sqrt(s);
  }
}

function shapeArea(sh: PartShapeDef): number {
  if (sh.kind === 'box') return sh.w * sh.h;
  if (sh.kind === 'circle') return Math.PI * sh.r * sh.r;
  let a = 0;
  const pts = sh.points;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[(i + 1) % pts.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}
