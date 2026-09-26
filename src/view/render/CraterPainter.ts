/**
 * Paints bullet impact craters onto a damaged part's private copy of its
 * atlas frame (see view/PartCraters.ts). Coordinates are texels of that frame
 * region (the part's local frame), so craters move and rotate with the part.
 *
 *  - pit:  a crater away from the silhouette edge: scorch halo, lit lip, dark
 *          bowl (offset toward the light so the lower-right wall catches it)
 *          and a darkest centre. Painted 'source-atop', so nothing ever lands
 *          outside the shape.
 *  - bite: a crater at the edge: 'destination-out' removes a jagged chip (the
 *          crater plus a funnel out to the surface), then a fresh-edge
 *          highlight and the material outline are stroked around the notch,
 *          again source-atop, so only the surviving texels get paint and the
 *          notch reads like the rest of the part's outline.
 *
 * Looks per material family: wood = dark splintered gouges stretched along
 * the grain; steel = bright dented pits with dark centres; armour = shallow
 * scuffs that rarely chip; rubber = dull smudges, never chips; glass = star
 * cracks; core = pits glowing from inside; stone/concrete = dusty chips.
 */
import type { MaterialDef } from '../../sim/Materials';
import { css, lerpColor, scaleColor } from './color';

export interface Crater {
  /** Centre (texels in the frame region). */
  x: number;
  y: number;
  /** Base radius (texels) before damage growth. */
  r: number;
  /** Inward surface normal at the hit (unit). */
  nx: number;
  ny: number;
  /** How far the centre lies inside the silhouette (texels, >= 0). */
  depth: number;
  /** Thickness of the part under the crater: centre to the far side along the normal (texels). */
  clear: number;
  /** Shape seed: the same crater always gets the same ragged outline. */
  seed: number;
}

export type CraterDetail = 'none' | 'splinters' | 'scratches' | 'cracks';

export interface CraterStyle {
  /** Radius multiplier. */
  size: number;
  /** Craters whose centre is closer to the edge than bite * radius chip the silhouette (0 = never). */
  bite: number;
  /** Outline raggedness 0..1 (pits). */
  jag: number;
  /** Raggedness of chips (torn edges are rougher than dents). */
  biteJag: number;
  /** Elongation along the part's long axis (wood grain). */
  stretch: number;
  /** Alternating splinter spikes on the outline. */
  spikes: boolean;
  scorch: string;
  scorchClear: string;
  /** Lit lip of a pit / fresh edge of a chip. */
  rim: string;
  bowl: string;
  core: string;
  /** Centre radius as a fraction of the crater radius. */
  coreR: number;
  /** Outline stroked around chips. */
  edge: string;
  detail: CraterDetail;
  detailColor: string;
}

export interface CraterGeom {
  /** Long axis horizontal (grain direction). */
  horizontal: boolean;
  /** Outline half-width (texels), as painted by PartPainter. */
  lw: number;
  /** Deepest notch a chip may cut (texels); deeper craters stay pits so thin limbs keep their shape. */
  maxNotch: number;
}

const styles = new WeakMap<MaterialDef, CraterStyle>();

/** Crater look for a material (cached per material object; neutral variants get their own). */
export function craterStyle(m: MaterialDef): CraterStyle {
  let st = styles.get(m);
  if (!st) {
    st = buildStyle(m);
    styles.set(m, st);
  }
  return st;
}

function style(o: Partial<CraterStyle> & { scorchC: number; scorchA: number }): CraterStyle {
  return {
    size: 1,
    bite: 1,
    jag: 0.25,
    biteJag: 0.4,
    stretch: 1,
    spikes: false,
    rim: 'rgba(255,255,255,0.5)',
    bowl: 'rgba(0,0,0,0.5)',
    core: 'rgba(0,0,0,0.8)',
    coreR: 0.4,
    edge: '#000',
    detail: 'none',
    detailColor: 'rgba(255,255,255,0.6)',
    ...o,
    scorch: css(o.scorchC, o.scorchA),
    scorchClear: css(o.scorchC, 0),
  };
}

