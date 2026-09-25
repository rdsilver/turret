/**
 * Structural modules: foundation, column/pillar, tower, brace, truss,
 * platform/floor, roof, pyramid, wall. Registered on import.
 *
 * Definition space (y up). Each module sits on ctx.baseY centered on ctx.x,
 * welds its own internals and returns its top; the generator welds it to
 * the module below. See README.md in this folder for every parameter.
 */
import type { MaterialId } from '../../Materials';
import { param, paramBool, paramStr, registerModule, type ModuleContext, type ModuleFn, type ModuleResult } from '../StructureGenerator';
import { braceBay, type BracePattern } from './bracing';
import { clamp, idOf, jitter, matParam, num, onGround, polyAt, tagsOf } from './util';

/** Steel brace rods: much lighter than a solid 1 m deep steel slab. */
export const STEEL_ROD = 0.2;

/** Steel members are drawn solid but behave like hollow sections (a 1 m deep solid slab would weigh tonnes). */
function steelScale(mat: MaterialId, fallback = 1): number {
  return mat === 'steel' ? 0.4 : fallback;
}

// ------------------------------------------------------------ foundation

/**
 * Wide concrete footing. Params: w (default below width + 2), h (per step, 0.5),
 * steps (1), inset (per side per step, 0.5), material ('concrete'),
 * tag (true: parts tagged 'foundation', excluded from collapse accounting), fixed (false).
 */
registerModule('foundation', (ctx): ModuleResult => {
  const w = param(ctx, 'w', ctx.width + 2);
  const h = param(ctx, 'h', 0.5);
  const steps = Math.max(1, Math.round(param(ctx, 'steps', 1)));
  const inset = param(ctx, 'inset', 0.5);
  const mat = matParam(ctx, 'material', 'concrete');
  const tag = paramBool(ctx, 'tag', true);
  const fixed = paramBool(ctx, 'fixed', false);
  const idx: number[] = [];
  let y = ctx.baseY;
  let sw = w;
  for (let k = 0; k < steps; k++) {
    idx.push(ctx.draft.boxOn(ctx.x, y, sw, h, mat, { tags: tag ? tagsOf(ctx, 'foundation') : tagsOf(ctx), fixed, id: idOf(ctx, steps > 1 ? `s${k}` : undefined) }));
    y += h;
    if (k < steps - 1) sw = Math.max(0.6, sw - 2 * inset);
  }
  ctx.draft.autoWeld({ among: idx, toGround: onGround(ctx.baseY) });
  return { parts: idx, top: y, width: sw, x: ctx.x };
});

// ------------------------------------------------------------ column / pillar

/**
 * A single post. Params: w (0.4), h (3), material ('concrete' for column, 'stone' for pillar),
 * segments (1; stacked drums welded with `strength`), strength (1), dx (0),
 * capital (false: wider cap block on top), plinth (false: wider base block), capW (2 w), capH (0.3).
 */
function columnModule(defaultMat: MaterialId): ModuleFn {
  return (ctx) => {
    const w = param(ctx, 'w', 0.4);
    const h = param(ctx, 'h', 3);
    const mat = matParam(ctx, 'material', defaultMat);
    const segs = Math.max(1, Math.round(param(ctx, 'segments', 1)));
    const strength = param(ctx, 'strength', 1);
    const x = ctx.x + param(ctx, 'dx', 0);
    const capW = param(ctx, 'capW', w * 2);
    const capH = param(ctx, 'capH', 0.3);
    const idx: number[] = [];
    let y = ctx.baseY;
    if (paramBool(ctx, 'plinth', false)) {
      idx.push(ctx.draft.boxOn(x, y, capW, capH, mat, { tags: tagsOf(ctx) }));
      y += capH;
    }
    const shaftH = h - (paramBool(ctx, 'plinth', false) ? capH : 0) - (paramBool(ctx, 'capital', false) ? capH : 0);
    const segH = shaftH / segs;
    for (let k = 0; k < segs; k++) {
      idx.push(ctx.draft.boxOn(x, y, w, segH, mat, { tags: tagsOf(ctx), id: idOf(ctx, segs > 1 ? `d${k}` : undefined) }));
      y += segH;
    }
    let topW = w;
    if (paramBool(ctx, 'capital', false)) {
      idx.push(ctx.draft.boxOn(x, y, capW, capH, mat, { tags: tagsOf(ctx) }));
      y += capH;
      topW = capW;
    }
    ctx.draft.autoWeld({ among: idx, toGround: onGround(ctx.baseY), strength });
    return { parts: idx, top: y, width: topW, x };
  };
}
registerModule('column', columnModule('concrete'));
registerModule('pillar', columnModule('stone'));

