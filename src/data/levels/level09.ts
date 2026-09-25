/**
 * Level 9 — "Counterweight".
 *
 * A steel tower crane standing FREE on its base (nothing bolts it to the ground). The long jib
 * reaches toward the turret with a load on its trolley; the short counter-jib points away, and
 * on its end sits the counterweight: a stack of concrete slabs, lightly pinned together. The
 * two moments cancel, so the crane's center of mass sits over its base and it shrugs off hits:
 * the mast is braced, and a hit on the jib or the mast only rocks it.
 *
 * Knock the upper slabs off the back of the counter-jib and nothing balances the jib any more:
 * the crane tips over its base and the jib, mast and load come crashing down toward you.
 *
 * The counterweight is sized by the module from the moments of every other part (`bias` =
 * residual lean, meters of center-of-mass offset), so the crane balances whatever the
 * dimensions; `d.meta.level09` reports how many slabs have to go before the crane tips.
 *
 * Tuning (npx tsx tools/level-lab.ts level09 --sweep full --brute 6 --stats mid|high):
 *  - see the notes next to the blueprint parameters below.
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
 *  base      steel undercarriage (`baseW` x `baseH`) resting loose on the ground, optional
 *            concrete ballast blocks on its ends (`ballastW` x `ballastH`, 0 = none)
 *  mast      two full-height steel legs (`mastW` outer width, `mastH` tall, `legW`) laced
 *            with X-bracing in `sections` bays and horizontals between them
 *  platform  slewing platform on the mast top, optional cathead post (`catH`, 0 = flat top)
 *  jib       Warren truss (`jibL` from the mast axis, `jibD` deep) with a trolley carrying a
 *            load block at `loadX`
 *  counter   steel box girder (`cjL` from the axis, `cjH` deep)
 *  cw        `slabs` concrete slabs (`cwW` wide, total height solved for balance) stacked on the
 *            counter-jib at `cwX`, resting on each other; each is pinned to the one below by a
 *            weld along a `pinSeam` lug that holds `pinStrength` x the slab's own weight
 */
