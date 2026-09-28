/**
 * Triangle-chip impact damage (IMPACT_DAMAGE 'chips'). A part's art is cut
 * into a mesh of jittered triangles, in the texels of its frame; hits knock
 * triangles out of it where the round struck, from the outside in: only a
 * triangle on the silhouette (or next to one already gone) can go. How many
 * are gone follows the part's wear, so a part about to break is chewed well
 * into, and each lost triangle flies off as a shard (PartCraters.onChip).
 * Purely visual: the part's collider keeps its shape.
 *
 * Painting: the chipped triangles are cut out of the art (destination-out),
 * then every side where a chipped triangle meets an intact one gets the
 * fresh-edge band and the outline, drawn 'source-atop' so only the surviving
 * art takes paint (the half of each stroke over the hole paints nothing).
 * A later chip next to it cuts that stroke away again with its own area.
 */
import type { PartShape } from '../../sim/StructurePart';
import type { CraterGeom, CraterStyle } from './CraterPainter';

export interface ChipMesh {
  /** Corners (texels, frame space): six numbers per triangle. */
  pts: Float32Array;
  /** Centroids (texels). */
  cx: Float32Array;
  cy: Float32Array;
  /** Neighbour across each side (-1: the mesh's border); side k runs from corner k to corner k + 1. */
  nb: Int32Array;
  /** 0 intact, 1 chipped away, 2 outside the part (never drawn, never chipped). */
  state: Uint8Array;
  /** Triangles inside the part, and how many of them are gone. */
  inside: number;
  chipped: number;
  /** Chipped since the last paint. */
  fresh: number[];
  /** Typical triangle size (texels). */
  size: number;
}

/** Triangle size (m): about ACROSS of them across the part's thinner side, within these bounds. */
const ACROSS = 3;
const MIN_CHIP = 0.2;
const MAX_CHIP = 0.5;
/** Inner corners are jittered this share of a cell (a regular grid reads as tiles, not shards). */
const JITTER = 0.32;

/**
 * Mesh a part: `dist` is the signed distance (m, < 0 inside) of a local point
 * to its silhouette; (ox, oy) the body origin in its frame (texels); S texels
 * per metre.
 */
export function buildChipMesh(shape: PartShape, dist: (x: number, y: number) => number, ox: number, oy: number, S: number, rand: () => number): ChipMesh {
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
      vx[j * stride + i] = b.x0 + i * cw + (inner ? (rand() - 0.5) * 2 * JITTER * cw : 0);
      vy[j * stride + i] = b.y0 + j * ch + (inner ? (rand() - 0.5) * 2 * JITTER * ch : 0);
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
      const quad = rand() < 0.5 ? [v00, v10, v11, v00, v11, v01] : [v00, v10, v01, v10, v11, v01];
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
    let any = false;
    for (let k = 0; k < 3; k++) {
      const v = corner[i * 3 + k]!;
      sx += vx[v]! / 3;
      sy += vy[v]! / 3;
      if (dist(vx[v]!, vy[v]!) < 0) any = true;
      pts[i * 6 + k * 2] = ox + vx[v]! * S;
      pts[i * 6 + k * 2 + 1] = oy + vy[v]! * S;
    }
    // Any of it inside the part counts (no slivers left behind at a slanted edge).
    if (any || dist(sx, sy) < 0) inside++;
    else state[i] = 2;
    cx[i] = ox + sx * S;
    cy[i] = oy + sy * S;
  }
  return { pts, cx, cy, nb, state, inside, chipped: 0, fresh: [], size: Math.min(cw, ch) * S };
}

/** Knock out the intact triangle nearest (px, py) that is open to the outside; its index, or -1 if none is left. */
export function chipAt(m: ChipMesh, px: number, py: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < m.state.length; i++) {
    if (m.state[i] !== 0) continue;
    const d = (m.cx[i]! - px) ** 2 + (m.cy[i]! - py) ** 2;
    if (d >= bestD || !open(m, i)) continue;
    best = i;
    bestD = d;
  }
  if (best < 0) return -1;
  m.state[best] = 1;
  m.chipped++;
  m.fresh.push(best);
  return best;
}

/** Cut chipped triangles out of the art (`which`: those, or null for every one) and outline what they leave. */
export function paintChips(ctx: CanvasRenderingContext2D, m: ChipMesh, which: readonly number[] | null, st: CraterStyle, g: CraterGeom): void {
  const list: number[] = [];
  if (which) list.push(...which);
  else for (let i = 0; i < m.state.length; i++) if (m.state[i] === 1) list.push(i);
  if (!list.length) return;
  const p = m.pts;
  ctx.save();
  // 1. The holes (a hairline stroke too, so neighbouring chips leave no seam between them).
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (const i of list) {
    ctx.moveTo(p[i * 6]!, p[i * 6 + 1]!);
    ctx.lineTo(p[i * 6 + 2]!, p[i * 6 + 3]!);
    ctx.lineTo(p[i * 6 + 4]!, p[i * 6 + 5]!);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  // 2. Fresh edge + outline along every side a chip shares with intact art.
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const i of list) {
    for (let k = 0; k < 3; k++) {
      const o = m.nb[i * 3 + k]!;
      if (o < 0 || m.state[o] !== 0) continue;
      const k2 = (k + 1) % 3;
      ctx.moveTo(p[i * 6 + k * 2]!, p[i * 6 + k * 2 + 1]!);
      ctx.lineTo(p[i * 6 + k2 * 2]!, p[i * 6 + k2 * 2 + 1]!);
    }
  }
  const hl = Math.max(0.75, g.lw * 0.45);
  ctx.strokeStyle = st.rim;
  ctx.lineWidth = (g.lw + hl) * 2;
  ctx.stroke();
  ctx.strokeStyle = st.edge;
  ctx.lineWidth = g.lw * 2;
  ctx.stroke();
  ctx.restore();
}

/** On the silhouette, or next to a triangle already gone. */
function open(m: ChipMesh, i: number): boolean {
  for (let k = 0; k < 3; k++) {
    const o = m.nb[i * 3 + k]!;
    if (o < 0 || m.state[o] !== 0) return true;
  }
  return false;
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