// ------------------------------------------------------------ tower

/**
 * A stack of post-and-beam storeys. Params: storeys (3), w (below width, min 2), h (storey height 2.8),
 * columns (2), colW (0.35), beamH (0.3), material ('wood'), beamMaterial, strength (1),
 * taper (width lost per storey, m; 0), brace ('none'|'x'|'single'|'alt'|'chevron'|'v'),
 * braceFrom (first braced storey, 0), braceT (0.16), braceMaterial (material), braceStrength,
 * skipBrace (storey index left unbraced), weakStorey + weakColumn (joints of that column at 0.3 x),
 * glass (false: glass panes hung in unbraced bays — decorative, shatter when hit),
 * jitter (random column height/width variation, fraction; 0).
 */
registerModule('tower', (ctx): ModuleResult => {
  const storeys = Math.max(1, Math.round(param(ctx, 'storeys', 3)));
  const w0 = param(ctx, 'w', Math.max(2, ctx.width));
  const hs = param(ctx, 'h', 2.8);
  const n = Math.max(2, Math.round(param(ctx, 'columns', 2)));
  const colW = param(ctx, 'colW', 0.35);
  const beamH = param(ctx, 'beamH', 0.3);
  const mat = matParam(ctx, 'material', 'wood');
  const beamMat = matParam(ctx, 'beamMaterial', mat);
  const strength = param(ctx, 'strength', 1);
  const taper = param(ctx, 'taper', 0);
  const bracePat = paramStr<string>(ctx, 'brace', 'none');
  const braceFrom = Math.round(param(ctx, 'braceFrom', 0));
  const braceT = param(ctx, 'braceT', 0.16);
  const braceMat = matParam(ctx, 'braceMaterial', mat);
  const braceStrength = param(ctx, 'braceStrength', strength);
  const skipBrace = Math.round(param(ctx, 'skipBrace', -1));
  const weakStorey = Math.round(param(ctx, 'weakStorey', -1));
  const weakColumn = Math.round(param(ctx, 'weakColumn', weakStorey >= 0 ? 0 : -1));
  const glass = paramBool(ctx, 'glass', false);
  const jit = param(ctx, 'jitter', 0);
  const d = ctx.draft;
  const idx: number[] = [];
  let y = ctx.baseY;
  let w = w0;
  let floorPen = onGround(ctx.baseY) ? 0 : 0.12;
  let prevBeam = -1;
  for (let s = 0; s < storeys; s++) {
    const h = hs * (1 + jitter(ctx, jit));
    const cols: number[] = [];
    const colX: number[] = [];
    for (let k = 0; k < n; k++) {
      const x = ctx.x - w / 2 + colW / 2 + (k * (w - colW)) / (n - 1);
      const weak = s === weakStorey && k === weakColumn;
      const c = d.boxOn(x, y, colW, h, mat, { tags: weak ? tagsOf(ctx, 'weakpoint') : tagsOf(ctx), densityScale: steelScale(mat) });
      cols.push(c);
      colX.push(x);
      idx.push(c);
    }
    const beam = d.boxOn(ctx.x, y + h, w, beamH, beamMat, { tags: tagsOf(ctx), densityScale: steelScale(beamMat), id: idOf(ctx, `beam${s}`) });
    idx.push(beam);
    // Columns to beam (and to the beam below, which the previous storey created).
    cols.forEach((c, k) => {
      const weak = s === weakStorey && k === weakColumn;
      d.autoWeld({ among: [c, beam], toGround: false, strength: weak ? strength * 0.3 : strength });
      if (prevBeam >= 0) d.autoWeld({ among: [c, prevBeam], toGround: false, strength: weak ? strength * 0.3 : strength });
    });
    // Bracing.
    let pat: BracePattern = 'none';
    let dir: 1 | -1 = 1;
    if (s >= braceFrom && s !== skipBrace) {
      if (bracePat === 'alt') {
        pat = 'single';
        dir = s % 2 === 0 ? 1 : -1;
      } else if (bracePat === 'x' || bracePat === 'single' || bracePat === 'chevron' || bracePat === 'v') pat = bracePat;
    }
    for (let k = 0; k < n - 1; k++) {
      if (pat !== 'none') {
        idx.push(
          ...braceBay(d, {
            x0: colX[k]!,
            x1: colX[k + 1]!,
            y0: y,
            y1: y + h,
            pattern: pat,
            dir: n > 2 && bracePat === 'alt' ? (k % 2 === 0 ? dir : (-dir as 1 | -1)) : dir,
            t: braceT,
            material: braceMat,
            strength: braceStrength,
            densityScale: braceMat === 'steel' ? STEEL_ROD : 1,
            beamPen: beamH,
            floorPen,
            tags: tagsOf(ctx),
          }),
        );
      } else if (glass) {
        // Window pane standing loose on the storey floor (a thin sheet: densityScale 0.08).
        const gx0 = colX[k]! + colW / 2 + 0.06;
        const gx1 = colX[k + 1]! - colW / 2 - 0.06;
        if (gx1 - gx0 > 0.5 && h > 0.8) {
          const pane = d.boxOn((gx0 + gx1) / 2, y, gx1 - gx0, h - 0.12, 'glass', { tags: tagsOf(ctx, 'decor'), densityScale: 0.08 });
          d.markLoose(pane);
          idx.push(pane);
        }
      }
    }
    y += h + beamH;
    floorPen = 0.12;
    prevBeam = beam;
    if (s < storeys - 1) w = Math.max(colW * n + 0.6, w - taper);
  }
  if (onGround(ctx.baseY)) d.autoWeld({ among: idx, toGround: true, filter: (_a, b) => b === -1, strength });
  return { parts: idx, top: y, width: w, x: ctx.x };
});

