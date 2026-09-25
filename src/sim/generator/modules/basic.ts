/**
 * Basic structural modules. Each registers itself on import.
 *
 * Conventions: definition space (y up). A module sits on ctx.baseY centered on
 * ctx.x, welds its own internals, and returns its top. Welds to the module
 * below are made by the generator's inter-module auto-weld.
 */
import type { MaterialId } from '../../Materials';
import type { PartTag } from '../../StructureDefinition';
import { param, paramBool, paramStr, registerModule, type ModuleResult } from '../StructureGenerator';
import { braceBay, type BracePattern } from './bracing';
import { num, tagsOf } from './util';

/** A single box. Params: w, h, material, dx (offset), tags (comma separated), angle. */
registerModule('block', (ctx) => {
  const w = param(ctx, 'w', 1);
  const h = param(ctx, 'h', 1);
  const mat = paramStr<MaterialId>(ctx, 'material', 'wood');
  const x = ctx.x + param(ctx, 'dx', 0);
  const i = ctx.draft.boxOn(x, ctx.baseY, w, h, mat, {
    tags: tagsOf(ctx),
    id: typeof ctx.spec.id === 'string' ? ctx.spec.id : undefined,
    angle: param(ctx, 'angle', 0),
    fixed: paramBool(ctx, 'fixed', false),
    densityScale: param(ctx, 'densityScale', 1),
  });
  return { parts: [i], top: ctx.baseY + h, width: w, x };
});

/**
 * Explicit parts relative to the cursor, for hand-crafted details.
 * Params: parts: [{ x, y, w, h, material, angle?, id?, tags?, shape? ('box'|'circle'), r? }], weld: boolean (auto-weld internally)
 */
registerModule('parts', (ctx) => {
  const list = (ctx.spec.parts as Array<Record<string, unknown>>) ?? [];
  const idx: number[] = [];
  let top = ctx.baseY;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of list) {
    const x = ctx.x + num(p.x, 0);
    const y = ctx.baseY + num(p.y, 0);
    const mat = (p.material as MaterialId) ?? 'wood';
    const opts = {
      id: p.id as string | undefined,
      angle: num(p.angle, 0),
      tags: p.tags as PartTag[] | undefined,
      fixed: p.fixed === true,
      densityScale: num(p.densityScale, 1),
    };
    let i: number;
    if (p.shape === 'circle') i = ctx.draft.circle(x, y, num(p.r, 0.5), mat, opts);
    else i = ctx.draft.box(x, y, num(p.w, 1), num(p.h, 1), mat, opts);
    idx.push(i);
    const b = ctx.draft.bounds(i);
    top = Math.max(top, b.maxY);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
  }
  if (ctx.spec.weld !== false) ctx.draft.autoWeld({ among: idx, toGround: ctx.baseY <= 0.001 });
  return { parts: idx, top, width: isFinite(maxX) ? maxX - minX : ctx.width, x: isFinite(maxX) ? (minX + maxX) / 2 : ctx.x };
});

/**
 * A vertical stack of blocks. Params: count, w, h, material, taper (width shrink per block, m),
 * jitter (random x offset per block, m), weld (default true), strength.
 */
registerModule('stack', (ctx) => {
  const count = Math.round(param(ctx, 'count', 5));
  const w0 = param(ctx, 'w', 1);
  const h = param(ctx, 'h', 1);
  const taper = param(ctx, 'taper', 0);
  const jitter = param(ctx, 'jitter', 0);
  const mat = paramStr<MaterialId>(ctx, 'material', 'wood');
  const idx: number[] = [];
  let y = ctx.baseY;
  let w = w0;
  for (let k = 0; k < count; k++) {
    const x = ctx.x + (jitter > 0 ? (ctx.rng.next() * 2 - 1) * jitter : 0);
    idx.push(ctx.draft.boxOn(x, y, w, h, mat, { tags: tagsOf(ctx) }));
    y += h;
    w = Math.max(0.2, w - taper);
  }
  if (paramBool(ctx, 'weld', true)) ctx.draft.autoWeld({ among: idx, toGround: false, strength: param(ctx, 'strength', 1) });
  return { parts: idx, top: y, width: w, x: ctx.x };
});

