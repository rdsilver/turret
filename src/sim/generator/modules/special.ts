/**
 * Special-purpose modules: arch, counterweight, cantilever, pendulum,
 * cableStay, suspension, coreChamber, weight, explosiveBarrel / explosiveCrate.
 * Registered on import. See README.md in this folder for every parameter.
 */
import type { MaterialId } from '../../Materials';
import type { PartTag } from '../../StructureDefinition';
import { param, paramBool, paramStr, registerModule, type ModuleContext, type ModuleFn, type ModuleResult } from '../StructureGenerator';
import { idOf, matParam, num, onGround, polyAt, sideParam, supportAt, tagsOf } from './util';
import { partMass } from './sizing';
import { MATERIALS } from '../../Materials';
import { DEFAULT_GRAVITY } from '../../../config/constants';

/** Pre-tension so a cable starts engaged instead of dropping onto its rest length. */
const CABLE_PRETENSION = 0.004;

function steelScale(mat: MaterialId): number {
  return mat === 'steel' ? 0.4 : 1;
}

/**
 * Find what to hang from: the part whose top surface is at/below (x, y).
 * Returns the part index and the anchor point on its UNDERSIDE, or null.
 */
function hangPoint(ctx: ModuleContext, x: number, y: number): { part: number; ax: number; ay: number } | null {
  const s = supportAt(ctx, x, y, 1.5);
  if (s < 0) return null;
  const b = ctx.draft.bounds(s);
  return { part: s, ax: x, ay: b.minY };
}

/** x of the anchor for side-attached things: 'left' / 'right' end of the previous module, or dx from center. */
function anchorX(ctx: ModuleContext, inset: number): number {
  const at = ctx.spec.at;
  const cx = ctx.prev ? ctx.prev.x : ctx.x;
  const w = ctx.prev ? ctx.prev.width : ctx.width;
  if (at === 'left') return cx - w / 2 + inset;
  if (at === 'right') return cx + w / 2 - inset;
  return ctx.x + param(ctx, 'dx', 0);
}

// ------------------------------------------------------------ arch

/**
 * Voussoir arch between two abutments. Params: span (inner clear span 4), rise (span/2 =
 * semicircle; smaller = segmental with sloped skewbacks), t (ring thickness 0.6), voussoirs (9, odd),
 * material ('stone'), abutW (max(1.2, t + 0.6)), abutH (springing height 1.2), abutMaterial (material),
 * mortar (0 = dry, unwelded; > 0 = weld strength between voussoirs), deck (false: spandrel posts + deck),
 * deckT (0.35), deckMaterial ('wood'), postW (0.4).
 * The middle voussoir is tagged 'keystone' (+ id `<id>.key` when an id is given).
 */