// ------------------------------------------------------------ brace

/**
 * Diagonal bracing added to the bay(s) of the PREVIOUS module (a frame / tower storey / anything
 * with columns at its edges). Passive: the cursor does not move.
 * Params: pattern ('x' | 'single' | 'chevron' | 'v'; default 'x'), dir (1 | -1 for single),
 * t (0.16), material ('steel'), strength (1), colW (0.35: inset of the strut ends = column centerline),
 * bays (1: split the width into this many equal bays), y0 / y1 (bay floor / ceiling override;
 * default: previous module base .. previous top - beamH), beamH (0.3).
 */
registerModule('brace', (ctx): ModuleResult => {
  const prev = ctx.prev;
  const beamH = param(ctx, 'beamH', 0.3);
  const w = param(ctx, 'w', prev ? prev.width : ctx.width);
  const cx = prev ? prev.x + param(ctx, 'dx', 0) : ctx.x;
  const y0 = param(ctx, 'y0', prev ? prev.baseY : ctx.baseY);
  const y1 = param(ctx, 'y1', prev ? prev.top - beamH : ctx.baseY + 3);
  const colW = param(ctx, 'colW', 0.35);
  const bays = Math.max(1, Math.round(param(ctx, 'bays', 1)));
  const mat = matParam(ctx, 'material', 'steel');
  const pattern = paramStr<BracePattern>(ctx, 'pattern', 'x');
  const dir = num(ctx.spec.dir, 1) >= 0 ? 1 : -1;
  const parts: number[] = [];
  const left = cx - w / 2 + colW / 2;
  const span = (w - colW) / bays;
  for (let b = 0; b < bays; b++) {
    parts.push(
      ...braceBay(ctx.draft, {
        x0: left + b * span,
        x1: left + (b + 1) * span,
        y0,
        y1,
        pattern,
        dir,
        t: param(ctx, 't', 0.16),
        material: mat,
        strength: param(ctx, 'strength', 1),
        densityScale: mat === 'steel' ? STEEL_ROD : 1,
        beamPen: beamH,
        floorPen: onGround(y0) ? 0 : 0.12,
        tags: tagsOf(ctx),
      }),
    );
  }
  return { parts, top: ctx.baseY, width: ctx.width, x: ctx.x, passive: true };
});

