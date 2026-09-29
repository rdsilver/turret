/**
 * Chipped geometry (IMPACT_DAMAGE 'chips'). A part hit by a round is cut into
 * a mesh of jittered triangles in its local frame (metres, y down, like its
 * collider), and rounds knock triangles out where they strike, from the
 * outside in: only a triangle on the silhouette (or next to one already
 * gone) can go, and never one whose loss would cut the rest in two (a part
 * still in one piece in the physics stays in one piece). How many are gone
 * follows the part's wear (CHIP_SHARE of them by the time it breaks).
 *
 * It is real geometry for rounds: once a part has lost a triangle, rounds
 * pass through what is gone and strike what is left (ProjectileSystem sweeps
 * them against the intact triangles instead of the collider). Everything
 * else (walking, the ground, other bodies) still meets the collider.
 * Deterministic: each part's mesh is seeded from its body handle, never from
 * the sim's shared random stream. The view paints from it (PartCraters).
 */
import type { PartShape, StructurePart } from './StructurePart';
import { Random } from '../core/Random';

export interface ChipMesh {
  /** Corners (part-local m): six numbers per triangle. */
  pts: Float32Array;
  /** Centroids (part-local m). */
  cx: Float32Array;
  cy: Float32Array;
  /** Neighbour across each side (-1: the mesh's border); side k runs from corner k to corner k + 1. */
  nb: Int32Array;
  /** 0 intact, 1 chipped away, 2 outside the part (never there, never chipped). */
  state: Uint8Array;
  /** Triangles inside the part, and how many of them are gone. */
  inside: number;
  chipped: number;
  /** Typical triangle size (m). */
  size: number;
  /**
   * Only one triangle thick somewhere (no intact triangle has three intact
   * neighbours): such a strip could only ever lose its two ends, far from
   * where rounds strike, so it is never chipped.
   */
  chain: boolean;
}

/** Share of a part's triangles gone by the time it breaks. */
export const CHIP_SHARE = 0.44;
/** Triangle size (m): about ACROSS of them across the part's thinner side, within these bounds. */
const ACROSS = 3;
const MIN_CHIP = 0.2;
const MAX_CHIP = 0.5;
/**
 * Inner corners are jittered this share of a cell (a regular grid reads as
 * tiles, not shards); under a quarter no triangle can turn inside out.
 */
const JITTER = 0.24;
/** Parts bigger than this (m, longer half-extent) are never chipped (the view could not draw their holes). */
export const MAX_CHIP_EXTENT = 7;

/** Mesh a part (seeded, so the same part always gets the same mesh). */
export function buildChipMesh(shape: PartShape, seed: number): ChipMesh {
  const rng = new Random(seed);
  const dist = (x: number, y: number) => signedDistance(shape, x, y);
  const b = bounds(shape);
  const bw = b.x1 - b.x0;
  const bh = b.y1 - b.y0;
  const cell = Math.max(MIN_CHIP, Math.min(MAX_CHIP, Math.min(bw, bh) / ACROSS));
  const cols = Math.max(1, Math.round(bw / cell));
  const rows = Math.max(1, Math.round(bh / cell));
  const cw = bw / cols;
  const ch = bh / rows;
  const stride = cols + 1;
  const vx = new Float32Array(stride * (rows + 1));
  const vy = new Float32Array(stride * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const inner = i > 0 && i < cols && j > 0 && j < rows;
      vx[j * stride + i] = b.x0 + i * cw + (inner ? (rng.next() - 0.5) * 2 * JITTER * cw : 0);
      vy[j * stride + i] = b.y0 + j * ch + (inner ? (rng.next() - 0.5) * 2 * JITTER * ch : 0);
    }
  }
  const n = cols * rows * 2;
  const corner = new Int32Array(n * 3);
  let t = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v00 = j * stride + i;
      const v10 = v00 + 1;
      const v01 = v00 + stride;
      const v11 = v01 + 1;
      // Each cell splits along a random diagonal.
      const quad = rng.next() < 0.5 ? [v00, v10, v11, v00, v11, v01] : [v00, v10, v01, v10, v11, v01];
      for (let k = 0; k < 6; k++) corner[t * 3 + k] = quad[k]!;
      t += 2;
    }
  }
  // Neighbours: the triangle on the other side of each shared side.
  const nb = new Int32Array(n * 3).fill(-1);
  const sides = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const a = corner[i * 3 + k]!;
      const c = corner[i * 3 + ((k + 1) % 3)]!;
      const key = Math.min(a, c) * 0x10000 + Math.max(a, c);
      const other = sides.get(key);
      if (other === undefined) sides.set(key, i * 3 + k);
      else {
        nb[i * 3 + k] = (other / 3) | 0;
        nb[other] = i;
      }
    }
  }
  const pts = new Float32Array(n * 6);
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  const state = new Uint8Array(n);
  let inside = 0;
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < 3; k++) {
      const v = corner[i * 3 + k]!;
      sx += vx[v]! / 3;
      sy += vy[v]! / 3;
      pts[i * 6 + k * 2] = vx[v]!;
      pts[i * 6 + k * 2 + 1] = vy[v]!;
    }
    // Any of it inside the part counts (no slivers left out at a slanted or round side:
    // rounds would pass through art still drawn there).
    if (overlaps(shape, pts, i)) inside++;
    else state[i] = 2;
    cx[i] = sx;
    cy[i] = sy;
  }
  let chain = inside > 0;
  for (let i = 0; i < n && chain; i++) {
    if (state[i] !== 0) continue;
    let links = 0;
    for (let k = 0; k < 3; k++) {
      const o = nb[i * 3 + k]!;
      if (o >= 0 && state[o] === 0) links++;
    }
    if (links === 3) chain = false;
  }
  void dist;
  return { pts, cx, cy, nb, state, inside, chipped: 0, size: Math.min(cw, ch), chain };
}