registerModule('arch', (ctx): ModuleResult => {
  const span = param(ctx, 'span', 4);
  const r0 = span / 2;
  const rise = Math.min(param(ctx, 'rise', r0), r0);
  const t = param(ctx, 't', 0.6);
  let n = Math.max(3, Math.round(param(ctx, 'voussoirs', 9)));
  if (n % 2 === 0) n++;
  const mat = matParam(ctx, 'material', 'stone');
  const abutW = param(ctx, 'abutW', Math.max(1.2, t + 0.6));
  const abutH = param(ctx, 'abutH', 1.2);
  const abutMat = matParam(ctx, 'abutMaterial', mat);
  let mortar = param(ctx, 'mortar', 0);
  const d = ctx.draft;
  const b = ctx.baseY;
  const x = ctx.x;
  const springY = b + abutH;
  // Circle through both springing points with the requested rise.
  const r = (r0 * r0 + rise * rise) / (2 * rise);
  const R = r + t;
  const yc = springY + rise - r;
  const th0 = Math.asin(Math.max(0, Math.min(1, (r - rise) / r)));
  const c0 = Math.cos(th0);
  const s0 = Math.sin(th0);
  const tags = tagsOf(ctx);
  const parts: number[] = [];
  // Abutments.
  const xOut = Math.max(R * c0 + 0.05, r * c0 + abutW);
  const abut: number[] = [];
  for (const sx of [-1, 1]) {
    let i: number;
    if (th0 < 1e-3) {
      i = d.boxOn(x + sx * (r + (xOut - r) / 2), b, xOut - r, abutH, abutMat, { tags, id: idOf(ctx, sx < 0 ? 'abutL' : 'abutR') });
    } else {
      const pts: [number, number][] = [
        [r * c0, 0],
        [xOut, 0],
        [xOut, yc + R * s0 - b],
        [R * c0, yc + R * s0 - b],
        [r * c0, springY - b],
      ].map(([px, py]) => [sx * px!, py!] as [number, number]);
      i = polyAt(d, x, b, pts, abutMat, { tags, id: idOf(ctx, sx < 0 ? 'abutL' : 'abutR') });
    }
    abut.push(i);
    parts.push(i);
  }
  if (onGround(b)) d.autoWeld({ among: abut, toGround: true });
  // Voussoirs from the right springing (angle th0) to the left (PI - th0).
  const vs: number[] = [];
  const a0 = th0;
  const a1 = Math.PI - th0;
  const key = (n - 1) / 2;
  for (let k = 0; k < n; k++) {
    const ta = a0 + ((a1 - a0) * k) / n;
    const tb = a0 + ((a1 - a0) * (k + 1)) / n;
    const pts: [number, number][] = [
      [r * Math.cos(ta), yc - b + r * Math.sin(ta)],
      [R * Math.cos(ta), yc - b + R * Math.sin(ta)],
      [R * Math.cos(tb), yc - b + R * Math.sin(tb)],
      [r * Math.cos(tb), yc - b + r * Math.sin(tb)],
    ];
    const isKey = k === key;
    const i = polyAt(d, x, b, pts, mat, { tags: isKey ? tagsOf(ctx, 'keystone') : tags, id: isKey ? idOf(ctx, 'key') : undefined });
    vs.push(i);
    parts.push(i);
  }
  if (mortar > 0) {
    // Minimum mortar that holds the ring under its own thrust (weaker mortar cracks at the haunches).
    let ringMass = 0;
    for (const v of vs) ringMass += partMass(d.parts[v]!);
    const floor = (1.3 * (ringMass * DEFAULT_GRAVITY) / 4) / (MATERIALS[mat].bond.tension * t);
    mortar = Math.max(mortar, +floor.toFixed(2));
    for (let k = 0; k < n - 1; k++) {
      const ta = a0 + ((a1 - a0) * (k + 1)) / n;
      const rm = (r + R) / 2;
      d.weld(vs[k]!, vs[k + 1]!, { at: [x + rm * Math.cos(ta), yc + rm * Math.sin(ta)], seam: t, strength: mortar, tags: ['mortar'] });
    }
    d.weld(vs[0]!, abut[1]!, { at: [x + ((r + R) / 2) * c0, yc + ((r + R) / 2) * s0], seam: t, strength: mortar, tags: ['mortar'] });
    d.weld(vs[n - 1]!, abut[0]!, { at: [x - ((r + R) / 2) * c0, yc + ((r + R) / 2) * s0], seam: t, strength: mortar, tags: ['mortar'] });
  }
  // Dry voussoirs never receive automatic welds (they stand by thrust and friction).
  d.markLoose(vs);
  const half = (a1 - a0) / n / 2;
  const crownTop = yc + R * Math.cos(half);
  let top = crownTop;
  let width = xOut * 2;
  if (paramBool(ctx, 'deck', false)) {
    const deckT = param(ctx, 'deckT', 0.35);
    const postW = param(ctx, 'postW', 0.4);
    const deckMat = matParam(ctx, 'deckMaterial', 'wood');
    const abutTop = yc + R * s0; // outer edge height of the abutment
    const posts: number[] = [];
    for (const sx of [-1, 1]) {
      const px = x + sx * (xOut - postW / 2);
      if (Math.abs(px - x) - postW / 2 < R + 0.04) continue; // no room outboard of the ring
      posts.push(d.boxOn(px, abutTop, postW, crownTop - abutTop, deckMat, { tags }));
    }
    const deck = d.boxOn(x, crownTop, xOut * 2, deckT, deckMat, { tags, id: idOf(ctx, 'deck') });
    d.autoWeld({ among: [...posts, deck, ...abut], toGround: false });
    parts.push(...posts, deck);
    top = crownTop + deckT;
    width = xOut * 2;
  }
  return { parts, top, width, x };
});