// ------------------------------------------------------------ truss

/**
 * Planar truss spanning `w`. Params: w (below width), h (depth 1.2), panels (auto ~ w/h, even),
 * style ('warren' | 'pratt' | 'howe'), material ('steel'), chordT (0.18), webT (0.12),
 * strength (1), verticals (warren only: add verticals, false).
 * Steel members use densityScale 0.4 (hollow sections).
 */
registerModule('truss', (ctx): ModuleResult => {
  const w = param(ctx, 'w', ctx.width);
  const h = param(ctx, 'h', 1.2);
  const mat = matParam(ctx, 'material', 'steel');
  const style = paramStr<string>(ctx, 'style', 'warren');
  const chordT = param(ctx, 'chordT', 0.18);
  const webT = param(ctx, 'webT', 0.12);
  const strength = param(ctx, 'strength', 1);
  let panels = Math.max(2, Math.round(param(ctx, 'panels', Math.round(w / Math.max(0.6, h)))));
  if (style !== 'warren' && panels % 2 === 1) panels++;
  const ds = steelScale(mat);
  const d = ctx.draft;
  const x0 = ctx.x - w / 2;
  const bottom = d.boxOn(ctx.x, ctx.baseY, w, chordT, mat, { tags: tagsOf(ctx), densityScale: ds, id: idOf(ctx, 'bottom') });
  const top = d.boxOn(ctx.x, ctx.baseY + h - chordT, w, chordT, mat, { tags: tagsOf(ctx), densityScale: ds, id: idOf(ctx, 'top') });
  const chords = [bottom, top];
  const webs: number[] = [];
  const yb = ctx.baseY + chordT / 2;
  const yt = ctx.baseY + h - chordT / 2;
  const e = Math.max(webT, chordT) * 0.75; // keep end nodes inside the chord ends
  const px = (i: number) => x0 + e + (i * (w - 2 * e)) / panels;
  const web = (xa: number, ya: number, xb: number, yb2: number) => webs.push(d.strut(xa, ya, xb, yb2, webT, mat, { tags: tagsOf(ctx), densityScale: ds }));
  if (style === 'pratt' || style === 'howe') {
    for (let i = 0; i <= panels; i++) web(px(i), yb, px(i), yt);
    const mid = panels / 2;
    for (let i = 0; i < panels; i++) {
      const towardCenter = i < mid;
      // Pratt diagonals slope down toward the center (tension); Howe the opposite.
      const pratt = style === 'pratt';
      if (towardCenter === pratt) web(px(i), yt, px(i + 1), yb);
      else web(px(i), yb, px(i + 1), yt);
    }
  } else {
    // Warren: alternating diagonals, end verticals always (closes the ends).
    web(px(0), yb, px(0), yt);
    web(px(panels), yb, px(panels), yt);
    for (let i = 0; i < panels; i++) {
      if (i % 2 === 0) web(px(i), yb, px(i + 1), yt);
      else web(px(i), yt, px(i + 1), yb);
      if (paramBool(ctx, 'verticals', false) && i > 0) web(px(i), yb, px(i), yt);
    }
  }
  const all = [...chords, ...webs];
  for (const s of webs) d.weldOverlaps(s, { among: all, strength, seam: webT * 2, minArea: 0.001 });
  return { parts: all, top: ctx.baseY + h, width: w, x: ctx.x };
});

// ------------------------------------------------------------ platform / floor