function buildStyle(m: MaterialDef): CraterStyle {
  const c = m.color;
  const o = m.outline;
  const RAW_WOOD = 0xfff0d0;
  switch (m.pattern) {
    case 'grain':
    case 'hazard':
      return style({
        size: 1.1, bite: 1, jag: 0.5, biteJag: 0.5, stretch: 1.65, spikes: true,
        scorchC: scaleColor(o, 0.7), scorchA: 0.4,
        rim: css(lerpColor(c, RAW_WOOD, 0.55), 0.95), bowl: css(scaleColor(c, 0.34), 0.95), core: css(scaleColor(o, 0.45)), coreR: 0.42,
        edge: css(o), detail: 'splinters', detailColor: css(lerpColor(c, RAW_WOOD, 0.62), 0.9),
      });
    case 'rubber':
      return style({
        size: 0.6, bite: 0, jag: 0.2,
        scorchC: 0x000000, scorchA: 0.12,
        rim: css(lerpColor(c, 0xffffff, 0.25), 0.25), bowl: css(scaleColor(c, 0.55), 0.6), core: css(scaleColor(c, 0.35), 0.5), coreR: 0.35,
        edge: css(o),
      });
    case 'glass':
      return style({
        size: 0.8, bite: 0.8, jag: 0.35,
        scorchC: 0xffffff, scorchA: 0,
        rim: 'rgba(255,255,255,0.35)', bowl: 'rgba(255,255,255,0.22)', core: 'rgba(255,255,255,0.75)', coreR: 0.25,
        edge: css(o, 0.9), detail: 'cracks', detailColor: 'rgba(255,255,255,0.85)',
      });
    case 'core':
      return style({
        size: 0.9, bite: 0.6, jag: 0.2,
        scorchC: scaleColor(o, 0.6), scorchA: 0.35,
        rim: css(lerpColor(c, 0xffffff, 0.6), 0.95), bowl: css(scaleColor(c, 0.28)), core: css(lerpColor(c, 0xffffff, 0.75)), coreR: 0.4,
        edge: css(o),
      });
    case 'speckle':
    case 'block':
      return style({
        size: 1, bite: 1.1, jag: 0.4, biteJag: 0.55,
        scorchC: scaleColor(o, 0.7), scorchA: 0.25,
        rim: css(lerpColor(c, 0xffffff, 0.45), 0.9), bowl: css(scaleColor(c, 0.5), 0.95), core: css(scaleColor(o, 0.6)), coreR: 0.4,
        edge: css(o),
      });
    default:
      if (m.id === 'armor') {
        // Heavy plate absorbs most of a round: shallow scuffs, rarely a chip.
        return style({
          size: 0.68, bite: 0.25, jag: 0.25,
          scorchC: 0x101318, scorchA: 0.16,
          rim: css(lerpColor(c, 0xffffff, 0.5), 0.6), bowl: css(scaleColor(c, 0.72), 0.6), core: css(scaleColor(c, 0.4), 0.55), coreR: 0.3,
          edge: css(o), detail: 'scratches', detailColor: css(lerpColor(c, 0xffffff, 0.6), 0.7),
        });
      }
      // Steel and other metals: bright dented lip, dark centre.
      return style({
        size: 0.85, bite: 0.5, jag: 0.14, biteJag: 0.45,
        scorchC: 0x0b0f16, scorchA: 0.3,
        rim: css(lerpColor(c, 0xffffff, 0.72), 0.95), bowl: css(scaleColor(c, 0.5), 0.95), core: css(scaleColor(c, 0.14)), coreR: 0.46,
        edge: css(o),
      });
  }
}

/** Effective radius of a crater at a damage growth factor. */
export function craterRadius(c: Crater, grow: number, maxR: number): number {
  return Math.min(maxR, c.r * grow);
}

/**
 * Paint craters on top of what is already on the canvas: `which` lists the
 * indices to paint (new or just-merged craters), null paints them all (full
 * repaints, onto a fresh copy of the base art). Phases run over the whole set
 * so chips cut through neighbouring pits and every notch outline ends up on top.
 */