// ------------------------------------------------------------ counterweight

/**
 * Heavy block tagged 'counterweight'. Params: w (1.2), h (1.0), material ('concrete'),
 * dx (0) or at ('left' | 'right': near that end of the previous module),
 * hang (0 = sits on top and advances the cursor; > 0 = hangs this many meters below the
 * underside of the part under the anchor, on a cable — passive), strength (cable strength 1).
 */
registerModule('counterweight', (ctx): ModuleResult => {
  const w = param(ctx, 'w', 1.2);
  const h = param(ctx, 'h', 1.0);
  const mat = matParam(ctx, 'material', 'concrete');
  const hang = param(ctx, 'hang', 0);
  const ax = anchorX(ctx, Math.max(0.3, w * 0.3));
  const tags = tagsOf(ctx, 'counterweight');
  if (hang <= 0) {
    const i = ctx.draft.boxOn(ax, ctx.baseY, w, h, mat, { tags, id: idOf(ctx) });
    return { parts: [i], top: ctx.baseY + h, width: w, x: ax };
  }
  const hp = hangPoint(ctx, ax, ctx.baseY);
  const topY = (hp ? hp.ay : ctx.baseY) - hang;
  const i = ctx.draft.boxOn(ax, topY - h, w, h, mat, { tags, id: idOf(ctx) });
  ctx.draft.markLoose(i);
  if (hp) {
    ctx.draft.cable(i, hp.part, [ax, topY], [ax, hp.ay], { length: hang - CABLE_PRETENSION, strength: param(ctx, 'strength', 1) });
  } else {
    ctx.draft.cable(i, 'ground', [ax, topY], [ax, ctx.baseY], { length: hang - CABLE_PRETENSION, strength: param(ctx, 'strength', 1) });
  }
  return { parts: [i], top: ctx.baseY, width: ctx.width, x: ctx.x, passive: true };
});

// ------------------------------------------------------------ cantilever

/**
 * Beam projecting from a support. Params: w (beam length 5), overhang (projection beyond the
 * support face, 3), side ('right' | 'left'), beamH (0.35), material ('wood'),
 * support ('auto' | 'column' | 'none'; auto = own column when on the ground, else the module below),
 * supportW (0.6), supportH (3), supportMaterial (material), tipLoad (0: size of a block at the tip),
 * tipMaterial ('concrete'), knee (false: diagonal knee brace under the beam), strength (1).
 */
