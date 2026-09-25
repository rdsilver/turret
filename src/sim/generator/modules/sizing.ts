/**
 * Load-aware joint sizing ("the engineer sized the joints for the loads").
 *
 * Rapier contacts are slightly soft: under heavy loads a part sinks a few
 * millimetres into the one below and the weld between them (a spring in
 * parallel with the contact) picks up a share of the COMPRESSION plus some
 * locked-in lateral creep. With the current solver settings that share is
 * up to ~1.0-1.3 x the vertical load through the seam, so a slim column
 * under a heavy stack would sit at yield (or break) at rest.
 *
 * This pass runs a static load-down analysis on the draft (every part's
 * weight flows to the parts it rests on through horizontal seams, split by
 * seam overlap) and raises the strength of welds whose yield force is below
 * `factor x transmitted load`. Deliberately weak joints (strength < 1) keep
 * their relative weakness but never drop below the bare static demand.
 * Joints that carry no vertical load are untouched, so structures are still
 * exactly as weak as designed against the cannon.
 */
import { MATERIALS, combineBond, type MaterialId } from '../../Materials';
import type { PartDef } from '../../StructureDefinition';
import { DEFAULT_GRAVITY } from '../../../config/constants';
import type { StructureDraft } from '../StructureDraft';
import { partPolygon, signedArea } from './geom';

export interface SizingOpts {
  /** Required weld yield force / transmitted static load for ordinary joints. */
  factor: number;
  /** Floor for deliberately weakened joints (strength < 1), same units. */
  weakFactor: number;
  /**
   * Welds between a diagonal (rotated strut: brace, truss web) and an axis-aligned member:
   * required yield / static load carried by that member (lateral creep of loaded frames).
   */
  braceFactor: number;
  /**
   * Side-by-side seams (head joints between bricks, deck segments against a mast):
   * required yield / static load carried by the lighter of the two parts.
   */
  sideFactor: number;
  /** Seam tolerance (m). */
  tol?: number;
}

export const DEFAULT_SIZING: SizingOpts = { factor: 1.35, weakFactor: 1.05, braceFactor: 0.5, sideFactor: 0.6 };

export function partMass(p: PartDef): number {
  const s = p.shape;
  let area: number;
  if (s.kind === 'box') area = s.w * s.h;
  else if (s.kind === 'circle') area = Math.PI * s.r * s.r;
  else area = Math.abs(signedArea(partPolygon(p)));
  return area * MATERIALS[p.material].density * (p.densityScale ?? 1);
}