/**
 * Horizontal deck. Params: w (below width + 2 overhang), h (0.3), material ('wood'),
 * overhang (0), planks (1: segments welded end to end), strength (1: plank-to-plank welds),
 * dx (0), parapet (false: short posts at both ends), weak (index of a plank seam at 0.3 x).
 */
function platformModule(ctx: ModuleContext): ModuleResult {
  const overhang = param(ctx, 'overhang', 0);
  const w = param(ctx, 'w', ctx.width + 2 * overhang);
  const h = param(ctx, 'h', 0.3);
  const mat = matParam(ctx, 'material', 'wood');
  const planks = Math.max(1, Math.round(param(ctx, 'planks', 1)));
  const strength = param(ctx, 'strength', 1);
  const weak = Math.round(param(ctx, 'weak', -1));
  const x = ctx.x + param(ctx, 'dx', 0);
  const d = ctx.draft;
  const idx: number[] = [];
  const pw = w / planks;
  for (let k = 0; k < planks; k++) {
    idx.push(d.boxOn(x - w / 2 + pw * (k + 0.5), ctx.baseY, pw, h, mat, { tags: tagsOf(ctx), densityScale: steelScale(mat), id: idOf(ctx, planks > 1 ? `p${k}` : undefined) }));
  }
  for (let k = 0; k < planks - 1; k++) {
    d.autoWeld({ among: [idx[k]!, idx[k + 1]!], toGround: false, strength: k === weak ? strength * 0.3 : strength });
  }
  let top = ctx.baseY + h;
  if (paramBool(ctx, 'parapet', false)) {
    const ph = param(ctx, 'parapetH', 0.8);
    const pwid = 0.2;
    for (const sx of [-1, 1]) {
      const p = d.boxOn(x + sx * (w / 2 - pwid / 2), top, pwid, ph, mat, { tags: tagsOf(ctx) });
      d.autoWeld({ among: [p, ...idx], toGround: false, strength });
      idx.push(p);
    }
  }
  if (onGround(ctx.baseY)) d.autoWeld({ among: idx, toGround: true, filter: (_a, b) => b === -1 });
  top = ctx.baseY + h;
  return { parts: idx, top, width: w, x };
}
registerModule('platform', platformModule);
registerModule('floor', platformModule);

// ------------------------------------------------------------ roof

/**
 * Roof. Params: style ('gable' | 'hip' | 'shed' | 'slab' | 'rafters'), w (below width + 2 overhang),
 * overhang (0.3), h (rise, default 0.3 w; slab: thickness 0.35), material ('wood'),
 * t (rafter / tie thickness 0.25), dir (shed: 1 = high side right), strength (1).
 */