registerModule('cantilever', (ctx): ModuleResult => {
  const w = param(ctx, 'w', 5);
  const overhang = Math.min(param(ctx, 'overhang', 3), w - 0.4);
  const side = sideParam(ctx, 'side', 1);
  const beamH = param(ctx, 'beamH', 0.35);
  const mat = matParam(ctx, 'material', 'wood');
  const supMode = paramStr<string>(ctx, 'support', 'auto');
  const ownSupport = supMode === 'column' || (supMode === 'auto' && onGround(ctx.baseY));
  const supW = param(ctx, 'supportW', 0.6);
  const supH = param(ctx, 'supportH', 3);
  const supMat = matParam(ctx, 'supportMaterial', mat);
  const strength = param(ctx, 'strength', 1);
  const d = ctx.draft;
  const parts: number[] = [];
  let y = ctx.baseY;
  let face: number; // x of the support face the beam projects from
  let sup = -1;
  if (ownSupport) {
    sup = d.boxOn(ctx.x, y, supW, supH, supMat, { tags: tagsOf(ctx), id: idOf(ctx, 'support') });
    parts.push(sup);
    y += supH;
    face = ctx.x + side * (supW / 2);
  } else {
    face = ctx.x + side * (ctx.width / 2);
  }
  const tip = face + side * overhang;
  const bx = tip - side * (w / 2);
  const beam = d.boxOn(bx, y, w, beamH, mat, { tags: tagsOf(ctx), id: idOf(ctx, 'beam'), densityScale: steelScale(mat) });
  parts.push(beam);
  if (sup >= 0) d.autoWeld({ among: [sup, beam], toGround: onGround(ctx.baseY), strength });
  if (paramBool(ctx, 'knee', false) && sup >= 0) {
    const kt = 0.16;
    const reach = Math.min(overhang * 0.6, supH * 0.7);
    const k = d.strut(ctx.x, y - reach, face + side * reach, y + beamH * 0.4, kt, mat, { tags: tagsOf(ctx) });
    d.weldOverlaps(k, { among: [sup, beam], strength, seam: kt * 1.5 });
    parts.push(k);
  }
  let top = y + beamH;
  const tipLoad = param(ctx, 'tipLoad', 0);
  if (tipLoad > 0) {
    const tm = matParam(ctx, 'tipMaterial', 'concrete');
    const tl = d.boxOn(tip - side * (tipLoad / 2), top, tipLoad, tipLoad, tm, { tags: tagsOf(ctx, 'counterweight') });
    d.autoWeld({ among: [tl, beam], toGround: false, strength });
    parts.push(tl);
  }
  return { parts, top, width: w, x: bx };
});

// ------------------------------------------------------------ pendulum

/**
 * A weight swinging from a support. Params: len (3: cable/rod length), r (0.5: bob radius),
 * material ('steel'), mode ('cable' | 'rod'), support ('auto' | 'gantry' | 'none'; auto = gantry on
 * the ground, else hang from the part under the anchor), gantryW (2.6), postW (0.35),
 * supportMaterial ('wood'), dx / at (anchor, see counterweight), clearance (0.4 above the base).
 */
registerModule('pendulum', (ctx): ModuleResult => {
  const len = param(ctx, 'len', 3);
  const r = param(ctx, 'r', 0.5);
  const mat = matParam(ctx, 'material', 'steel');
  const mode = paramStr<string>(ctx, 'mode', 'cable');
  const supMode = paramStr<string>(ctx, 'support', 'auto');
  const gantry = supMode === 'gantry' || (supMode === 'auto' && onGround(ctx.baseY));
  const d = ctx.draft;
  const parts: number[] = [];
  const tags = tagsOf(ctx);
  let ax = anchorX(ctx, 0.5);
  let ay: number;
  let holder: number | 'ground';
  let top = ctx.baseY;
  let passive = true;
  if (gantry) {
    const gw = param(ctx, 'gantryW', 2.6);
    const postW = param(ctx, 'postW', 0.35);
    const beamH = 0.35;
    const clearance = param(ctx, 'clearance', 0.4);
    const postH = clearance + 2 * r + len;
    const smat = matParam(ctx, 'supportMaterial', 'wood');
    ax = ctx.x;
    const p1 = d.boxOn(ctx.x - gw / 2 + postW / 2, ctx.baseY, postW, postH, smat, { tags });
    const p2 = d.boxOn(ctx.x + gw / 2 - postW / 2, ctx.baseY, postW, postH, smat, { tags });
    const beam = d.boxOn(ctx.x, ctx.baseY + postH, gw, beamH, smat, { tags });
    d.autoWeld({ among: [p1, p2, beam], toGround: onGround(ctx.baseY) });
    parts.push(p1, p2, beam);
    ay = ctx.baseY + postH;
    holder = beam;
    top = ay + beamH;
    passive = false;
  } else {
    const hp = hangPoint(ctx, ax, ctx.baseY);
    ay = hp ? hp.ay : ctx.baseY;
    holder = hp ? hp.part : 'ground';
  }
  const by = ay - len - r;
  const bob = d.circle(ax, by, r, mat, { tags: tagsOf(ctx, 'pendulum'), id: idOf(ctx, 'bob') });
  d.markLoose(bob);
  parts.push(bob);
  if (mode === 'rod') {
    const rt = Math.min(0.12, r * 0.4);
    const rod = d.strut(ax, ay - 0.05, ax, by, rt, 'steel', { tags, densityScale: 0.4 });
    d.markLoose(rod);
    // Steel bracket + pin: sized for the bob, not for the thin rod section.
    d.weld(bob, rod, { at: [ax, by + r * 0.5], seam: 0.3, bond: 'steel' });
    d.hinge(rod, holder, [ax, ay - 0.02], { seam: 0.3, bond: 'steel' });
    parts.push(rod);
  } else {
    d.cable(bob, holder, [ax, by + r], [ax, ay], { length: len - CABLE_PRETENSION, strength: param(ctx, 'strength', 1) });
  }
  return { parts, top, width: gantry ? param(ctx, 'gantryW', 2.6) : ctx.width, x: gantry ? ctx.x : ctx.x, passive };
});