/** Does triangle i of `pts` overlap the shape (a separating-axis test; touching doesn't count)? */
function overlaps(shape: PartShape, pts: Float32Array, i: number): boolean {
  const o = i * 6;
  if (shape.kind === 'circle') {
    const r2 = shape.r * shape.r;
    for (let k = 0; k < 3; k++) {
      const ax = pts[o + k * 2]!;
      const ay = pts[o + k * 2 + 1]!;
      const bx = pts[o + ((k + 1) % 3) * 2]!;
      const by = pts[o + ((k + 1) % 3) * 2 + 1]!;
      // Nearest point of the side to the centre.
      const ex = bx - ax;
      const ey = by - ay;
      const l2 = ex * ex + ey * ey;
      const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * ex + ay * ey) / l2)) : 0;
      const qx = ax + ex * t;
      const qy = ay + ey * t;
      if (qx * qx + qy * qy < r2 - 1e-9) return true;
    }
    // The centre inside the triangle (a disc bigger than it).
    let sign = 0;
    for (let k = 0; k < 3; k++) {
      const ax = pts[o + k * 2]!;
      const ay = pts[o + k * 2 + 1]!;
      const bx = pts[o + ((k + 1) % 3) * 2]!;
      const by = pts[o + ((k + 1) % 3) * 2 + 1]!;
      const c = (bx - ax) * -ay - (by - ay) * -ax;
      if (c === 0) continue;
      if (sign === 0) sign = Math.sign(c);
      else if (Math.sign(c) !== sign) return false;
    }
    return true;
  }
  const poly = shape.kind === 'box' ? [-shape.hw, -shape.hh, shape.hw, -shape.hh, shape.hw, shape.hh, -shape.hw, shape.hh] : shape.points;
  const tri = [pts[o]!, pts[o + 1]!, pts[o + 2]!, pts[o + 3]!, pts[o + 4]!, pts[o + 5]!];
  for (const src of [poly, tri]) {
    const n = src.length / 2;
    for (let k = 0; k < n; k++) {
      const ex = src[((k + 1) % n) * 2]! - src[k * 2]!;
      const ey = src[((k + 1) % n) * 2 + 1]! - src[k * 2 + 1]!;
      // Axis: the side's normal; project both shapes on it.
      const ax = -ey;
      const ay = ex;
      let pMin = Infinity;
      let pMax = -Infinity;
      for (let j = 0; j < poly.length; j += 2) {
        const d = poly[j]! * ax + poly[j + 1]! * ay;
        pMin = Math.min(pMin, d);
        pMax = Math.max(pMax, d);
      }
      let tMin = Infinity;
      let tMax = -Infinity;
      for (let j = 0; j < 6; j += 2) {
        const d = tri[j]! * ax + tri[j + 1]! * ay;
        tMin = Math.min(tMin, d);
        tMax = Math.max(tMax, d);
      }
      const eps = 1e-6 * Math.hypot(ax, ay);
      if (tMax <= pMin + eps || pMax <= tMin + eps) return false;
    }
  }
  return true;
}

/** How many triangles should be gone at this integrity. */
export function chipTarget(m: ChipMesh, integrity: number): number {
  return Math.round(m.inside * CHIP_SHARE * (1 - Math.max(0, Math.min(1, integrity))));
}