/** Returns the number of joints strengthened. */
export function sizeJoints(d: StructureDraft, o: SizingOpts = DEFAULT_SIZING): number {
  const tol = o.tol ?? 0.03;
  const n = d.parts.length;
  if (n === 0) return 0;
  const g = DEFAULT_GRAVITY;
  const b = d.parts.map((_, i) => d.bounds(i));
  const load = d.parts.map((p) => partMass(p) * g);
  // Parts hanging on cables / hinges below their holder load the holder.
  for (const j of d.joints) {
    if (j.kind === 'weld' || j.b === 'ground') continue;
    const a = resolve(d, j.a);
    const h = resolve(d, j.b);
    if (a < 0 || h < 0) continue;
    const [lo, hi] = b[a]!.maxY <= b[h]!.minY + tol ? [a, h] : b[h]!.maxY <= b[a]!.minY + tol ? [h, a] : [-1, -1];
    if (lo >= 0) load[hi]! += partMass(d.parts[lo]!) * g;
  }
  // Supports: parts directly below with a horizontal contact seam (x overlap > tol).
  const order = d.parts.map((_, i) => i).sort((i, k) => b[k]!.minY - b[i]!.minY);
  /** transmitted[key(a,b)] = static load (N) from upper a into lower b (b = -1: ground). */
  const transmitted = new Map<number, number>();
  const key = (a: number, bb: number) => a * 100003 + (bb + 1);
  // Weld adjacency: parts carried only through welds (truss chords on webs, braces) pass
  // their load to the welded neighbours below them.
  const welded: number[][] = d.parts.map(() => []);
  for (const j of d.joints) {
    if (j.kind !== 'weld' || j.b === 'ground') continue;
    const a = resolve(d, j.a);
    const c = resolve(d, j.b);
    if (a >= 0 && c >= 0) {
      welded[a]!.push(c);
      welded[c]!.push(a);
    }
  }
  for (const u of order) {
    const U = b[u]!;
    if (d.parts[u]!.fixed) continue;
    const sup: { i: number; w: number }[] = [];
    if (Math.abs(U.minY) <= tol) sup.push({ i: -1, w: U.maxX - U.minX });
    else {
      for (let l = 0; l < n; l++) {
        if (l === u) continue;
        const L = b[l]!;
        if (Math.abs(L.maxY - U.minY) > tol) continue;
        const ox = Math.min(U.maxX, L.maxX) - Math.max(U.minX, L.minX);
        if (ox > tol) sup.push({ i: l, w: ox });
      }
    }
    if (sup.length === 0) {
      for (const l of welded[u]!) if (b[l]!.minY < U.minY - 0.01) sup.push({ i: l, w: 1 });
    }
    if (sup.length === 0) continue;
    let total = 0;
    for (const s of sup) total += s.w;
    for (const s of sup) {
      const share = (load[u]! * s.w) / total;
      transmitted.set(key(u, s.i), share);
      if (s.i >= 0) load[s.i]! += share;
    }
  }
  let changed = 0;
  for (const j of d.joints) {
    if (j.kind !== 'weld') continue;
    const a = resolve(d, j.a);
    const bb = j.b === 'ground' ? -1 : resolve(d, j.b);
    if (a < 0 || (bb < 0 && j.b !== 'ground')) continue;
    const Tv = transmitted.get(key(a, bb)) ?? (bb >= 0 ? transmitted.get(key(bb, a)) : undefined) ?? 0;
    // Demand as a force (N): the static load through the seam x factor ...
    let demand = Tv * o.factor;
    if (bb >= 0) {
      // ... or, for a diagonal tied into a loaded member, a fraction of that member's load
      // (lateral creep of loaded frames is resisted by the braces).
      const ra = isRotated(d.parts[a]!);
      const rb = isRotated(d.parts[bb]!);
      if (ra !== rb) {
        const member = ra ? bb : a;
        demand = Math.max(demand, (load[member]! - partMass(d.parts[member]!) * g) * o.braceFactor);
      } else if (!ra && !rb && Tv === 0) {
        const A = b[a]!;
        const B = b[bb]!;
        const oy = Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY);
        const ox = Math.min(A.maxX, B.maxX) - Math.max(A.minX, B.minX);
        if (oy > tol && Math.abs(ox) <= tol) demand = Math.max(demand, Math.min(load[a]!, load[bb]!) * o.sideFactor);
      }
    }
    const T = demand / o.factor;
    if (!T || T <= 0) continue;
    const seam = j.seam;
    if (!seam || seam <= 0) continue;
    const tension = bondTension(d.parts[a]!.material, bb >= 0 ? d.parts[bb]!.material : 'ground', j.bond);
    const cap = tension * seam; // yield force at strength 1
    const s = j.strength ?? 1;
    const m = demand / cap;
    const mWeak = (o.weakFactor * T) / cap;
    const next = s >= 1 ? Math.max(s, m) : Math.max(s, s * Math.max(1, m), mWeak);
    if (next > s * 1.0001) {
      j.strength = +next.toFixed(3);
      changed++;
    }
  }
  return changed;
}

function isRotated(p: PartDef): boolean {
  if (p.shape.kind !== 'box') return false;
  const a = (((p.angle ?? 0) % 90) + 90) % 90;
  return a > 0.01 && a < 89.99;
}

function resolve(d: StructureDraft, ref: number | string): number {
  if (typeof ref === 'number') return ref;
  return d.parts.findIndex((p) => p.id === ref);
}

function bondTension(a: MaterialId, b: MaterialId, bond?: MaterialId): number {
  if (bond) return MATERIALS[bond].bond.tension;
  return combineBond(MATERIALS[a].bond, MATERIALS[b].bond).tension;
}