// ------------------------------------------------------------ cable-stayed deck

/**
 * Deck held by stay cables from a central mast. Params: span (12: total deck length),
 * deckY (2.5: deck underside above base), deckT (0.35), segments (3 per side), material ('wood' deck),
 * mastH (5: above the deck), mastW (0.5), mastMaterial ('concrete'), pierW (0.5), pierMaterial (mastMaterial),
 * style ('fan' | 'harp'), cableStrength (1), strength (deck welds, 1), weakCable (index of a cable at 0.35 x).
 */
registerModule('cableStay', (ctx): ModuleResult => {
  const span = param(ctx, 'span', 12);
  const deckY = param(ctx, 'deckY', 2.5);
  const deckT = param(ctx, 'deckT', 0.35);
  const segs = Math.max(1, Math.round(param(ctx, 'segments', 3)));
  const mat = matParam(ctx, 'material', 'wood');
  const mastH = param(ctx, 'mastH', 5);
  const mastW = param(ctx, 'mastW', 0.5);
  const mastMat = matParam(ctx, 'mastMaterial', 'concrete');
  const pierW = param(ctx, 'pierW', 0.5);
  const pierMat = matParam(ctx, 'pierMaterial', mastMat);
  const style = paramStr<string>(ctx, 'style', 'fan');
  const cableStrength = param(ctx, 'cableStrength', 1);
  const strength = param(ctx, 'strength', 1);
  const weakCable = Math.round(param(ctx, 'weakCable', -1));
  const d = ctx.draft;
  const b = ctx.baseY;
  const x = ctx.x;
  const tags = tagsOf(ctx);
  const deckBot = b + deckY;
  const deckTop = deckBot + deckT;
  const mastTop = deckTop + mastH;
  const mast = d.boxOn(x, b, mastW, mastTop - b, mastMat, { tags, id: idOf(ctx, 'mast'), densityScale: steelScale(mastMat) });
  const parts = [mast];
  const piers: number[] = [];
  let cableIdx = 0;
  for (const sx of [-1, 1]) {
    const inner = x + sx * (mastW / 2);
    const outer = x + sx * (span / 2);
    const segL = Math.abs(outer - inner) / segs;
    const deck: number[] = [];
    for (let k = 0; k < segs; k++) {
      const cx = inner + sx * segL * (k + 0.5);
      deck.push(d.boxOn(cx, deckBot, segL, deckT, mat, { tags, densityScale: steelScale(mat) }));
    }
    const pier = d.boxOn(outer - sx * (pierW / 2), b, pierW, deckY, pierMat, { tags, densityScale: steelScale(pierMat) });
    piers.push(pier);
    parts.push(...deck, pier);
    d.autoWeld({ among: [mast, ...deck, pier], toGround: false, strength });
    // One stay per segment, anchored at the segment's outer end (top face).
    for (let k = 0; k < segs; k++) {
      const dxA = inner + sx * segL * (k + 0.85);
      const frac = (k + 1) / segs;
      const mastY = style === 'harp' ? deckTop + 0.8 + (mastH - 1.0) * frac : mastTop - 0.25 - 0.3 * (segs - 1 - k) * 0.5;
      const mx = x + sx * (mastW / 2);
      const len = Math.hypot(mx - dxA, mastY - deckTop);
      d.cable(deck[k]!, mast, [dxA, deckTop], [mx, mastY], {
        length: len - CABLE_PRETENSION,
        strength: cableIdx === weakCable ? cableStrength * 0.35 : cableStrength,
        tags: cableIdx === weakCable ? ['weakpoint'] : undefined,
      });
      cableIdx++;
    }
  }
  if (onGround(b)) d.autoWeld({ among: [mast, ...piers], toGround: true, filter: (_a, bb) => bb === -1 });
  return { parts, top: deckTop, width: span, x };
});