export function paintCraters(
  ctx: CanvasRenderingContext2D,
  list: readonly Crater[],
  which: readonly number[] | null,
  grow: number,
  maxR: number,
  st: CraterStyle,
  g: CraterGeom,
): void {
  const n = which ? which.length : list.length;
  if (n === 0) return;
  const at = (j: number): Crater => list[which ? which[j]! : j]!;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineJoin = 'bevel';
  ctx.lineCap = 'round';
  // 1. Scorch / soot halo.
  if (st.scorch !== st.scorchClear) {
    for (let j = 0; j < n; j++) {
      const c = at(j);
      const r = craterRadius(c, grow, maxR) * 1.9;
      const grad = ctx.createRadialGradient(c.x, c.y, r * 0.3, c.x, c.y, r);
      grad.addColorStop(0, st.scorch);
      grad.addColorStop(1, st.scorchClear);
      ctx.fillStyle = grad;
      ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
    }
  }
  // 2. Pits.
  let bites = 0;
  for (let j = 0; j < n; j++) {
    const c = at(j);
    const r = craterRadius(c, grow, maxR);
    if (isBite(c, r, st, g)) {
      bites++;
      continue;
    }
    paintPit(ctx, c, r, st, g);
  }
  if (bites > 0) {
    // 3. Chips out of the silhouette.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    for (let j = 0; j < n; j++) {
      const c = at(j);
      const r = craterRadius(c, grow, maxR);
      if (!isBite(c, r, st, g)) continue;
      biteSubpaths(ctx, c, r, st, g);
      ctx.fill();
    }
    // 4. Fresh edge + outline around each notch (only surviving texels take paint).
    ctx.globalCompositeOperation = 'source-atop';
    const hl = Math.max(1, g.lw * 0.8);
    for (let j = 0; j < n; j++) {
      const c = at(j);
      const r = craterRadius(c, grow, maxR);
      if (!isBite(c, r, st, g)) continue;
      biteSubpaths(ctx, c, r, st, g);
      ctx.strokeStyle = st.rim;
      ctx.lineWidth = (g.lw + hl) * 2;
      ctx.stroke();
      ctx.strokeStyle = st.edge;
      ctx.lineWidth = g.lw * 2;
      ctx.stroke();
      if (st.detail === 'splinters') paintDetail(ctx, c, r, st, g, 0.6);
    }
  }
  ctx.restore();
}

/**
 * Chip or pit? Chips need the crater close to the edge and the part thick
 * enough under it; growth widens a chip's reach only a little, so a battered
 * part keeps a mix of chips and pits.
 */
function isBite(c: Crater, r: number, st: CraterStyle, g: CraterGeom): boolean {
  return (
    st.bite > 0 &&
    c.depth < st.bite * Math.min(r, c.r * 1.3) &&
    c.depth + r * 0.9 < g.maxNotch &&
    // Never through a thin tip or limb: a pit there instead.
    r * 0.9 * (1 + st.biteJag * 0.5) + g.lw < c.clear
  );
}

function paintPit(ctx: CanvasRenderingContext2D, c: Crater, r: number, st: CraterStyle, g: CraterGeom): void {
  ctx.fillStyle = st.rim;
  craterPath(ctx, c, c.x, c.y, r, 1, st, g);
  ctx.fill();
  if (r >= 3) {
    // Bowl shifted toward the light (top-left): its lower-right wall stays lit.
    const k = r * 0.13;
    ctx.fillStyle = st.bowl;
    craterPath(ctx, c, c.x - k, c.y - k, r, 0.8, st, g);
    ctx.fill();
  }
  ctx.fillStyle = st.core;
  ctx.beginPath();
  ctx.arc(c.x - r * 0.07, c.y - r * 0.07, Math.max(1, r * st.coreR), 0, Math.PI * 2);
  ctx.fill();
  if (st.detail !== 'none') paintDetail(ctx, c, r, st, g, 1);
}

/** The chip: the crater plus a slightly smaller copy on the surface (an open funnel, never a keyhole). */
function biteSubpaths(ctx: CanvasRenderingContext2D, c: Crater, r: number, st: CraterStyle, g: CraterGeom): void {
  craterPath(ctx, c, c.x, c.y, r, 0.9, st, g, true, st.biteJag);
  if (c.depth > r * 0.15) craterPath(ctx, c, c.x - c.nx * c.depth, c.y - c.ny * c.depth, r, 0.8, st, g, false, st.biteJag);
}