/**
 * Knock out the intact triangle nearest local point (px, py) that is open to
 * the outside and whose loss leaves the rest in one piece; its index, or -1
 * if none is.
 */
export function chipAt(m: ChipMesh, px: number, py: number): number {
  let best = -1;
  for (let tries = 0; tries < m.state.length; tries++) {
    best = -1;
    let bestD = Infinity;
    for (let i = 0; i < m.state.length; i++) {
      if (m.state[i] !== 0) continue;
      const d = (m.cx[i]! - px) ** 2 + (m.cy[i]! - py) ** 2;
      if (d >= bestD || !open(m, i)) continue;
      best = i;
      bestD = d;
    }
    if (best < 0 || !splits(m, best)) break;
    // Holding the two sides together: passed over for this chip (marked so the search skips it).
    m.state[best] = 3;
  }
  for (let i = 0; i < m.state.length; i++) if (m.state[i] === 3) m.state[i] = 0;
  if (best < 0 || splits(m, best)) return -1;
  m.state[best] = 1;
  m.chipped++;
  return best;
}

/** Where a local segment first meets the intact triangles. */
export interface ChipHit {
  /** Parameter along the segment (0..1). */
  t: number;
  /** Outward normal (local) of the side it came in through (0, 0 if it starts inside one). */
  nx: number;
  ny: number;
}

/**
 * First moment a disc of radius `radius` moving along the local segment
 * (ax, ay) -> (bx, by) touches an intact triangle (its centre within
 * `radius` of one, within the part's outline grown by `radius`), or null if
 * it only crosses what is gone (and the outside). Every side is pushed out
 * by the radius, which slightly overreaches at corners.
 */
export function sweepChips(m: ChipMesh, shape: PartShape, ax: number, ay: number, bx: number, by: number, radius: number, out: ChipHit): ChipHit | null {
  const dx = bx - ax;
  const dy = by - ay;
  // Only within the part's own outline (edge triangles stick out past a slanted or round side).
  if (!clipShape(shape, ax, ay, dx, dy, CLIP, radius)) return null;
  const s0 = CLIP.t0;
  const s1 = CLIP.t1;
  let bestT = Infinity;
  const p = m.pts;
  for (let i = 0; i < m.state.length; i++) {
    if (m.state[i] !== 0) continue;
    // Clip the segment to the triangle (Cyrus-Beck): each side keeps the half containing the centroid.
    let t0 = s0;
    let t1 = s1;
    let nx = s0 > 0 ? CLIP.nx : 0;
    let ny = s0 > 0 ? CLIP.ny : 0;
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      const x0 = p[i * 6 + k * 2]!;
      const y0 = p[i * 6 + k * 2 + 1]!;
      const k2 = (k + 1) % 3;
      const ex = p[i * 6 + k2 * 2]! - x0;
      const ey = p[i * 6 + k2 * 2 + 1]! - y0;
      // A normal of the side, turned to point out of the triangle.
      let ox = ey;
      let oy = -ex;
      if (ox * (m.cx[i]! - x0) + oy * (m.cy[i]! - y0) > 0) {
        ox = -ox;
        oy = -oy;
      }
      // Outside this side (grown by the radius) where (q - v0) . o > radius * |o|.
      const num = ox * (ax - x0) + oy * (ay - y0) - radius * Math.hypot(ox, oy);
      const den = ox * dx + oy * dy;
      if (den === 0) {
        if (num > 0) ok = false;
      } else {
        const tt = -num / den;
        if (den < 0) {
          // Entering across this side.
          if (tt > t0) {
            t0 = tt;
            nx = ox;
            ny = oy;
          }
        } else if (tt < t1) t1 = tt;
      }
      if (t0 > t1) ok = false;
    }
    if (!ok || t0 >= bestT) continue;
    bestT = t0;
    const l = Math.hypot(nx, ny) || 1;
    out.nx = nx / l;
    out.ny = ny / l;
  }
  if (bestT === Infinity) return null;
  out.t = bestT;
  if (bestT === 0) {
    out.nx = 0;
    out.ny = 0;
  }
  return out;
}

/**
 * Where to aim at a part so the round meets something (gunners: the top
 * turret, the lab bots): world point `(x, y)` if the part is solid there
 * (inside its outline and an intact triangle), else the middle of the
 * nearest intact triangle that lies inside the outline. Returns `out`.
 */