// ------------------------------------------------------------ suspension

/**
 * Suspension bridge: two pylons, a sagging chain of hinged steel links, vertical hanger cables and a
 * segmented deck. Params: span (14: pylon to pylon), deckY (2.5), deckT (0.3), segments (6 deck
 * segments), material ('wood' deck), pylonH (5 above the deck), pylonW (0.6), pylonMaterial ('concrete'),
 * sag (low point of the chain above the deck top, 0.8), linkT (0.12), strength (1), cableStrength (1),
 * backstay (horizontal distance of the ground anchors behind each pylon, max(2.5, 0.7 pylonH); 0 = none).
 */
registerModule('suspension', (ctx): ModuleResult => {
  const span = param(ctx, 'span', 14);
  const deckY = param(ctx, 'deckY', 2.5);
  const deckT = param(ctx, 'deckT', 0.3);
  const segs = Math.max(2, Math.round(param(ctx, 'segments', 6)));
  const mat = matParam(ctx, 'material', 'wood');
  const pylonH = param(ctx, 'pylonH', 5);
  const pylonW = param(ctx, 'pylonW', 0.6);
  const pylonMat = matParam(ctx, 'pylonMaterial', 'concrete');
  const sag = param(ctx, 'sag', 0.8);
  const linkT = param(ctx, 'linkT', 0.12);
  const strength = param(ctx, 'strength', 1);
  const cableStrength = param(ctx, 'cableStrength', 1);
  const d = ctx.draft;
  const b = ctx.baseY;
  const x = ctx.x;
  const tags = tagsOf(ctx);
  const deckBot = b + deckY;
  const deckTop = deckBot + deckT;
  const pyTop = deckTop + pylonH;
  const pylons: number[] = [];
  for (const sx of [-1, 1]) pylons.push(d.boxOn(x + sx * (span / 2 + pylonW / 2), b, pylonW, pyTop - b, pylonMat, { tags, densityScale: steelScale(pylonMat) }));
  const parts = [...pylons];
  // Deck between the pylon faces, welded to them and to each other.
  const segL = span / segs;
  const deck: number[] = [];
  for (let k = 0; k < segs; k++) deck.push(d.boxOn(x - span / 2 + segL * (k + 0.5), deckBot, segL, deckT, mat, { tags, densityScale: steelScale(mat) }));
  parts.push(...deck);
  d.autoWeld({ among: [...pylons, ...deck], toGround: false, strength });
  // Chain: parabola from pylon top to pylon top, one node above every deck joint.
  const yLow = deckTop + sag;
  const yHigh = pyTop - 0.3;
  const nodeX = (k: number) => x - span / 2 + segL * k;
  const nodeY = (k: number) => {
    const u = (nodeX(k) - x) / (span / 2);
    return yLow + (yHigh - yLow) * u * u;
  };
  const gap = 0.04;
  const links: number[] = [];
  for (let k = 0; k < segs; k++) {
    const xa = nodeX(k);
    const ya = nodeY(k);
    const xb = nodeX(k + 1);
    const yb = nodeY(k + 1);
    const L = Math.hypot(xb - xa, yb - ya);
    const ux = (xb - xa) / L;
    const uy = (yb - ya) / L;
    links.push(d.strut(xa + ux * gap, ya + uy * gap, xb - ux * gap, yb - uy * gap, linkT, 'steel', { tags, densityScale: 0.4 }));
  }
  d.markLoose(links);
  parts.push(...links);
  // Steel pins (the link section is thin; the pin brackets are not).
  const pin = { strength: cableStrength, seam: 0.4, bond: 'steel' as const };
  d.hinge(links[0]!, pylons[0]!, [nodeX(0), nodeY(0)], pin);
  d.hinge(links[segs - 1]!, pylons[1]!, [nodeX(segs), nodeY(segs)], pin);
  for (let k = 0; k < segs - 1; k++) d.hinge(links[k]!, links[k + 1]!, [nodeX(k + 1), nodeY(k + 1)], pin);
  // Backstays: pylon tops tied back to ground anchors so the chain pull does not topple them.
  const back = param(ctx, 'backstay', Math.max(2.5, pylonH * 0.7));
  if (back > 0) {
    for (const [k, sx] of [[0, -1], [1, 1]] as const) {
      const px = x + sx * (span / 2 + pylonW);
      const gx = px + sx * back;
      const len = Math.hypot(gx - px, yHigh - b);
      d.cable(pylons[k]!, 'ground', [px, yHigh], [gx, b], { length: len - CABLE_PRETENSION, strength: cableStrength * 1.5, tags: ['backstay'] });
    }
  }
  // Hangers from interior chain nodes down to the deck joint below.
  for (let k = 1; k < segs; k++) {
    const hx = nodeX(k);
    const hy = nodeY(k);
    const len = hy - deckTop;
    d.cable(deck[k]!, links[k]!, [hx + 0.05, deckTop], [hx + 0.05, hy], { length: len - CABLE_PRETENSION, strength: cableStrength });
  }
  if (onGround(b)) d.autoWeld({ among: pylons, toGround: true, filter: (_a, bb) => bb === -1 });
  return { parts, top: deckTop, width: span, x };
});