/** Horizontal slab/beam. Params: w, h, material, dx, strength. */
registerModule('slab', (ctx) => {
  const w = param(ctx, 'w', ctx.width);
  const h = param(ctx, 'h', 0.35);
  const mat = paramStr<MaterialId>(ctx, 'material', 'wood');
  const x = ctx.x + param(ctx, 'dx', 0);
  const i = ctx.draft.boxOn(x, ctx.baseY, w, h, mat, { tags: tagsOf(ctx), id: typeof ctx.spec.id === 'string' ? ctx.spec.id : undefined });
  return { parts: [i], top: ctx.baseY + h, width: w, x };
});

/**
 * One storey of a post-and-beam frame: `columns` posts under a beam.
 * Params: w (total width), h (column height), columns, colW, beamH, material, beamMaterial,
 * strength (weld multiplier), weakColumn (index of a column with weakened joints),
 * brace ('none'|'x'|'single'|'chevron'|'v' diagonal bracing in every bay, default none),
 * braceDir (single: 1 rises right, -1 rises left, 'alt' alternates per bay), braceT, braceMaterial,
 * braceStrength, skipBay (index of a bay left unbraced — a deliberate weakness).
 */
registerModule('frame', (ctx): ModuleResult => {
  const w = param(ctx, 'w', ctx.width);
  const h = param(ctx, 'h', 3);
  const n = Math.max(2, Math.round(param(ctx, 'columns', 2)));
  const colW = param(ctx, 'colW', 0.35);
  const beamH = param(ctx, 'beamH', 0.3);
  const mat = paramStr<MaterialId>(ctx, 'material', 'wood');
  const beamMat = paramStr<MaterialId>(ctx, 'beamMaterial', mat);
  const strength = param(ctx, 'strength', 1);
  const weak = Math.round(param(ctx, 'weakColumn', -1));
  const idx: number[] = [];
  const cols: number[] = [];
  const colX: number[] = [];
  for (let k = 0; k < n; k++) {
    const x = ctx.x - w / 2 + colW / 2 + (k * (w - colW)) / (n - 1);
    const c = ctx.draft.boxOn(x, ctx.baseY, colW, h, mat, { tags: k === weak ? ['weakpoint', ...(tagsOf(ctx) ?? [])] : tagsOf(ctx) });
    cols.push(c);
    colX.push(x);
    idx.push(c);
  }
  const beam = ctx.draft.boxOn(ctx.x, ctx.baseY + h, w, beamH, beamMat, { tags: tagsOf(ctx) });
  idx.push(beam);
  cols.forEach((c, k) => ctx.draft.autoWeld({ among: [c, beam], toGround: false, strength: k === weak ? strength * 0.3 : strength }));
  const pattern = paramStr<BracePattern>(ctx, 'brace', 'none');
  if (pattern !== 'none') {
    const t = param(ctx, 'braceT', 0.16);
    const bmat = paramStr<MaterialId>(ctx, 'braceMaterial', mat);
    const skip = Math.round(param(ctx, 'skipBay', -1));
    const alt = ctx.spec.braceDir === 'alt';
    for (let k = 0; k < n - 1; k++) {
      if (k === skip) continue;
      const dir = alt ? (k % 2 === 0 ? 1 : -1) : num(ctx.spec.braceDir, 1) >= 0 ? 1 : -1;
      idx.push(
        ...braceBay(ctx.draft, {
          x0: colX[k]!,
          x1: colX[k + 1]!,
          y0: ctx.baseY,
          y1: ctx.baseY + h,
          pattern,
          dir,
          t,
          material: bmat,
          strength: param(ctx, 'braceStrength', strength),
          densityScale: bmat === 'steel' ? 0.2 : 1,
          beamPen: beamH,
          floorPen: ctx.baseY > 0.001 ? 0.12 : 0,
        }),
      );
    }
  }
  return { parts: idx, top: ctx.baseY + h + beamH, width: w, x: ctx.x };
});