registerModule('roof', (ctx): ModuleResult => {
  const style = paramStr<string>(ctx, 'style', 'gable');
  const overhang = param(ctx, 'overhang', 0.3);
  const w = param(ctx, 'w', ctx.width + 2 * overhang);
  const mat = matParam(ctx, 'material', 'wood');
  const d = ctx.draft;
  const b = ctx.baseY;
  const x = ctx.x + param(ctx, 'dx', 0);
  const tags = tagsOf(ctx);
  const id = idOf(ctx);
  const o = { tags, id, densityScale: steelScale(mat) };
  if (style === 'slab') {
    const h = param(ctx, 'h', 0.35);
    const i = d.boxOn(x, b, w, h, mat, o);
    return { parts: [i], top: b + h, width: w, x };
  }
  const h = param(ctx, 'h', w * 0.3);
  if (style === 'gable') {
    // Solid triangle, part origin at its centroid.
    const i = polyAt(d, x, b, [[-w / 2, 0], [w / 2, 0], [0, h]], mat, o);
    return { parts: [i], top: b + h, width: Math.min(1, w * 0.15), x };
  }
  if (style === 'hip') {
    const top = clamp(param(ctx, 'topW', w * 0.4), 0.4, w - 0.2);
    const i = polyAt(d, x, b, [[-w / 2, 0], [w / 2, 0], [top / 2, h], [-top / 2, h]], mat, o);
    return { parts: [i], top: b + h, width: top, x };
  }
  if (style === 'shed') {
    const dir = num(ctx.spec.dir, 1) >= 0 ? 1 : -1;
    const lo = param(ctx, 't', 0.3);
    const hi = Math.max(lo + 0.1, h);
    const pts: [number, number][] = dir > 0 ? [[-w / 2, 0], [w / 2, 0], [w / 2, hi], [-w / 2, lo]] : [[-w / 2, 0], [w / 2, 0], [w / 2, lo], [-w / 2, hi]];
    const i = polyAt(d, x, b, pts, mat, o);
    return { parts: [i], top: b + hi, width: w * 0.3, x };
  }
  // rafters: tie beam + two rafters (+ king post), welded where they overlap.
  const t = param(ctx, 't', 0.25);
  const strength = param(ctx, 'strength', 1);
  const tie = d.boxOn(x, b, w, t, mat, { tags, densityScale: steelScale(mat), id: idOf(ctx, 'tie') });
  const ridgeY = b + h - t / 2;
  const eaveY = b + t / 2;
  const r1 = d.strut(x - w / 2 + t, eaveY, x + t * 0.3, ridgeY, t, mat, { tags, densityScale: steelScale(mat) });
  const r2 = d.strut(x + w / 2 - t, eaveY, x - t * 0.3, ridgeY, t, mat, { tags, densityScale: steelScale(mat) });
  const parts = [tie, r1, r2];
  if (paramBool(ctx, 'kingPost', true) && h > 1.2) {
    const kp = d.boxOn(x, b + t, t * 0.8, h - t * 1.6, mat, { tags, densityScale: steelScale(mat) });
    parts.push(kp);
  }
  for (const p of parts.slice(1)) d.weldOverlaps(p, { among: parts, strength, seam: t * 1.5 });
  if (parts.length > 3) d.autoWeld({ among: [tie, parts[3]!], toGround: false, strength });
  return { parts, top: b + h, width: 0.6, x };
});

// ------------------------------------------------------------ pyramid

/**
 * Stepped pyramid of blocks. Params: levels (5), w (base width, default below width),
 * blockW (1.0 target block width), blockH (0.6), step (inset per side per level, blockW/2),
 * material ('stone'), mortar (0.6: weld strength between blocks, 0 = dry stacked),
 * minTop (1.0: stop when the row gets narrower), cap (false: 'weight'-like block on top, uses capMaterial).
 */
registerModule('pyramid', (ctx): ModuleResult => {
  const levels = Math.max(1, Math.round(param(ctx, 'levels', 5)));
  const w0 = param(ctx, 'w', Math.max(3, ctx.width));
  // Divisors are clamped: a zero size would make the block count infinite.
  const bw = Math.max(0.05, param(ctx, 'blockW', 1));
  const bh = param(ctx, 'blockH', 0.6);
  const step = param(ctx, 'step', bw / 2);
  const mat = matParam(ctx, 'material', 'stone');
  const mortar = param(ctx, 'mortar', 0.6);
  const minTop = param(ctx, 'minTop', 1);
  const d = ctx.draft;
  const idx: number[] = [];
  let y = ctx.baseY;
  let w = w0;
  let lastW = w;
  for (let l = 0; l < levels && w >= minTop - 1e-6; l++) {
    const n = Math.max(1, Math.round(w / bw));
    const bwl = w / n;
    for (let k = 0; k < n; k++) idx.push(d.boxOn(ctx.x - w / 2 + bwl * (k + 0.5), y, bwl, bh, mat, { tags: tagsOf(ctx) }));
    y += bh;
    lastW = w;
    w -= 2 * step;
  }
  if (mortar > 0) d.autoWeld({ among: idx, toGround: onGround(ctx.baseY), strength: mortar });
  else if (onGround(ctx.baseY)) d.autoWeld({ among: idx, toGround: true, filter: (_a, b) => b === -1 });
  return { parts: idx, top: y, width: lastW, x: ctx.x };
});

// ------------------------------------------------------------ wall