// ------------------------------------------------------------ core chamber

/**
 * Protected box around a part tagged 'core'. Params: w (3), h (interior height 2.0), wallT (0.35),
 * material ('concrete'), coreSize (0.9), coreMaterial ('core'), weldCore (true: weak weld to the floor),
 * roof (true), open ('none' | 'left' | 'right': that side wall becomes a slim corner post), wallMaterial (material; 'glass'
 * gives windows), dx (0). The core gets id `<id>.core` (or 'core' when no id is given and it is the first).
 */
registerModule('coreChamber', (ctx): ModuleResult => {
  const w = param(ctx, 'w', 3);
  const h = param(ctx, 'h', 2.0);
  const wt = param(ctx, 'wallT', 0.35);
  const mat = matParam(ctx, 'material', 'concrete');
  const wallMat = matParam(ctx, 'wallMaterial', mat);
  const cs = param(ctx, 'coreSize', 0.9);
  const coreMat = matParam(ctx, 'coreMaterial', 'core');
  const open = paramStr<string>(ctx, 'open', 'none');
  const x = ctx.x + param(ctx, 'dx', 0);
  const d = ctx.draft;
  const tags = tagsOf(ctx);
  const b = ctx.baseY;
  const floor = d.boxOn(x, b, w, wt, mat, { tags, id: idOf(ctx, 'floor') });
  const shell = [floor];
  for (const sx of [-1, 1]) {
    const isOpen = (open === 'left' && sx < 0) || (open === 'right' && sx > 0);
    // An open side keeps a slim corner post so the roof stays supported.
    const ww = isOpen ? Math.min(0.22, wt) : wt;
    shell.push(d.boxOn(x + sx * (w / 2 - ww / 2), b + wt, ww, h, isOpen ? mat : wallMat, { tags }));
  }
  let top = b + wt + h;
  if (paramBool(ctx, 'roof', true)) {
    shell.push(d.boxOn(x, top, w, wt, mat, { tags, id: idOf(ctx, 'roof') }));
    top += wt;
  }
  d.autoWeld({ among: shell, toGround: onGround(b) });
  const hasCoreId = d.parts.some((p) => p.id === 'core');
  const core = d.boxOn(x, b + wt, cs, Math.min(cs, h - 0.1), coreMat, { tags: tagsOf(ctx, 'core'), id: idOf(ctx, 'core') ?? (hasCoreId ? undefined : 'core') });
  d.markLoose(core);
  if (paramBool(ctx, 'weldCore', true)) d.weld(core, floor, { at: [x, b + wt], seam: cs, strength: param(ctx, 'coreStrength', 0.5) });
  return { parts: [...shell, core], top, width: w, x };
});