export function aimPoint(part: StructurePart, x: number, y: number, out: { x: number; y: number }): { x: number; y: number } {
  out.x = x;
  out.y = y;
  const m = part.chips;
  if (!m || m.chipped === 0) return out;
  const c = Math.cos(part.angle);
  const s = Math.sin(part.angle);
  const dx = x - part.x;
  const dy = y - part.y;
  const lx = c * dx + s * dy;
  const ly = -s * dx + c * dy;
  if (signedDistance(part.shape, lx, ly) < 0 && stateAt(m, lx, ly) === 0) return out;
  let best = -1;
  let bestD = Infinity;
  let any = -1;
  let anyD = Infinity;
  for (let i = 0; i < m.state.length; i++) {
    if (m.state[i] !== 0) continue;
    const d = (m.cx[i]! - lx) ** 2 + (m.cy[i]! - ly) ** 2;
    if (d < anyD) {
      anyD = d;
      any = i;
    }
    if (d < bestD && signedDistance(part.shape, m.cx[i]!, m.cy[i]!) < 0) {
      bestD = d;
      best = i;
    }
  }
  const i = best >= 0 ? best : any;
  if (i < 0) return out;
  out.x = part.x + c * m.cx[i]! - s * m.cy[i]!;
  out.y = part.y + s * m.cx[i]! + c * m.cy[i]!;
  return out;
}

/** State of the triangle containing local point (lx, ly) (0 intact, 1 chipped, 2 outside), or -1 if none does. */
export function stateAt(m: ChipMesh, lx: number, ly: number): number {
  const p = m.pts;
  for (let i = 0; i < m.state.length; i++) {
    let sign = 0;
    let inTri = true;
    for (let k = 0; k < 3 && inTri; k++) {
      const ax = p[i * 6 + k * 2]!;
      const ay = p[i * 6 + k * 2 + 1]!;
      const bx = p[i * 6 + ((k + 1) % 3) * 2]!;
      const by = p[i * 6 + ((k + 1) % 3) * 2 + 1]!;
      const cr = (bx - ax) * (ly - ay) - (by - ay) * (lx - ax);
      if (cr === 0) continue;
      if (sign === 0) sign = Math.sign(cr);
      else if (Math.sign(cr) !== sign) inTri = false;
    }
    if (inTri) return m.state[i]!;
  }
  return -1;
}

/** Signed distance (m, < 0 inside) from a local point to the shape's outline. */
export function signedDistance(shape: PartShape, x: number, y: number): number {
  if (shape.kind === 'box') {
    const qx = Math.abs(x) - shape.hw;
    const qy = Math.abs(y) - shape.hh;
    return qx > 0 || qy > 0 ? Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) : Math.max(qx, qy);
  }
  if (shape.kind === 'circle') return Math.hypot(x, y) - shape.r;
  // Convex polygon: the largest signed distance to its sides' lines.
  const p = shape.points;
  const n = p.length;
  let area2 = 0;
  for (let i = 0; i < n; i += 2) area2 += p[i]! * p[(i + 3) % n]! - p[(i + 2) % n]! * p[i + 1]!;
  const wind = area2 > 0 ? 1 : -1;
  let best = -Infinity;
  for (let i = 0; i < n; i += 2) {
    const ex = p[(i + 2) % n]! - p[i]!;
    const ey = p[(i + 3) % n]! - p[i + 1]!;
    const len = Math.hypot(ex, ey) || 1;
    best = Math.max(best, ((x - p[i]!) * wind * ey - (y - p[i + 1]!) * wind * ex) / len);
  }
  return best;
}

const CLIP = { t0: 0, t1: 1, nx: 0, ny: 0 };

/**
 * Clip the local segment a + t (dx, dy), t in [0, 1], to the shape: `out`
 * gets the span inside it and the outward normal where it enters. False if
 * it misses.
 */
