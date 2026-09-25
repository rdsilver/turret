/**
 * Level 9 — "Counterweight".
 *
 * A steel tower crane standing FREE on its base: nothing bolts it to the ground. The long jib
 * reaches away from the turret with a load under its tip; the short counter-jib points at the
 * turret, and from its end hangs the counterweight, a column of concrete slabs on ONE hook.
 * The two moments cancel, so the crane's center of mass sits right over its narrow base and
 * it shrugs off hits: the mast is braced, the boom is one rigid girder, and a hit on the mast,
 * the jib or the top of the counterweight only rocks it.
 *
 * The hook is strong in tension but brittle in bending. Swing the counterweight hard - hit it
 * LOW, where the lever arm about the hook is longest - and it snaps off. Nine tonnes of concrete
 * drop out of the sky, nothing balances the jib any more, and the whole crane tips over its
 * base: the mast folds down, the jib and its load crash to the ground.
 *
 * The counterweight is sized by the module from the moments of every other part (`bias` =
 * residual lean, meters of center-of-mass offset), so the crane balances whatever the
 * dimensions; `d.meta.level09.tipWhenLost` reports the tipping / restoring moment ratio once the
 * counterweight is gone (> 1 = it goes over).
 *
 * Tuning (npx tsx tools/level-lab.ts level09 --sweep full --brute 6 --stats mid|high):
 *  - Welded (static) loads everywhere: a pendulum (a load on a cable, a counterweight on a
 *    pinned hanger bar) never comes to rest and the structure falls apart after the pre-settle,
 *    and a light part between two heavy ones (a trolley, a thin hanger plate) keeps ringing.
 *  - The boom is ONE part from jib tip to counter-jib end: with separate arms, the soft weld to
 *    the light platform let the counter-jib sag 7 degrees.
 *  - The hook: glass bond (brittle: 0.01 rad of plastic bending and it snaps), 2 x the column's
 *    weight in tension, seam 0.1 m (bending strength ~ seam). At rest it carries no moment. A
 *    mid-stats hit on the lower half of the column snaps it; hits on the upper half do not.
 *    Seam 0.14: only the bottom slab works; 0.08-0.1: the lower two.
 *  - Slabs 1.4 m wide: narrower columns hang lower and shield more of the crane, so aimed shots
 *    at the mast top and jib hit the counterweight on the way (with high stats that snaps it).
 *  - Light mast and base (legDensity 0.08, baseDensity 0.25, base 1.8 m wide): the lost
 *    counterweight must overwhelm the crane's own righting moment, and it does by ~3x.
 *  - autoSize is off: every joint is sized here (the load-down pass reads a hanging column as
 *    a stack standing on its bottom slab).
 */
import type { LevelDef } from '../../game/LevelDefinition';
import { DEFAULT_GRAVITY } from '../../config/constants';
import { registerModule } from '../../sim/generator/StructureGenerator';
import { braceBay } from '../../sim/generator/modules/bracing';
import { partMass } from '../../sim/generator/modules/sizing';
import { MATERIALS, type MaterialId } from '../../sim/Materials';

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

/**
 * Free-standing tower crane. Definition space (x right, y up); the mast is centered on ctx.x.
 * `jibSide` ('left' | 'right') picks where the jib points; the counter-jib points the other way.
 *
 *  base      steel undercarriage (`baseW` x `baseH`) resting loose on the ground
 *  mast      two full-height steel legs (`mastW` outer width, `mastH` tall, `legW`) laced
 *            with X-bracing in `sections` bays and horizontals between them
 *  platform  slewing platform on the mast top, a cathead post (`catH`, 0 = flat top) with
 *            pendant cables to the jib and the counter-jib
 *  boom      one steel girder (`boomH` deep) from the jib tip (`jibL` from the mast axis) to the
 *            end of the counter-jib (`cjL`); a Warren truss (`jibD` deep) stands on its jib side
 *            and a load block (`loadW` x `loadH`) hangs under it at `loadX`
 *  cw        `slabs` concrete slabs (`cwW` wide, total height solved for balance) hanging in a
 *            column at `cwX`, welded firmly to each other (`slabWeld` x the weight below) and
 *            hung from the boom by ONE brittle hook weld (`hookBond`, `hookSeam`,
 *            `hookStrength` x the column's weight)
 */
