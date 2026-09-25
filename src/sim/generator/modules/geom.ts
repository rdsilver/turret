/**
 * Small convex-geometry helpers for the structure generator (DEFINITION
 * space: y up, degrees CCW). Pure functions, no physics, no allocations
 * worth worrying about (generation runs once per level).
 */
import type { PartDef } from '../../StructureDefinition';

export type Pt = [number, number];

const DEG = Math.PI / 180;

/** World-space (definition space) convex outline of a part, counter-clockwise. */
export function partPolygon(p: PartDef, circleSegments = 12): Pt[] {
  const a = (p.angle ?? 0) * DEG;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out: Pt[] = [];
  const push = (lx: number, ly: number) => out.push([p.x + c * lx - s * ly, p.y + s * lx + c * ly]);
  const sh = p.shape;
  if (sh.kind === 'box') {
    const hw = sh.w / 2;
    const hh = sh.h / 2;
    push(-hw, -hh);
    push(hw, -hh);
    push(hw, hh);
    push(-hw, hh);
  } else if (sh.kind === 'circle') {
    for (let i = 0; i < circleSegments; i++) {
      const t = (i / circleSegments) * Math.PI * 2;
      push(Math.cos(t) * sh.r, Math.sin(t) * sh.r);
    }
  } else {
    for (const q of sh.points) push(q[0], q[1]);
    if (signedArea(out) < 0) out.reverse();
  }
  return out;
}

export function signedArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function centroidOf(poly: readonly Pt[]): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const cr = p[0] * q[1] - q[0] * p[1];
    a += cr;
    cx += (p[0] + q[0]) * cr;
    cy += (p[1] + q[1]) * cr;
  }
  if (Math.abs(a) < 1e-12) {
    // Degenerate: average of vertices.
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / Math.max(1, poly.length), sy / Math.max(1, poly.length)];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/** Sutherland–Hodgman: intersection of a convex subject with a convex CCW clip polygon. */
export function clipConvex(subject: readonly Pt[], clip: readonly Pt[]): Pt[] {
  let out: Pt[] = subject.slice();
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const input = out;
    out = [];
    const side = (p: Pt) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    for (let k = 0; k < input.length; k++) {
      const p = input[k]!;
      const q = input[(k + 1) % input.length]!;
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

/** Overlap region of two parts (area m^2 + centroid), or null if they don't overlap. */
export function overlapRegion(a: PartDef, b: PartDef): { area: number; x: number; y: number; poly: Pt[] } | null {
  const pa = partPolygon(a);
  const pb = partPolygon(b);
  const poly = clipConvex(pa, pb);
  if (poly.length < 3) return null;
  const area = Math.abs(signedArea(poly));
  if (area < 1e-6) return null;
  const [x, y] = centroidOf(poly);
  return { area, x, y, poly };
}

/**
 * Separating-axis distance between two parts' outlines: > 0 = gap along the
 * best separating axis (a lower bound of the true distance), < 0 = penetration
 * depth (minimum translation distance).
 */
export function separation(a: PartDef, b: PartDef): number {
  const pa = partPolygon(a);
  const pb = partPolygon(b);
  let best = -Infinity;
  const test = (poly: readonly Pt[]) => {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      let nx = q[1] - p[1];
      let ny = -(q[0] - p[0]);
      const len = Math.hypot(nx, ny);
      if (len < 1e-9) continue;
      nx /= len;
      ny /= len;
      let minA = Infinity;
      let maxA = -Infinity;
      for (const v of pa) {
        const d = v[0] * nx + v[1] * ny;
        if (d < minA) minA = d;
        if (d > maxA) maxA = d;
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of pb) {
        const d = v[0] * nx + v[1] * ny;
        if (d < minB) minB = d;
        if (d > maxB) maxB = d;
      }
      const gap = Math.max(minB - maxA, minA - maxB);
      if (gap > best) best = gap;
    }
  };
  test(pa);
  test(pb);
  return best;
}

/** Is (x, y) inside the part outline (grown by `pad` m)? */
export function pointInPart(p: PartDef, x: number, y: number, pad = 0): boolean {
  const poly = partPolygon(p);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    // Signed distance to the edge line, positive inside for CCW polygons.
    const d = (ex * (y - a[1]) - ey * (x - a[0])) / len;
    if (d < -pad) return false;
  }
  return true;
}