function clipShape(shape: PartShape, ax: number, ay: number, dx: number, dy: number, out: { t0: number; t1: number; nx: number; ny: number }, pad = 0): boolean {
  out.t0 = 0;
  out.t1 = 1;
  out.nx = 0;
  out.ny = 0;
  if (shape.kind === 'circle') {
    const a = dx * dx + dy * dy;
    const b = ax * dx + ay * dy;
    const R = shape.r + pad;
    const c = ax * ax + ay * ay - R * R;
    const disc = b * b - a * c;
    if (a === 0 || disc < 0) return c <= 0;
    const r = Math.sqrt(disc);
    const e = (-b - r) / a;
    const x = (-b + r) / a;
    if (x < 0 || e > 1) return false;
    if (e > 0) {
      out.t0 = e;
      const l = R || 1;
      out.nx = (ax + dx * e) / l;
      out.ny = (ay + dy * e) / l;
    }
    out.t1 = Math.min(1, x);
    return true;
  }
  // Box or convex polygon: Cyrus-Beck against its sides.
  const sides = shape.kind === 'box' ? BOX_SIDES : null;
  const n = sides ? 4 : shape.kind === 'poly' ? shape.points.length / 2 : 0;
  let wind = 1;
  if (!sides && shape.kind === 'poly') {
    const p = shape.points;
    let area2 = 0;
    for (let i = 0; i < p.length; i += 2) area2 += p[i]! * p[(i + 3) % p.length]! - p[(i + 2) % p.length]! * p[i + 1]!;
    wind = area2 > 0 ? 1 : -1;
  }
  for (let k = 0; k < n; k++) {
    let ox: number;
    let oy: number;
    let d: number;
    if (sides) {
      ox = sides[k * 2]!;
      oy = sides[k * 2 + 1]!;
      d = (ox !== 0 ? (shape as { hw: number }).hw : (shape as { hh: number }).hh) + pad;
    } else {
      const p = (shape as { points: number[] }).points;
      const x0 = p[k * 2]!;
      const y0 = p[k * 2 + 1]!;
      const ex = p[((k + 1) % n) * 2]! - x0;
      const ey = p[((k + 1) % n) * 2 + 1]! - y0;
      const l = Math.hypot(ex, ey) || 1;
      ox = (wind * ey) / l;
      oy = (-wind * ex) / l;
      d = ox * x0 + oy * y0 + pad;
    }
    // Inside where q . o <= d.
    const num = ox * ax + oy * ay - d;
    const den = ox * dx + oy * dy;
    if (den === 0) {
      if (num > 0) return false;
      continue;
    }
    const t = -num / den;
    if (den < 0) {
      if (t > out.t0) {
        out.t0 = t;
        out.nx = ox;
        out.ny = oy;
      }
    } else if (t < out.t1) out.t1 = t;
    if (out.t0 > out.t1) return false;
  }
  return true;
}

const BOX_SIDES = [1, 0, -1, 0, 0, 1, 0, -1];

/** On the silhouette, or next to a triangle already gone. */
function open(m: ChipMesh, i: number): boolean {
  for (let k = 0; k < 3; k++) {
    const o = m.nb[i * 3 + k]!;
    if (o < 0 || m.state[o] === 1 || m.state[o] === 2) return true;
  }
  return false;
}

let queue = new Int32Array(256);
let seen = new Int32Array(256);
let stamp = 0;

/**
 * Would losing intact triangle i cut the intact triangles around it apart?
 * (Its intact neighbours must still reach each other without it: counted
 * locally, so a mesh that starts in more than one piece is judged right.)
 */
function splits(m: ChipMesh, i: number): boolean {
  let n0 = -1;
  let n1 = -1;
  let n2 = -1;
  let links = 0;
  for (let k = 0; k < 3; k++) {
    const o = m.nb[i * 3 + k]!;
    if (o < 0 || m.state[o] === 1 || m.state[o] === 2) continue;
    if (links === 0) n0 = o;
    else if (links === 1) n1 = o;
    else n2 = o;
    links++;
  }
  // An end (one intact neighbour, or none) can always go.
  if (links < 2) return false;
  if (queue.length < m.state.length) queue = new Int32Array(m.state.length);
  if (seen.length < m.state.length) {
    seen = new Int32Array(m.state.length);
    stamp = 0;
  }
  const mark = ++stamp;
  seen[i] = mark;
  seen[n0] = mark;
  queue[0] = n0;
  let head = 0;
  let tail = 1;
  let missing = links - 1;
  while (head < tail) {
    const t = queue[head++]!;
    for (let k = 0; k < 3; k++) {
      const o = m.nb[t * 3 + k]!;
      if (o < 0 || seen[o] === mark || m.state[o] === 1 || m.state[o] === 2) continue;
      seen[o] = mark;
      if (o === n1 || o === n2) {
        if (--missing === 0) return false;
      }
      queue[tail++] = o;
    }
  }
  return true;
}

/** The shape's bounding box in its local frame (m). */
function bounds(shape: PartShape): { x0: number; y0: number; x1: number; y1: number } {
  if (shape.kind === 'box') return { x0: -shape.hw, y0: -shape.hh, x1: shape.hw, y1: shape.hh };
  if (shape.kind === 'circle') return { x0: -shape.r, y0: -shape.r, x1: shape.r, y1: shape.r };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const q = shape.points;
  for (let i = 0; i < q.length; i += 2) {
    x0 = Math.min(x0, q[i]!);
    x1 = Math.max(x1, q[i]!);
    y0 = Math.min(y0, q[i + 1]!);
    y1 = Math.max(y1, q[i + 1]!);
  }
  return { x0, y0, x1, y1 };
}