/** Ragged crater outline (deterministic per crater seed). `begin` = start a new path. */
function craterPath(
  ctx: CanvasRenderingContext2D,
  c: Crater,
  cx: number,
  cy: number,
  r: number,
  scale: number,
  st: CraterStyle,
  g: CraterGeom,
  begin = true,
  jag = st.jag,
): void {
  const rnd = rng(c.seed);
  const n = st.spikes ? 13 : 10;
  // Stretch along the grain, keeping the area about the same.
  const along = st.stretch;
  const across = 1 / Math.sqrt(st.stretch);
  const sx = g.horizontal ? along : across;
  const sy = g.horizontal ? across : along;
  const rr = r * scale;
  if (begin) ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const a = ((k + (rnd() - 0.5) * 0.7) / n) * Math.PI * 2;
    let q = 1 + jag * (rnd() - 0.5);
    // Splinters: uneven spikes, not a saw blade.
    if (st.spikes) q *= k % 2 ? 0.55 + rnd() * 0.25 : 0.95 + rnd() * 0.4;
    const x = cx + Math.cos(a) * rr * q * sx;
    const y = cy + Math.sin(a) * rr * q * sy;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function paintDetail(ctx: CanvasRenderingContext2D, c: Crater, r: number, st: CraterStyle, g: CraterGeom, amount: number): void {
  const rnd = rng(c.seed ^ 0x5bd1e995);
  ctx.strokeStyle = st.detailColor;
  switch (st.detail) {
    case 'splinters': {
      // Raw slivers running along the grain out of the gouge, with a dark crack beside each.
      const n = amount >= 1 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const side = rnd() < 0.5 ? -1 : 1;
        const off = (rnd() - 0.5) * r * 0.9;
        const l0 = r * (0.7 + rnd() * 0.3) * st.stretch;
        const l1 = l0 + r * (0.6 + rnd() * 1.1);
        const w = Math.max(1, g.lw * (0.35 + rnd() * 0.3));
        line(ctx, g, c.x, c.y, side * l0, off, side * l1, off + (rnd() - 0.5) * r * 0.4, w, st.detailColor);
        line(ctx, g, c.x, c.y, side * l0 * 0.9, off + w * 1.4, side * (l1 - r * 0.3), off + w * 1.4, Math.max(1, w * 0.8), st.edge);
      }
      break;
    }
    case 'scratches': {
      ctx.lineWidth = Math.max(1, g.lw * 0.35);
      const n = rnd() < 0.5 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI;
        const l = r * (0.6 + rnd() * 0.6);
        const ox = (rnd() - 0.5) * r * 0.6;
        const oy = (rnd() - 0.5) * r * 0.6;
        ctx.beginPath();
        ctx.moveTo(c.x + ox - Math.cos(a) * l, c.y + oy - Math.sin(a) * l);
        ctx.lineTo(c.x + ox + Math.cos(a) * l, c.y + oy + Math.sin(a) * l);
        ctx.stroke();
      }
      break;
    }
    case 'cracks': {
      ctx.lineWidth = Math.max(1, g.lw * 0.4);
      const n = 5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = ((i + rnd() * 0.7) / n) * Math.PI * 2;
        const l = r * (1.4 + rnd() * 1.6);
        const kink = (rnd() - 0.5) * 0.6;
        ctx.moveTo(c.x + Math.cos(a) * r * 0.3, c.y + Math.sin(a) * r * 0.3);
        ctx.lineTo(c.x + Math.cos(a + kink) * l * 0.55, c.y + Math.sin(a + kink) * l * 0.55);
        ctx.lineTo(c.x + Math.cos(a) * l, c.y + Math.sin(a) * l);
      }
      ctx.stroke();
      break;
    }
  }
}

/** Stroke a segment given in grain space (u along the long axis, v across). */
function line(ctx: CanvasRenderingContext2D, g: CraterGeom, cx: number, cy: number, u0: number, v0: number, u1: number, v1: number, w: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  if (g.horizontal) {
    ctx.moveTo(cx + u0, cy + v0);
    ctx.lineTo(cx + u1, cy + v1);
  } else {
    ctx.moveTo(cx + v0, cy + u0);
    ctx.lineTo(cx + v1, cy + u1);
  }
  ctx.stroke();
}

/** Tiny seeded PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