// ------------------------------------------------------------ weight

/**
 * Big mass. Params: w (1.6), h (1.2), material ('concrete'), dx (0),
 * balanced (false: stands UNWELDED on a narrow pedestal), pedestalW (0.35), pedestalH (1.2),
 * pedestalMaterial ('wood'). Tagged 'weight'.
 */
registerModule('weight', (ctx): ModuleResult => {
  const w = param(ctx, 'w', 1.6);
  const h = param(ctx, 'h', 1.2);
  const mat = matParam(ctx, 'material', 'concrete');
  const x = ctx.x + param(ctx, 'dx', 0);
  const d = ctx.draft;
  const parts: number[] = [];
  let y = ctx.baseY;
  const balanced = paramBool(ctx, 'balanced', false);
  if (balanced) {
    const pw = param(ctx, 'pedestalW', 0.35);
    const ph = param(ctx, 'pedestalH', 1.2);
    const ped = d.boxOn(x, y, pw, ph, matParam(ctx, 'pedestalMaterial', 'wood'), { tags: tagsOf(ctx), id: idOf(ctx, 'pedestal') });
    if (onGround(y)) d.autoWeld({ among: [ped], toGround: true });
    parts.push(ped);
    y += ph;
  }
  const wgt = d.boxOn(x, y, w, h, mat, { tags: tagsOf(ctx, 'weight'), id: idOf(ctx) });
  if (balanced) d.markLoose(wgt);
  parts.push(wgt);
  return { parts, top: y + h, width: w, x };
});

// ------------------------------------------------------------ explosives

/**
 * Explosive props (material 'explosive': detonate when hit hard, caught in a blast or dropped).
 * Params: count (1), gap (0.25), dx (0), w / h (barrel 0.7 x 1.0, crate 0.9 x 0.9),
 * material ('explosive'), weld (false: loose, resting by friction), inside (false: stand on the FLOOR
 * of the previous module instead of on its top), stack (false: advance the cursor like a storey).
 */
function explosiveModule(kind: 'barrel' | 'crate'): ModuleFn {
  return (ctx) => {
    const w = param(ctx, 'w', kind === 'barrel' ? 0.7 : 0.9);
    const h = param(ctx, 'h', kind === 'barrel' ? 1.0 : 0.9);
    const count = Math.max(1, Math.round(param(ctx, 'count', 1)));
    const gap = param(ctx, 'gap', 0.25);
    const mat = matParam(ctx, 'material', 'explosive');
    const inside = paramBool(ctx, 'inside', false) && ctx.prev !== null && ctx.spec.y === undefined;
    const b = inside ? ctx.prev!.baseY : ctx.baseY;
    const cx = ctx.x + num(ctx.spec.dx, 0);
    const d = ctx.draft;
    const parts: number[] = [];
    const total = count * w + (count - 1) * gap;
    const tagList: PartTag[] = [kind];
    for (let k = 0; k < count; k++) {
      const x = cx - total / 2 + w / 2 + k * (w + gap);
      parts.push(d.boxOn(x, b, w, h, mat, { tags: tagsOf(ctx, ...tagList), id: idOf(ctx, count > 1 ? String(k) : undefined) }));
    }
    if (!paramBool(ctx, 'weld', false)) d.markLoose(parts);
    const stack = paramBool(ctx, 'stack', false);
    return stack ? { parts, top: b + h, width: total, x: cx } : { parts, top: ctx.baseY, width: ctx.width, x: ctx.x, passive: true };
  };
}
registerModule('explosiveBarrel', explosiveModule('barrel'));
registerModule('explosiveCrate', explosiveModule('crate'));
registerModule('barrel', explosiveModule('barrel'));
registerModule('crate', explosiveModule('crate'));

export {};
