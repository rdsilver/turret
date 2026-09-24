/**
 * Paints structure parts into a 2D canvas: material fill, material pattern,
 * soft bevel and a crisp outline drawn INSIDE the physical boundary (so a
 * sprite never looks bigger than its collider).
 *
 * Units: `s` = texels per meter. Shapes are in simulation space (y down).
 */
import type { PartShape } from '../../sim/StructurePart';
import type { MaterialDef } from '../../sim/Materials';
import { css, scaleColor, lerpColor } from './color';

export interface PartLayout {
  /** Region size in texels. */
  w: number;
  h: number;
  /** Body origin inside the region (texels). */
  ox: number;
  oy: number;
}

/** Transparent margin around the shape (texels) for clean bilinear edges. */
const PAD = 2;

export function measurePart(shape: PartShape, s: number): PartLayout {
  switch (shape.kind) {
    case 'box': {
      const w = Math.ceil(shape.hw * 2 * s + PAD * 2);
      const h = Math.ceil(shape.hh * 2 * s + PAD * 2);
      return { w, h, ox: w / 2, oy: h / 2 };
    }
    case 'circle': {
      const d = Math.ceil(shape.r * 2 * s + PAD * 2);
      return { w: d, h: d, ox: d / 2, oy: d / 2 };
    }
    case 'poly': {
      const p = shape.points;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        minX = Math.min(minX, p[i]!);
        maxX = Math.max(maxX, p[i]!);
        minY = Math.min(minY, p[i + 1]!);
        maxY = Math.max(maxY, p[i + 1]!);
      }
      const w = Math.ceil((maxX - minX) * s + PAD * 2);
      const h = Math.ceil((maxY - minY) * s + PAD * 2);
      return { w, h, ox: -minX * s + PAD, oy: -minY * s + PAD };
    }
  }
}

/** Deterministic cache key for a shape (quantised so float noise doesn't explode the cache). */
export function shapeKey(shape: PartShape): string {
  switch (shape.kind) {
    case 'box':
      return `b${Math.round(shape.hw * 400)}x${Math.round(shape.hh * 400)}`;
    case 'circle':
      return `c${Math.round(shape.r * 400)}`;
    case 'poly': {
      let k = 'p';
      const p = shape.points;
      for (let i = 0; i < p.length; i++) k += (i ? ',' : '') + Math.round(p[i]! * 200);
      return k;
    }
  }
}

export interface PaintOptions {
  /** Anchored (fixed) part: draw with a subtle hatch so it reads as immovable. */
  fixed?: boolean;
  seed: number;
}

export function paintPart(ctx: CanvasRenderingContext2D, shape: PartShape, mat: MaterialDef, s: number, lay: PartLayout, o: PaintOptions): void {
  const rnd = mulberry32(o.seed);
  const g = geom(shape, s, lay);
  const minDim = Math.min(g.bw, g.bh);
  // Outline: ~1.5 world px, thinner on tiny fragments.
  const lw = Math.max(1.5, Math.min(s * 0.05, minDim * 0.16));
  const radius = cornerRadius(mat, shape, s, minDim);

  ctx.save();
  tracePath(ctx, shape, s, lay, radius);
  ctx.clip();

  // Base fill.
  const fillAlpha = mat.pattern === 'glass' ? Math.min(0.42, mat.alpha) : mat.alpha;
  ctx.fillStyle = css(mat.color, fillAlpha);
  ctx.fillRect(g.x0 - 1, g.y0 - 1, g.bw + 2, g.bh + 2);

  switch (mat.pattern) {
    case 'grain':
      paintGrain(ctx, shape, mat, s, g, rnd);
      break;
    case 'speckle':
      paintSpeckle(ctx, mat, s, g, rnd);
      break;
    case 'plate':
      paintPlate(ctx, shape, mat, s, g, lay, lw);
      break;
    case 'glass':
      paintGlass(ctx, mat, s, g);
      break;
    case 'rubber':
      paintRubber(ctx, mat, s, g);
      break;
    case 'block':
      paintBlocks(ctx, shape, mat, s, g, rnd);
      break;
    case 'hazard':
      paintHazard(ctx, shape, mat, s, g, lay);
      break;
    case 'core':
      paintCore(ctx, mat, s, g, lay);
      break;
    default:
      if (mat.id === 'ground') paintHatch(ctx, g, s * 0.25, css(mat.outline, 0.35), 1.2);
      break;
  }

  if (o.fixed) paintHatch(ctx, g, s * 0.3, 'rgba(0,0,0,0.16)', Math.max(1, s * 0.03));

  // Soft bevel: light from the top-left, shade bottom-right (drawn inside the clip).
  if (mat.pattern !== 'glass') {
    const bw = Math.max(1, Math.min(s * 0.05, minDim * 0.12));
    ctx.lineWidth = bw * 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.save();
    ctx.translate(bw * 0.9, bw * 0.9);
    tracePath(ctx, shape, s, lay, radius);
    ctx.restore();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.20)';
    ctx.save();
    ctx.translate(-bw * 0.9, -bw * 0.9);
    tracePath(ctx, shape, s, lay, radius);
    ctx.restore();
    ctx.stroke();
  }

  // Outline, inside the boundary (clip keeps the inner half of a double-width stroke).
  tracePath(ctx, shape, s, lay, radius);
  ctx.lineWidth = lw * 2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = mat.pattern === 'glass' ? css(mat.outline, 0.85) : css(mat.outline, 1);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------- geometry