registerModule('level09-crane', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const x0 = ctx.x;
  const g = DEFAULT_GRAVITY;
  const J = s.jibSide === 'left' || s.jibSide === -1 ? -1 : 1;
  /** x of a point `dx` meters out along the jib side (negative = counter-jib side). */
  const X = (dx: number) => x0 + J * dx;

  const baseW = n(s.baseW, 1.8);
  const baseH = n(s.baseH, 0.4);
  const mastW = n(s.mastW, 1.6);
  const mastH = n(s.mastH, 12.5);
  const legW = n(s.legW, 0.26);
  const sections = Math.max(2, Math.round(n(s.sections, 5)));
  const lacingT = n(s.lacingT, 0.1);
  const lacingDensity = n(s.lacingDensity, 0.1);
  const platW = n(s.platW, 2.0);
  const platH = n(s.platH, 0.45);
  const catW = n(s.catW, 0.3);
  const catH = n(s.catH, 3.2);
  const boomH = n(s.boomH, 0.4);
  const jibL = n(s.jibL, 12);
  const jibD = n(s.jibD, 1.0);
  const chordT = n(s.chordT, 0.16);
  const webT = n(s.webT, 0.14);
  const panels = Math.max(2, Math.round(n(s.panels, 10)));
  const loadX = n(s.loadX, 10.8);
  const loadW = n(s.loadW, 0.8);
  const loadH = n(s.loadH, 0.7);
  const cjL = n(s.cjL, 6.5);
  const cwW = n(s.cwW, 1.4);
  const cwX = n(s.cwX, 5.6);
  const bias = n(s.bias, 0);
  const rootStrength = n(s.rootStrength, 3);

  const parts: number[] = [];
  const add = (i: number) => (parts.push(i), i);

  // ---- base (loose on the ground: the crane stands by its own weight)
  const base = add(d.boxOn(x0, 0, baseW, baseH, 'steel', { id: 'base', densityScale: n(s.baseDensity, 0.25) }));
  d.markLoose(base);

  // ---- mast
  const y0 = baseH;
  const legX = mastW / 2 - legW / 2;
  const legs = [-1, 1].map((sx) => add(d.boxOn(x0 + sx * legX, y0, legW, mastH, 'steel', { id: sx < 0 ? 'legL' : 'legR', densityScale: n(s.legDensity, 0.08) })));
  for (const l of legs) d.weld(l, base, { at: [d.parts[l]!.x, y0], seam: legW * 2.5, strength: 3 });
  const secH = mastH / sections;
  const lacing: number[] = [];
  for (let k = 1; k < sections; k++) {
    const h = add(d.box(x0, y0 + k * secH, mastW - 2 * legW, lacingT, 'steel', { densityScale: lacingDensity }));
    for (const l of legs) d.autoWeld({ among: [h, l], toGround: false, strength: 2 });
    lacing.push(h);
  }
  for (let k = 0; k < sections; k++) {
    const yb = y0 + k * secH + (k === 0 ? 0.25 : lacingT / 2);
    const yt = y0 + (k + 1) * secH - (k === sections - 1 ? 0.1 : lacingT / 2);
    const br = braceBay(d, { x0: x0 - legX, x1: x0 + legX, y0: yb, y1: yt, pattern: 'x', t: lacingT, material: 'steel', strength: 2, densityScale: lacingDensity, among: [...legs, ...lacing] });
    // The two diagonals of a bay cross: weld them to each other too.
    if (br.length === 2) d.weldOverlaps(br[0]!, { among: [br[1]!], strength: 2, seam: lacingT * 1.5 });
    for (const b of br) add(b);
  }

  // ---- platform
  const yTop = y0 + mastH;
  const plat = add(d.boxOn(x0, yTop, platW, platH, 'steel', { id: 'platform', densityScale: 0.2 }));
  for (const l of legs) d.weld(l, plat, { at: [d.parts[l]!.x, yTop], seam: legW * 2.5, strength: 3 });
  const pTop = yTop + platH;

  // ---- boom: ONE girder from the jib tip to the end of the counter-jib, resting on the platform.
  // Being one rigid part, it balances the two moments internally; the platform only carries the
  // difference.
  const boom = add(d.boxOn(X((jibL - cjL) / 2), pTop, jibL + cjL, boomH, 'steel', { id: 'boom', densityScale: n(s.boomDensity, 0.06) }));
  d.weld(boom, plat, { at: [x0, pTop], seam: platW, strength: rootStrength });
  const jb = pTop + boomH; // top of the boom

  // ---- cathead (optional)
  const cat = catH > 0 ? add(d.boxOn(x0, jb, catW, catH, 'steel', { id: 'cathead', densityScale: 0.15 })) : -1;
  if (cat >= 0) d.weld(cat, boom, { at: [x0, jb], seam: 1.0, strength: rootStrength });
  const half = cat >= 0 ? catW / 2 : 0;

  // ---- jib truss standing on the boom
  const jw = jibL - half;
  const top = add(d.boxOn(X(half + jw / 2), jb + jibD - chordT, jw, chordT, 'steel', { id: 'jib.top', densityScale: n(s.jibDensity, 0.1) }));
  const webs: number[] = [];
  const ybn = jb - 0.06; // web ends sink into the boom
  const ytn = jb + jibD - chordT / 2;
  const e = chordT * 0.75;
  const px = (i: number) => X(half + e + (i * (jw - 2 * e)) / panels);
  const webDensity = n(s.webDensity, 0.2);
  const web = (xa: number, ya: number, xb: number, yb: number) => webs.push(add(d.strut(xa, ya, xb, yb, webT, 'steel', { densityScale: webDensity })));
  web(px(0), ybn, px(0), ytn);
  web(px(panels), ybn, px(panels), ytn);
  for (let i = 0; i < panels; i++) {
    if (i % 2 === 0) web(px(i), ybn, px(i + 1), ytn);
    else web(px(i), ytn, px(i + 1), ybn);
  }
  for (const w of webs) d.weldOverlaps(w, { among: [boom, top, ...webs], strength: 2, seam: webT * 2, minArea: 0.001 });
  if (cat >= 0) d.weld(top, cat, { at: [X(half), jb + jibD - chordT / 2], seam: 0.5, strength: rootStrength });
  // Load block welded straight under the boom near the tip.
  if (loadW > 0 && loadH > 0) {
    const load = add(d.boxOn(X(loadX), pTop - loadH, loadW, loadH, 'concrete', { id: 'load', tags: ['weight'] }));
    d.weld(load, boom, { at: [X(loadX), pTop], seam: loadW, strength: 3 });
  }
  // Pendant cables: cathead top to the jib top chord and to the end of the counter-jib.
  if (cat >= 0 && s.pendants !== false) {
    const catTop = jb + catH - 0.15;
    for (const f of [0.55, 0.95]) {
      const a: [number, number] = [X(half + jw * f), jb + jibD];
      const c: [number, number] = [X(half), catTop];
      d.cable(top, cat, a, c, { length: Math.hypot(a[0] - c[0], a[1] - c[1]) - 0.004, strength: 1, tags: ['pendant'] });
    }
    const a: [number, number] = [X(-cjL + 0.3), jb];
    const c: [number, number] = [X(-half), catTop];
    d.cable(boom, cat, a, c, { length: Math.hypot(a[0] - c[0], a[1] - c[1]) - 0.004, strength: 1, tags: ['pendant'] });
  }

  // ---- counterweight: solve its mass so the moments about the mast axis cancel.
  let m = 0;
  let mx = 0;
  for (const i of parts) {
    const p = d.parts[i]!;
    const pm = partMass(p);
    m += pm;
    mx += pm * (p.x - x0);
  }
  const hx = X(-cwX);
  // Want (mx + mcw * (hx - x0)) / (m + mcw) = bias * J  =>  mcw = (mx - bias * J * m) / (J * (bias + cwX))
  const mcw = Math.max(200, (mx - bias * J * m) / (J * (bias + cwX)));
  const cwH = mcw / (cwW * MATERIALS.concrete.density);
  const nSlabs = Math.max(1, Math.round(n(s.slabs, 4)));
  const slabH = cwH / nSlabs;
  const slabM = mcw / nSlabs;
  const slabs: number[] = [];
  for (let k = 0; k < nSlabs; k++) slabs.push(add(d.boxOn(hx, pTop - (k + 1) * slabH, cwW, slabH, 'concrete', { id: `counterweight.${k}`, tags: ['counterweight'] })));
  d.markLoose(slabs);
  // The hook: plenty of tension strength, little bending strength, brittle.
  const hookBond = (s.hookBond as MaterialId) ?? 'glass';
  const hookSeam = n(s.hookSeam, 0.1);
  d.weld(slabs[0]!, boom, {
    at: [hx, pTop],
    seam: hookSeam,
    strength: +((n(s.hookStrength, 2) * mcw * g) / (MATERIALS[hookBond].bond.tension * hookSeam)).toFixed(3),
    bond: hookBond,
    tags: ['weakpoint'],
  });
  // Slab to slab: firm (the column swings as one piece).
  for (let k = 1; k < nSlabs; k++) {
    const carried = slabM * (nSlabs - k);
    const strength = +((n(s.slabWeld, 6) * carried * g) / (MATERIALS.concrete.bond.tension * cwW)).toFixed(3);
    d.weld(slabs[k]!, slabs[k - 1]!, { at: [hx, pTop - k * slabH], seam: cwW, strength });
  }

  // Overturning check: tipping / restoring moment about the base edge once the counterweight is gone.
  d.meta.level09 = {
    counterweightKg: Math.round(mcw),
    counterweightH: +cwH.toFixed(2),
    craneKg: Math.round(m + mcw),
    tipWhenLost: +((mcw * cwX) / (m * (baseW / 2))).toFixed(2),
  };

  return { parts, top: Math.max(jb + catH, jb + jibD), width: baseW, x: x0 };
});

export const level09: LevelDef = {
  id: 'level09',
  name: 'Counterweight',
  subtitle: 'Nothing holds this crane down. It is simply balanced.',
  lesson: 'A crane stays upright because two moments cancel: take the counterweight away and the load on the jib wins, tipping the whole tower over its base.',
  hint: 'The mast and the jib are solid. The counterweight hangs on one hook: hit it low and swing it off.',
  seed: 9,
  originX: 40,
  blueprint: {
    autoSize: false,
    modules: [{ type: 'level09-crane' }],
  },
  // Explicit line: the legs are single 12.5 m parts whose centers sit below it; what counts is the
  // boom, jib, counterweight and platform coming down.
  objective: { kind: 'massBelowLine', fraction: 0.6, lineHeight: 7 },
  par: 2,
  reward: 580,
};