registerModule('level09-crane', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const x0 = ctx.x;
  const g = DEFAULT_GRAVITY;
  const J = s.jibSide === 'left' || s.jibSide === -1 ? -1 : 1;
  /** x of a point `dx` meters out along the jib side (negative = counter-jib side). */
  const X = (dx: number) => x0 + J * dx;

  const baseW = n(s.baseW, 2.0);
  const baseH = n(s.baseH, 0.4);
  const baseDensity = n(s.baseDensity, 0.35);
  const ballastW = n(s.ballastW, 0);
  const ballastH = n(s.ballastH, 0.6);
  const mastW = n(s.mastW, 1.6);
  const mastH = n(s.mastH, 12.5);
  const legW = n(s.legW, 0.26);
  const sections = Math.max(2, Math.round(n(s.sections, 5)));
  const lacingT = n(s.lacingT, 0.1);
  const legDensity = n(s.legDensity, 0.1);
  const lacingDensity = n(s.lacingDensity, 0.1);
  const platW = n(s.platW, 2.0);
  const platH = n(s.platH, 0.45);
  const catW = n(s.catW, 0.3);
  const catH = n(s.catH, 0);
  const jibL = n(s.jibL, 12);
  const jibD = n(s.jibD, 1.0);
  const chordT = n(s.chordT, 0.16);
  const webT = n(s.webT, 0.14);
  const jibDensity = n(s.jibDensity, 0.15);
  const webDensity = n(s.webDensity, 0.3);
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
  const base = add(d.boxOn(x0, 0, baseW, baseH, 'steel', { id: 'base', densityScale: baseDensity }));
  const ballast: number[] = [];
  if (ballastW > 0) {
    for (const sx of [-1, 1]) {
      ballast.push(add(d.boxOn(x0 + sx * (baseW / 2 - ballastW / 2), baseH, ballastW, ballastH, 'concrete', { id: sx < 0 ? 'ballastL' : 'ballastR' })));
    }
    d.autoWeld({ among: [base, ...ballast], toGround: false, strength: 2 });
  }
  d.markLoose([base, ...ballast]);

  // ---- mast
  const y0 = baseH;
  const legX = mastW / 2 - legW / 2;
  const legs = [-1, 1].map((sx) => add(d.boxOn(x0 + sx * legX, y0, legW, mastH, 'steel', { id: sx < 0 ? 'legL' : 'legR', densityScale: legDensity })));
  for (const l of legs) d.weld(l, base, { at: [d.parts[l]!.x, y0], seam: legW * 2.5, strength: 3 });
  const secH = mastH / sections;
  const inner = mastW - 2 * legW;
  const lacing: number[] = [];
  for (let k = 1; k < sections; k++) {
    const h = add(d.box(x0, y0 + k * secH, inner, lacingT, 'steel', { densityScale: lacingDensity }));
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

  // ---- platform (+ optional cathead)
  const yTop = y0 + mastH;
  const plat = add(d.boxOn(x0, yTop, platW, platH, 'steel', { id: 'platform', densityScale: 0.2 }));
  for (const l of legs) d.weld(l, plat, { at: [d.parts[l]!.x, yTop], seam: legW * 2.5, strength: 3 });
  const pTop = yTop + platH;
  const cat = catH > 0 ? add(d.boxOn(x0, pTop, catW, catH, 'steel', { id: 'cathead', densityScale: 0.15 })) : -1;
  if (cat >= 0) d.weld(cat, plat, { at: [x0, pTop], seam: 1.0, strength: rootStrength });
  const half = cat >= 0 ? catW / 2 : 0;

  // ---- boom: ONE girder from the jib tip to the end of the counter-jib, resting on the platform.
  // The jib's truss stands on its jib side; the counterweight sits on its other end. Being one
  // rigid part, it balances the two moments internally: the platform only carries the difference.
  const boomH = n(s.boomH, 0.4);
  const boomL = jibL + cjL;
  const boom = add(d.boxOn(X((jibL - cjL) / 2), pTop, boomL, boomH, 'steel', { id: 'boom', densityScale: n(s.boomDensity, 0.15) }));
  d.weld(boom, plat, { at: [x0, pTop], seam: platW, strength: rootStrength });
  if (cat >= 0) d.weld(cat, boom, { at: [x0, pTop + boomH], seam: catW * 2, strength: rootStrength });
  const cj = boom;

  // ---- jib truss on the boom
  const jb = pTop + boomH; // truss bottom (top of the boom)
  const jw = jibL - half;
  const top = add(d.boxOn(X(half + jw / 2), jb + jibD - chordT, jw, chordT, 'steel', { id: 'jib.top', densityScale: jibDensity }));
  const webs: number[] = [];
  const ybn = jb - 0.06; // web ends sink into the boom
  const ytn = jb + jibD - chordT / 2;
  const e = chordT * 0.75;
  const px = (i: number) => X(half + e + (i * (jw - 2 * e)) / panels);
  const web = (xa: number, ya: number, xb: number, yb: number) => webs.push(add(d.strut(xa, ya, xb, yb, webT, 'steel', { densityScale: webDensity })));
  web(px(0), ybn, px(0), ytn);
  web(px(panels), ybn, px(panels), ytn);
  for (let i = 0; i < panels; i++) {
    if (i % 2 === 0) web(px(i), ybn, px(i + 1), ytn);
    else web(px(i), ytn, px(i + 1), ybn);
  }
  for (const w of webs) d.weldOverlaps(w, { among: [boom, top, ...webs], strength: 2, seam: webT * 2, minArea: 0.001 });
  if (cat >= 0) d.weld(top, cat, { at: [X(half), jb + jibD - chordT / 2], seam: 0.5, strength: rootStrength });
  // Load block welded straight under the boom near the tip: the trolley is drawn as a thin plate
  // on top of it. (A load hanging on a cable or a hook bar never comes to rest - pendulums have no
  // damping - and a light trolley between the boom and a heavy load keeps ringing.)
  if (loadW > 0 && loadH > 0) {
    const load = add(d.boxOn(X(loadX), pTop - loadH, loadW, loadH, 'concrete', { id: 'load', tags: ['weight'] }));
    d.weld(load, boom, { at: [X(loadX), pTop], seam: loadW, strength: 3 });
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
  // Want (mx + mcw * (hx - x0)) / (m + mcw) = bias * J  =>  mcw = (mx - bias * J * m) / (bias * J + J * cwX)
  const mcw = Math.max(200, (mx - bias * J * m) / (J * (bias + cwX)));
  const cwH = mcw / (cwW * MATERIALS.concrete.density);
  const nSlabs = Math.max(1, Math.round(n(s.slabs, 6)));
  const slabH = cwH / nSlabs;
  const slabM = mcw / nSlabs;
  const slabs: number[] = [];
  const hang = s.cwMode !== 'stack' && s.cwMode !== 'hook';
  // 'hang': a column of slabs hanging under the counter-jib, slab 0 at the top, each slab welded
  // under the one above along a `pinSeam` lug sized at `pinStrength` x the weight hanging from it.
  // 'stack': slabs resting on top of the counter-jib, slab 0 at the bottom, each lug holding
  // `pinStrength` x one slab's weight (contact carries the load).
  const yAt = (k: number) => (s.cwMode !== 'stack' ? pTop - (k + 1) * slabH : pTop + boomH + k * slabH);
  for (let k = 0; k < nSlabs; k++) slabs.push(add(d.boxOn(hx, yAt(k), cwW, slabH, 'concrete', { id: `counterweight.${k}`, tags: ['counterweight'] })));
  d.markLoose(slabs);
  const pinSeam = n(s.pinSeam, cwW);
  const tension = MATERIALS.concrete.bond.tension; // concrete is the weaker side of every bond here
  const hook = s.cwMode === 'hook';
  for (let k = 0; k < nSlabs; k++) {
    const carried = hang || hook ? slabM * (nSlabs - k) : slabM;
    const at: [number, number] = [hx, hang || hook ? pTop - k * slabH : pTop + boomH + k * slabH];
    if (hook && k === 0) {
      // 'hook': the whole column hangs from ONE brittle lug: plenty of strength in tension
      // (`hookStrength` x the column's weight) but a narrow seam (`hookSeam`) gives it little
      // bending strength, and a brittle bond (`hookBond`) lets it bend only a little before it
      // snaps. Hanging straight it carries no moment at all; swing the column hard and it goes.
      const bond = (s.hookBond as MaterialId) ?? 'stone';
      const seam = n(s.hookSeam, 0.2);
      const strength = +((n(s.hookStrength, 2) * carried * g) / (MATERIALS[bond].bond.tension * seam)).toFixed(3);
      d.weld(slabs[0]!, cj, { at, seam, strength, bond, tags: ['weakpoint'] });
      continue;
    }
    const factor = hook ? n(s.slabWeld, 4) : n(s.pinStrength, hang ? 1.4 : 1);
    const strength = +((factor * carried * g) / (tension * pinSeam)).toFixed(3);
    d.weld(slabs[k]!, k === 0 ? cj : slabs[k - 1]!, { at, seam: pinSeam, strength, tags: !hook && k < 3 ? ['weakpoint'] : undefined });
  }

  // Overturning check: tipping / restoring moment about the base edge once k slabs are gone
  // ('hang': everything below slab k-1; 'stack': the top k).
  const b = baseW / 2;
  d.meta.level09 = {
    counterweightKg: Math.round(mcw),
    slabKg: Math.round(slabM),
    counterweightH: +cwH.toFixed(2),
    craneKg: Math.round(m + mcw),
    tipWhenLost: slabs.map((_, k) => {
      const dm = slabM * (k + 1);
      return +((dm * cwX) / ((m + mcw - dm) * b)).toFixed(2);
    }),
  };

  return { parts, top: Math.max(pTop + catH, pTop + boomH + jibD, s.cwMode === 'stack' ? pTop + boomH + cwH : 0), width: baseW, x: x0 };
});

export const level09: LevelDef = {
  id: 'level09',
  name: 'Counterweight',
  subtitle: 'A free-standing crane, perfectly balanced. For now.',
  lesson: 'A crane stays upright because two moments cancel: take the counterweight away and the load on the jib wins, tipping the whole tower over its base.',
  hint: 'The mast is braced and the base will not budge. Knock the concrete slabs off the back of the short arm.',
  seed: 9,
  originX: 40,
  blueprint: {
    // Every joint is sized by hand: the load-down sizing pass reads the hanging slab column as a
    // stack standing on its bottom slab.
    autoSize: false,
    modules: [
      {
        type: 'level09-crane',
        boomDensity: 0.06,
        jibDensity: 0.1,
        webDensity: 0.2,
        cwW: 1.2,
        baseW: 1.8,
        pinStrength: 1.8,
      },
    ],
  },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineHeight: 7 },
  par: 2,
  reward: 580,
};