interface Geom {
  /** Shape bounds inside the region (texels). */
  x0: number;
  y0: number;
  bw: number;
  bh: number;
  cx: number;
  cy: number;
  /** Long axis is horizontal. */
  horizontal: boolean;
}

function geom(shape: PartShape, s: number, lay: PartLayout): Geom {
  let x0: number;
  let y0: number;
  let bw: number;
  let bh: number;
  switch (shape.kind) {
    case 'box':
      bw = shape.hw * 2 * s;
      bh = shape.hh * 2 * s;
      x0 = lay.ox - bw / 2;
      y0 = lay.oy - bh / 2;
      break;
    case 'circle':
      bw = bh = shape.r * 2 * s;
      x0 = lay.ox - bw / 2;
      y0 = lay.oy - bh / 2;
      break;
    default:
      x0 = PAD;
      y0 = PAD;
      bw = lay.w - PAD * 2;
      bh = lay.h - PAD * 2;
      break;
  }
  return { x0, y0, bw, bh, cx: lay.ox, cy: lay.oy, horizontal: bw >= bh };
}

function cornerRadius(mat: MaterialDef, shape: PartShape, s: number, minDim: number): number {
  if (shape.kind !== 'box') return 0;
  if (mat.pattern === 'rubber') return Math.min(s * 0.14, minDim * 0.3);
  if (mat.pattern === 'glass' || mat.pattern === 'plate') return Math.min(s * 0.03, minDim * 0.1);
  return Math.min(s * 0.04, minDim * 0.12);
}