/**
 * Brick wall with running bond. Params: w (below width), h (2.4), brickW (0.8), brickH (0.4),
 * material ('stone'), mortar (0.5: weld strength, 0 = dry stacked), bond ('running' | 'stack'),
 * opening (0: width of a centered doorway/window gap), openingH (1.6), openingY (0: sill height),
 * lintel (material of the lintel over the opening, default 'concrete'), dx (0).
 */
registerModule('wall', (ctx): ModuleResult => {
  const w = param(ctx, 'w', ctx.width);
  // Divisors are clamped: a zero size would make the brick / course count infinite.
  const bh = Math.max(0.05, param(ctx, 'brickH', 0.4));
  const courses = Math.max(1, Math.round(param(ctx, 'h', 2.4) / bh));
  const bwTarget = Math.max(0.05, param(ctx, 'brickW', 0.8));
  const mat = matParam(ctx, 'material', 'stone');
  const mortar = param(ctx, 'mortar', 0.5);
  const running = paramStr<string>(ctx, 'bond', 'running') !== 'stack';
  const opening = param(ctx, 'opening', 0);
  const openH = param(ctx, 'openingH', 1.6);
  const openY = param(ctx, 'openingY', 0);
  const x = ctx.x + param(ctx, 'dx', 0);
  const d = ctx.draft;
  const n = Math.max(1, Math.round(w / bwTarget));
  const bw = w / n;
  const idx: number[] = [];
  const left = x - w / 2;
  const oL = x - opening / 2;
  const oR = x + opening / 2;
  let lintelCourse = -1;
  for (let c = 0; c < courses; c++) {
    const y = ctx.baseY + c * bh;
    // Course segments [x0, x1] in running bond.
    const cuts: number[] = [];
    const offset = running && c % 2 === 1 ? bw / 2 : 0;
    cuts.push(left);
    for (let k = 1; k <= n; k++) {
      const cx = left + offset + k * bw - (offset > 0 ? bw : 0);
      if (cx > left + 1e-6 && cx < left + w - 1e-6) cuts.push(cx);
    }
    cuts.push(left + w);
    const inOpening = opening > 0 && y + bh > ctx.baseY + openY + 1e-6 && y < ctx.baseY + openY + openH - 1e-6;
    if (opening > 0 && lintelCourse < 0 && y >= ctx.baseY + openY + openH - 1e-6) lintelCourse = c;
    for (let k = 0; k < cuts.length - 1; k++) {
      let a = cuts[k]!;
      let b = cuts[k + 1]!;
      if (inOpening) {
        if (b <= oL + 1e-6 || a >= oR - 1e-6) {
          /* outside the gap */
        } else if (a < oL && b > oL) b = oL;
        else if (a < oR && b > oR) a = oR;
        else continue;
        if (b - a < 0.12) continue;
      }
      if (lintelCourse === c && opening > 0 && a < oR + bw && b > oL - bw) continue; // lintel spot
      idx.push(d.boxOn((a + b) / 2, y, b - a, bh, mat, { tags: tagsOf(ctx) }));
    }
    if (lintelCourse === c && opening > 0) {
      // Lintel spans the opening plus the bricks skipped above, bearing on both jambs.
      let a = Infinity;
      let b = -Infinity;
      for (let k = 0; k < cuts.length - 1; k++) {
        if (cuts[k]! < oR + bw && cuts[k + 1]! > oL - bw) {
          a = Math.min(a, cuts[k]!);
          b = Math.max(b, cuts[k + 1]!);
        }
      }
      idx.push(d.boxOn((a + b) / 2, y, b - a, bh, matParam(ctx, 'lintel', 'concrete'), { tags: tagsOf(ctx, 'lintel') }));
    }
  }
  if (mortar > 0) d.autoWeld({ among: idx, toGround: onGround(ctx.baseY), strength: mortar });
  else if (onGround(ctx.baseY)) d.autoWeld({ among: idx, toGround: true, filter: (_a, b) => b === -1 });
  return { parts: idx, top: ctx.baseY + courses * bh, width: w, x };
});

export {};