function tracePath(ctx: CanvasRenderingContext2D, shape: PartShape, s: number, lay: PartLayout, radius: number): void {
  ctx.beginPath();
  switch (shape.kind) {
    case 'box': {
      const w = shape.hw * 2 * s;
      const h = shape.hh * 2 * s;
      const x = lay.ox - w / 2;
      const y = lay.oy - h / 2;
      if (radius > 0.5) roundRectPath(ctx, x, y, w, h, radius);
      else ctx.rect(x, y, w, h);
      break;
    }
    case 'circle':
      ctx.arc(lay.ox, lay.oy, shape.r * s, 0, Math.PI * 2);
      break;
    case 'poly': {
      const p = shape.points;
      for (let i = 0; i < p.length; i += 2) {
        const x = lay.ox + p[i]! * s;
        const y = lay.oy + p[i + 1]! * s;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      break;
    }
  }
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------- patterns

function paintGrain(ctx: CanvasRenderingContext2D, shape: PartShape, mat: MaterialDef, s: number, g: Geom, rnd: () => number): void {
  const dark = css(mat.outline, 0.3);
  const light = css(0xffffff, 0.12);
  if (shape.kind === 'circle') {
    // Log end: growth rings + a couple of radial checks.
    const r = shape.r * s;
    ctx.lineWidth = Math.max(1, s * 0.018);
    for (let k = 1; k <= 6; k++) {
      const rr = r * (k / 6.5) * (0.92 + rnd() * 0.08);
      ctx.strokeStyle = k % 2 ? dark : css(mat.outline, 0.14);
      ctx.beginPath();
      ctx.ellipse(g.cx + (rnd() - 0.5) * 2, g.cy + (rnd() - 0.5) * 2, rr, rr * (0.94 + rnd() * 0.06), rnd() * 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = css(mat.outline, 0.35);
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, Math.max(1.5, r * 0.07), 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Planks: long wavy grain lines along the long axis.
  const along = g.horizontal ? g.bw : g.bh;
  const across = g.horizontal ? g.bh : g.bw;
  const spacing = Math.max(3, s * 0.085);
  const n = Math.max(2, Math.floor(across / spacing));
  ctx.save();
  if (!g.horizontal) {
    // Work in a rotated frame so "along" is +x.
    ctx.translate(g.x0 + g.bw, g.y0);
    ctx.rotate(Math.PI / 2);
  } else ctx.translate(g.x0, g.y0);
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const y = ((i + 0.5 + (rnd() - 0.5) * 0.5) / n) * across;
    const amp = s * (0.01 + rnd() * 0.02);
    const freq = (Math.PI * 2) / (s * (0.6 + rnd() * 1.4));
    const phase = rnd() * 6.28;
    const x0 = rnd() < 0.5 ? 0 : rnd() * along * 0.3;
    const x1 = rnd() < 0.5 ? along : along * (0.7 + rnd() * 0.3);
    ctx.strokeStyle = i % 3 === 1 ? light : dark;
    ctx.lineWidth = Math.max(1, s * (0.012 + rnd() * 0.012));
    ctx.beginPath();
    const step = Math.max(3, s * 0.1);
    for (let x = x0; x <= x1 + 0.01; x += step) {
      const yy = y + Math.sin(x * freq + phase) * amp;
      if (x === x0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // Knots on longer members.
  const knots = Math.floor(along / (s * 1.6));
  for (let k = 0; k < knots; k++) {
    if (rnd() < 0.45) continue;
    const kx = (0.15 + rnd() * 0.7) * along;
    const ky = (0.3 + rnd() * 0.4) * across;
    const kr = Math.min(across * 0.22, s * (0.05 + rnd() * 0.04));
    ctx.strokeStyle = css(mat.outline, 0.32);
    ctx.lineWidth = Math.max(1, s * 0.015);
    ctx.beginPath();
    ctx.ellipse(kx, ky, kr * 1.7, kr, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = css(mat.outline, 0.2);
    ctx.beginPath();
    ctx.ellipse(kx, ky, kr * 0.7, kr * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintSpeckle(ctx: CanvasRenderingContext2D, mat: MaterialDef, s: number, g: Geom, rnd: () => number): void {
  // Very soft mottling first, then fine aggregate speckle.
  const blotches = Math.ceil((g.bw * g.bh) / (s * s * 0.12));
  for (let i = 0; i < blotches; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.arc(g.x0 + rnd() * g.bw, g.y0 + rnd() * g.bh, s * (0.08 + rnd() * 0.14), 0, Math.PI * 2);
    ctx.fill();
  }
  const n = Math.ceil((g.bw * g.bh) / (s * s * 0.004));
  const dark = css(mat.outline, 0.3);
  const light = 'rgba(255,255,255,0.22)';
  for (let i = 0; i < n; i++) {
    const r = Math.max(0.7, s * (0.006 + rnd() * 0.014));
    ctx.fillStyle = rnd() < 0.62 ? dark : light;
    ctx.beginPath();
    ctx.arc(g.x0 + rnd() * g.bw, g.y0 + rnd() * g.bh, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintPlate(ctx: CanvasRenderingContext2D, shape: PartShape, mat: MaterialDef, s: number, g: Geom, lay: PartLayout, lw: number): void {
  const minDim = Math.min(g.bw, g.bh);
  // Brushed finish along the long axis.
  ctx.lineWidth = 1;
  const n = Math.floor((g.horizontal ? g.bh : g.bw) / Math.max(2, s * 0.04));
  for (let i = 0; i < n; i++) {
    ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
    ctx.beginPath();
    if (g.horizontal) {
      const y = g.y0 + (i + 0.5) * (g.bh / n);
      ctx.moveTo(g.x0, y);
      ctx.lineTo(g.x0 + g.bw, y);
    } else {
      const x = g.x0 + (i + 0.5) * (g.bw / n);
      ctx.moveTo(x, g.y0);
      ctx.lineTo(x, g.y0 + g.bh);
    }
    ctx.stroke();
  }
  const rivetR = Math.max(1.2, Math.min(s * 0.035, minDim * 0.1));
  if (shape.kind === 'circle') {
    const r = shape.r * s;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, s * 0.02);
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    const k = Math.max(4, Math.min(10, Math.round((r * 2 * Math.PI * 0.62) / (s * 0.35))));
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      rivet(ctx, g.cx + Math.cos(a) * r * 0.78, g.cy + Math.sin(a) * r * 0.78, rivetR, mat);
    }
    rivet(ctx, g.cx, g.cy, rivetR * 1.4, mat);
    return;
  }
  if (shape.kind !== 'box') return;
  // Inset panel line (stamped plate).
  const inset = Math.max(lw * 2 + 1, Math.min(s * 0.09, minDim * 0.24));
  if (minDim > s * 0.22) {
    ctx.lineWidth = Math.max(1, s * 0.016);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeRect(g.x0 + inset + 1, g.y0 + inset + 1, g.bw - inset * 2, g.bh - inset * 2);
    ctx.strokeStyle = css(mat.outline, 0.35);
    ctx.strokeRect(g.x0 + inset, g.y0 + inset, g.bw - inset * 2, g.bh - inset * 2);
  }
  // Rivets: along the long edges (or centreline for thin members).
  const along = g.horizontal ? g.bw : g.bh;
  const across = g.horizontal ? g.bh : g.bw;
  const edge = Math.max(rivetR * 2.2, Math.min(s * 0.1, across * 0.26));
  const count = Math.max(2, Math.round(along / (s * 0.45)) + 1);
  const rows = across > s * 0.3 ? [edge, across - edge] : [across / 2];
  for (const off of rows) {
    for (let i = 0; i < count; i++) {
      const t = edge + ((along - edge * 2) * i) / (count - 1);
      const x = g.horizontal ? g.x0 + t : g.x0 + off;
      const y = g.horizontal ? g.y0 + off : g.y0 + t;
      rivet(ctx, x, y, rivetR, mat);
    }
  }
  void lay;
}

function rivet(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, mat: MaterialDef): void {
  ctx.fillStyle = css(mat.outline, 0.75);
  ctx.beginPath();
  ctx.arc(x + r * 0.2, y + r * 0.25, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = css(lerpColor(mat.color, 0xffffff, 0.35), 1);
  ctx.beginPath();
  ctx.arc(x - r * 0.1, y - r * 0.1, r * 0.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
}

function paintGlass(ctx: CanvasRenderingContext2D, mat: MaterialDef, s: number, g: Geom): void {
  // Slight inner tint gradient toward the bottom (thickness) — pure alpha, no hue shift.
  const grad = ctx.createLinearGradient(0, g.y0, 0, g.y0 + g.bh);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(1, css(scaleColor(mat.color, 0.6), 0.18));
  ctx.fillStyle = grad;
  ctx.fillRect(g.x0, g.y0, g.bw, g.bh);
  // Two diagonal highlight streaks.
  const d = Math.max(g.bw, g.bh);
  ctx.save();
  ctx.translate(g.x0, g.y0);
  ctx.fillStyle = 'rgba(255,255,255,0.34)';
  const w1 = Math.max(2, d * 0.09);
  ctx.beginPath();
  ctx.moveTo(d * 0.18, 0);
  ctx.lineTo(d * 0.18 + w1, 0);
  ctx.lineTo(d * 0.18 + w1 - d, d);
  ctx.lineTo(d * 0.18 - d, d);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  const w2 = Math.max(1, d * 0.035);
  const o2 = d * 0.18 + w1 + Math.max(2, d * 0.05);
  ctx.beginPath();
  ctx.moveTo(o2, 0);
  ctx.lineTo(o2 + w2, 0);
  ctx.lineTo(o2 + w2 - d, d);
  ctx.lineTo(o2 - d, d);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  // Bright inner edge on top/left.
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.beginPath();
  ctx.moveTo(g.x0 + s * 0.06, g.y0 + g.bh - s * 0.06);
  ctx.lineTo(g.x0 + s * 0.06, g.y0 + s * 0.06);
  ctx.lineTo(g.x0 + g.bw - s * 0.06, g.y0 + s * 0.06);
  ctx.stroke();
}

function paintRubber(ctx: CanvasRenderingContext2D, mat: MaterialDef, s: number, g: Geom): void {
  const grad = ctx.createLinearGradient(0, g.y0, 0, g.y0 + g.bh);
  grad.addColorStop(0, 'rgba(255,255,255,0.14)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, css(mat.outline, 0.22));
  ctx.fillStyle = grad;
  ctx.fillRect(g.x0, g.y0, g.bw, g.bh);
  // Moulded ribs across the short axis.
  const along = g.horizontal ? g.bw : g.bh;
  const n = Math.floor(along / (s * 0.3));
  ctx.strokeStyle = css(mat.outline, 0.18);
  ctx.lineWidth = Math.max(1, s * 0.03);
  for (let i = 1; i < n; i++) {
    const t = (i / n) * along;
    ctx.beginPath();
    if (g.horizontal) {
      ctx.moveTo(g.x0 + t, g.y0 + g.bh * 0.25);
      ctx.lineTo(g.x0 + t, g.y0 + g.bh * 0.75);
    } else {
      ctx.moveTo(g.x0 + g.bw * 0.25, g.y0 + t);
      ctx.lineTo(g.x0 + g.bw * 0.75, g.y0 + t);
    }
    ctx.stroke();
  }
}

function paintBlocks(ctx: CanvasRenderingContext2D, shape: PartShape, mat: MaterialDef, s: number, g: Geom, rnd: () => number): void {
  const mortar = css(mat.outline, 0.42);
  if (shape.kind !== 'box') {
    // Rubble stone: a few cracks and shaded facets.
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      ctx.arc(g.x0 + rnd() * g.bw, g.y0 + rnd() * g.bh, Math.max(g.bw, g.bh) * (0.2 + rnd() * 0.2), 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  const rows = Math.max(1, Math.round(g.bh / (s * 0.42)));
  const rh = g.bh / rows;
  const target = s * 0.75;
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.strokeStyle = mortar;
  for (let r = 0; r < rows; r++) {
    const y = g.y0 + r * rh;
    const cols = Math.max(1, Math.round(g.bw / target));
    const cw = g.bw / cols;
    const off = r % 2 && cols > 1 ? cw / 2 : 0;
    // Per-block shade variation.
    for (let c = -1; c < cols; c++) {
      const x = g.x0 + c * cw + off;
      ctx.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.03 + rnd() * 0.06})` : `rgba(255,255,255,${0.03 + rnd() * 0.06})`;
      ctx.fillRect(x, y, cw, rh);
    }
    if (r > 0) {
      ctx.beginPath();
      ctx.moveTo(g.x0, y);
      ctx.lineTo(g.x0 + g.bw, y);
      ctx.stroke();
    }
    for (let c = 1; c <= cols; c++) {
      const x = g.x0 + c * cw - (cols > 1 ? off : 0);
      if (x <= g.x0 + 1 || x >= g.x0 + g.bw - 1) continue;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + rh);
      ctx.stroke();
    }
  }
  // Fine grit.
  const n = Math.ceil((g.bw * g.bh) / (s * s * 0.012));
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rnd() < 0.5 ? css(mat.outline, 0.18) : 'rgba(255,255,255,0.16)';
    ctx.fillRect(g.x0 + rnd() * g.bw, g.y0 + rnd() * g.bh, 1, 1);
  }
}

function paintHazard(ctx: CanvasRenderingContext2D, shape: PartShape, mat: MaterialDef, s: number, g: Geom, lay: PartLayout): void {
  const minDim = Math.min(g.bw, g.bh);
  const dark = css(scaleColor(mat.outline, 0.7), 1);
  const yellow = '#ffd23f';
  // Crate frame.
  if (shape.kind === 'box' && minDim > s * 0.3) {
    const fw = Math.max(2, minDim * 0.1);
    ctx.strokeStyle = css(scaleColor(mat.color, 0.72), 1);
    ctx.lineWidth = fw;
    ctx.strokeRect(g.x0 + fw * 1.2, g.y0 + fw * 1.2, g.bw - fw * 2.4, g.bh - fw * 2.4);
  }
  if (shape.kind === 'circle') {
    // Drum: two dark hoops.
    ctx.strokeStyle = css(mat.outline, 0.55);
    ctx.lineWidth = Math.max(1.5, g.bh * 0.05);
    for (const f of [0.3, 0.7]) {
      ctx.beginPath();
      ctx.moveTo(g.x0, g.y0 + g.bh * f);
      ctx.lineTo(g.x0 + g.bw, g.y0 + g.bh * f);
      ctx.stroke();
    }
  }
  // Hazard band (yellow/black diagonal stripes) across the long axis.
  const bandH = Math.max(3, Math.min(minDim * 0.42, s * 0.34));
  ctx.save();
  if (g.horizontal) {
    ctx.beginPath();
    ctx.rect(g.x0, g.cy - bandH / 2, g.bw, bandH);
  } else {
    ctx.beginPath();
    ctx.rect(g.cx - bandH / 2, g.y0, bandH, g.bh);
  }
  ctx.clip();
  ctx.fillStyle = yellow;
  ctx.fillRect(g.x0, g.y0, g.bw, g.bh);
  const sw = Math.max(3, bandH * 0.55);
  ctx.fillStyle = dark;
  const span = g.bw + g.bh;
  for (let x = -g.bh; x < span; x += sw * 2) {
    ctx.beginPath();
    ctx.moveTo(g.x0 + x, g.y0 + g.bh);
    ctx.lineTo(g.x0 + x + sw, g.y0 + g.bh);
    ctx.lineTo(g.x0 + x + sw + g.bh, g.y0);
    ctx.lineTo(g.x0 + x + g.bh, g.y0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // Band edges.
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(1, s * 0.02);
  ctx.beginPath();
  if (g.horizontal) {
    ctx.moveTo(g.x0, g.cy - bandH / 2);
    ctx.lineTo(g.x0 + g.bw, g.cy - bandH / 2);
    ctx.moveTo(g.x0, g.cy + bandH / 2);
    ctx.lineTo(g.x0 + g.bw, g.cy + bandH / 2);
  } else {
    ctx.moveTo(g.cx - bandH / 2, g.y0);
    ctx.lineTo(g.cx - bandH / 2, g.y0 + g.bh);
    ctx.moveTo(g.cx + bandH / 2, g.y0);
    ctx.lineTo(g.cx + bandH / 2, g.y0 + g.bh);
  }
  ctx.stroke();
  void lay;
}

function paintCore(ctx: CanvasRenderingContext2D, mat: MaterialDef, s: number, g: Geom, lay: PartLayout): void {
  const r = Math.max(g.bw, g.bh) * 0.62;
  const grad = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, r);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.28, css(lerpColor(mat.color, 0xffffff, 0.55), 0.95));
  grad.addColorStop(0.6, css(mat.color, 1));
  grad.addColorStop(1, css(scaleColor(mat.color, 0.55), 1));
  ctx.fillStyle = grad;
  ctx.fillRect(g.x0, g.y0, g.bw, g.bh);
  const minDim = Math.min(g.bw, g.bh);
  // Containment rings.
  ctx.strokeStyle = css(mat.outline, 0.55);
  ctx.lineWidth = Math.max(1, s * 0.025);
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, minDim * 0.34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = Math.max(1, s * 0.012);
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, minDim * 0.22, 0, Math.PI * 2);
  ctx.stroke();
  // Four vent ticks.
  ctx.strokeStyle = css(mat.outline, 0.5);
  ctx.lineWidth = Math.max(1, s * 0.03);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(g.cx + c * minDim * 0.4, g.cy + sn * minDim * 0.4);
    ctx.lineTo(g.cx + c * minDim * 0.48, g.cy + sn * minDim * 0.48);
    ctx.stroke();
  }
  void lay;
}

function paintHatch(ctx: CanvasRenderingContext2D, g: Geom, spacing: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (let x = -g.bh; x < g.bw; x += spacing) {
    ctx.moveTo(g.x0 + x, g.y0 + g.bh);
    ctx.lineTo(g.x0 + x + g.bh, g.y0);
  }
  ctx.stroke();
}

// ---------------------------------------------------------------- rng

export function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
