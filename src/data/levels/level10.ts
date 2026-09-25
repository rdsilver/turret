/**
 * Level 10 — "The Citadel" (final exam).
 *
 * A concrete strongroom with the core inside it, battlements on its roof and a glass lantern
 * on top, cantilevered far out over the far edge of a tall braced steel tower. The tower stands
 * free on its plinth, and with the vault hanging out that far its center of mass sits outboard
 * of its base: on its own it would topple away from the turret. It stays up because two guy
 * cables tie its near leg back to the foot of ONE concrete anchor post. A second pair of guys on
 * the far side hangs slack: it only matters if the tower is pushed the other way.
 *
 * Everything the player is tempted to shoot is strong. The vault shrugs off hits and the core
 * inside is out of reach, the tower is braced, and a hit on the tower only stretches the taut
 * guys a little. The weakness is where every load path ends: the anchor post. Its fixing is
 * far stronger than the guys can pull, but brittle in bending; hit the post high, lever it
 * over, and the guys drag it away. The tower tips over its far edge and the vault drops fourteen
 * metres with the core inside.
 *
 * Tuning (npx tsx tools/level-lab.ts level10 --sweep full --brute 6 --stats mid|high):
 *  - The anchor fixing separates the two loads by MODE, not size. The guys pull on the post's
 *    foot, right at the weld, so the weld feels their pull (even under a barrage of high-stat hits
 *    on the vault, the guys' yield caps it) as a force and barely as a moment: peak ~110 kN*m.
 *    A direct hit on the post levers it about its foot: ~170 kN*m (base stats), ~250 (mid),
 *    ~370 (high). anchorMy 135 sits in between for every stat level; the weld's tension strength
 *    is 3 x the guys' combined yield, so the guys can never tear it off. Glass bond: 0.01 rad of
 *    plastic bending and it snaps. (Magnitude-based fixings - a weld weaker than a direct hit
 *    but stronger than the guys - never separated: the ball pushes the anchor the same way the
 *    guys pull it. A glass anchor shattered only when so light that the tower never settled.)
 *  - Base stats: only hits on the upper half of the post break it (lever arm). Mid: any hit on
 *    the post.
 *  - The vault is hollow-core (vaultDensity 0.45): at full density the tower rocked on its guys
 *    for more than the 2.5 s pre-settle. It still hangs 0.7 m of center of mass past the base
 *    edge, so once released the tower goes over in ~5-7 s.
 *  - anchorX -12 / midGuy 0.7: flatter, longer guys carry less for the same overturning moment
 *    (top guy ~95 kN at rest, yield 169 kN).
 *  - autoSize is off: every joint is sized here.
 */
import type { LevelDef } from '../../game/LevelDefinition';
import { DEFAULT_GRAVITY } from '../../config/constants';
import { registerModule } from '../../sim/generator/StructureGenerator';
import { braceBay } from '../../sim/generator/modules/bracing';
import { partMass } from '../../sim/generator/modules/sizing';
import { MATERIALS, type MaterialId } from '../../sim/Materials';

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

/**
 * The citadel. Definition space (x right, y up); the tower is centered on ctx.x.
 *
 *  plinth    static concrete footing (`plinthW` x `plinthH`), part of the ground
 *  tower     steel base beam (`baseW`) resting LOOSE on the plinth, two full-height legs (`towerW`
 *            outer width, `towerH` tall, `legW`), horizontals and X-lacing in `bays` bays, a ring
 *            beam on top
 *  vault     hollow-core concrete (`vaultDensity`): floor slab from `vaultL` left of the axis to
 *            `vaultR` right of it, end walls (`wallT` x `vaultH`), roof slab, `merlons` on the
 *            roof, a glass lantern (`lanternW` x `lanternH`), the core on the floor at `coreX`
 *  guys      two cables from the near leg (near the top and `midGuy` up the tower) to the foot of
 *            the anchor post, and two slack ones (`farSlack`) from the far leg to a far footing;
 *            yield `guyStrength` x the cable bond
 *  anchor    a concrete post (`anchorW` x `anchorH`) at `anchorX` whose only fixing is one
 *            brittle weld (`anchorBond`): `anchorWeld` x the guys' combined yield in tension,
 *            `anchorMy` kN*m in bending
 */
registerModule('level10-citadel', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const x0 = ctx.x;
  const g = DEFAULT_GRAVITY;

  const plinthW = n(s.plinthW, 5);
  const plinthH = n(s.plinthH, 0.6);
  const baseW = n(s.baseW, 2.4);
  const baseH = n(s.baseH, 0.4);
  const towerW = n(s.towerW, 2.7);
  const towerH = n(s.towerH, 11.5);
  const legW = n(s.legW, 0.3);
  const bays = Math.max(2, Math.round(n(s.bays, 4)));
  const lacingT = n(s.lacingT, 0.12);
  const ringH = n(s.ringH, 0.45);
  const vaultL = n(s.vaultL, 0.4);
  const vaultR = n(s.vaultR, 7.6);
  const floorT = n(s.floorT, 0.5);
  const roofT = n(s.roofT, 0.45);
  const wallT = n(s.wallT, 0.6);
  const vaultH = n(s.vaultH, 2.4);
  const vd = n(s.vaultDensity, 0.45);
  const coreSize = n(s.coreSize, 1.0);
  const coreX = n(s.coreX, 4.6);
  const anchorX = n(s.anchorX, -12);
  const anchorW = n(s.anchorW, 0.8);
  const anchorH = n(s.anchorH, 1.3);
  const midGuy = n(s.midGuy, 0.7);
  const guyStrength = n(s.guyStrength, 0.65);

  const parts: number[] = [];
  const add = (i: number) => (parts.push(i), i);

  // ---- plinth (static: part of the ground)
  add(d.boxOn(x0, 0, plinthW, plinthH, 'concrete', { id: 'plinth', tags: ['foundation'], fixed: true }));

  // ---- tower (free-standing on the plinth)
  const yb = plinthH;
  const base = add(d.boxOn(x0, yb, baseW, baseH, 'steel', { id: 'base', densityScale: n(s.baseDensity, 0.3) }));
  const y0 = yb + baseH;
  const legX = towerW / 2 - legW / 2;
  const legs = [-1, 1].map((sx) => add(d.boxOn(x0 + sx * legX, y0, legW, towerH, 'steel', { id: sx < 0 ? 'legL' : 'legR', densityScale: n(s.legDensity, 0.1) })));
  for (const l of legs) d.weld(l, base, { at: [d.parts[l]!.x, y0], seam: legW * 2.5, strength: 3 });
  const lacingDensity = n(s.lacingDensity, 0.12);
  const bayH = towerH / bays;
  const horiz: number[] = [];
  for (let k = 1; k < bays; k++) {
    const h = add(d.box(x0, y0 + k * bayH, towerW - 2 * legW, lacingT, 'steel', { densityScale: lacingDensity }));
    for (const l of legs) d.autoWeld({ among: [h, l], toGround: false, strength: 2 });
    horiz.push(h);
  }
  for (let k = 0; k < bays; k++) {
    const ya = y0 + k * bayH + (k === 0 ? 0.25 : lacingT / 2);
    const yc = y0 + (k + 1) * bayH - (k === bays - 1 ? 0.1 : lacingT / 2);
    const br = braceBay(d, { x0: x0 - legX, x1: x0 + legX, y0: ya, y1: yc, pattern: 'x', t: lacingT, material: 'steel', strength: 2, densityScale: lacingDensity, among: [...legs, ...horiz] });
    // The two diagonals of a bay cross: weld them to each other too.
    if (br.length === 2) d.weldOverlaps(br[0]!, { among: [br[1]!], strength: 2, seam: lacingT * 1.5 });
    for (const b of br) add(b);
  }
  const yRing = y0 + towerH;
  const ring = add(d.boxOn(x0, yRing, towerW + 0.3, ringH, 'steel', { id: 'ring', densityScale: 0.25 }));
  for (const l of legs) d.weld(l, ring, { at: [d.parts[l]!.x, yRing], seam: legW * 2.5, strength: 3 });

  // ---- vault
  const yv = yRing + ringH;
  const fx0 = x0 - vaultL;
  const fx1 = x0 + vaultR;
  const floor = add(d.boxOn((fx0 + fx1) / 2, yv, fx1 - fx0, floorT, 'concrete', { id: 'vault.floor', densityScale: vd }));
  d.weld(floor, ring, { at: [x0, yv], seam: towerW, strength: 3 });
  const yw = yv + floorT;
  const wallL = add(d.boxOn(fx0 + wallT / 2, yw, wallT, vaultH, 'concrete', { id: 'vault.wallL', densityScale: vd }));
  const wallR = add(d.boxOn(fx1 - wallT / 2, yw, wallT, vaultH, 'concrete', { id: 'vault.wallR', densityScale: vd }));
  const yr = yw + vaultH;
  const roof = add(d.boxOn((fx0 + fx1) / 2, yr, fx1 - fx0, roofT, 'concrete', { id: 'vault.roof', densityScale: vd }));
  for (const w of [wallL, wallR]) {
    d.weld(w, floor, { at: [d.parts[w]!.x, yw], seam: wallT, strength: 3 });
    d.weld(w, roof, { at: [d.parts[w]!.x, yr], seam: wallT, strength: 3 });
  }
  const core = add(d.boxOn(x0 + coreX, yw, coreSize, coreSize, 'core', { id: 'core', tags: ['core'] }));
  d.weld(core, floor, { at: [x0 + coreX, yw], seam: coreSize, strength: n(s.coreStrength, 1) });
  // Glass lantern on the roof: two steel posts, a steel cap, two glass panes standing between them.
  const lanternW = n(s.lanternW, 2.4);
  const lanternH = n(s.lanternH, 1.2);
  const lx = x0 + n(s.lanternX, 2.7);
  const yl = yr + roofT;
  if (lanternW > 0) {
    const postW = 0.16;
    const posts = [-1, 1].map((sx) => add(d.boxOn(lx + sx * (lanternW / 2 - postW / 2), yl, postW, lanternH, 'steel', { densityScale: 0.3 })));
    const cap = add(d.boxOn(lx, yl + lanternH, lanternW + 0.2, 0.18, 'steel', { id: 'lantern.cap', densityScale: 0.3 }));
    for (const p of posts) {
      d.weld(p, roof, { at: [d.parts[p]!.x, yl], seam: postW, strength: 2 });
      d.weld(p, cap, { at: [d.parts[p]!.x, yl + lanternH], seam: postW, strength: 2 });
    }
    const paneW = (lanternW - 2 * postW - 0.06) / 2;
    for (const sx of [-1, 1]) {
      const pane = add(d.boxOn(lx + sx * (paneW / 2 + 0.01), yl, paneW, lanternH - 0.04, 'glass', { tags: ['decor'], densityScale: 0.15 }));
      d.markLoose(pane);
    }
  }
  // Battlements: merlons along the roof, clear of the lantern.
  const merlonW = n(s.merlonW, 0.5);
  const merlonH = n(s.merlonH, 0.5);
  const merlons = Math.round(n(s.merlons, 5));
  for (let k = 0; k < merlons && merlonW > 0; k++) {
    const mx = fx0 + merlonW / 2 + (k * (fx1 - fx0 - merlonW)) / Math.max(1, merlons - 1);
    if (lanternW > 0 && Math.abs(mx - lx) < lanternW / 2 + merlonW / 2 + 0.1) continue;
    const mi = add(d.boxOn(mx, yl, merlonW, merlonH, 'concrete', { tags: ['decor'], densityScale: n(s.merlonDensity, 0.3) }));
    d.weld(mi, roof, { at: [mx, yl], seam: merlonW, strength: 2 });
  }

  // ---- anchor post, guys, far footing
  const ax = x0 + anchorX;
  const footA = add(d.boxOn(ax, 0, anchorW + 0.8, 0.3, 'concrete', { id: 'anchor.footing', tags: ['foundation'], fixed: true }));
  const anchor = add(d.boxOn(ax, 0.3, anchorW, anchorH, 'concrete', { id: 'anchor', tags: ['weakpoint'] }));
  d.markLoose(anchor);
  const legL = legs[0]!;
  const legR = legs[1]!;
  const guyYs = [yRing - 0.3, y0 + towerH * midGuy];
  const Ty = guyStrength * MATERIALS.cable.bond.tension;
  const foot: [number, number] = [ax, 0.3]; // the guys pull on the post's foot, at the weld
  for (const gy of guyYs) {
    const a: [number, number] = [d.parts[legL]!.x - legW / 2, gy];
    d.cable(legL, anchor, a, foot, { length: Math.hypot(a[0] - foot[0], a[1] - foot[1]) - n(s.guyPretension, 0.004), strength: guyStrength, tags: ['guy'] });
  }
  const farX = x0 + n(s.farAnchorX, 10);
  const footB = add(d.boxOn(farX, 0, anchorW + 0.8, 0.3, 'concrete', { id: 'farAnchor.footing', tags: ['foundation'], fixed: true }));
  const bTop: [number, number] = [farX, 0.3];
  for (const gy of guyYs) {
    const a: [number, number] = [d.parts[legR]!.x + legW / 2, gy];
    d.cable(legR, footB, a, bTop, { length: Math.hypot(a[0] - bTop[0], a[1] - bTop[1]) + n(s.farSlack, 0.06), strength: guyStrength, tags: ['guy'] });
  }
  // The anchor post's only fixing: strong in tension, modest and brittle in bending (see top).
  const bond = (s.anchorBond as MaterialId) ?? 'glass';
  const B = MATERIALS[bond].bond;
  const Fy = n(s.anchorWeld, 3) * 2 * Ty;
  const My = n(s.anchorMy, 135) * 1000;
  const seam = My / ((B.bend / B.tension) * Fy);
  d.weld(anchor, footA, { at: foot, seam: +seam.toFixed(4), strength: +(Fy / (B.tension * seam)).toFixed(3), bond, tags: ['weakpoint'] });

  // Meta: how far the center of mass hangs outboard of the base edge (m).
  let m = 0;
  let mx = 0;
  let vaultKg = 0;
  for (const i of parts) {
    const p = d.parts[i]!;
    if (p.fixed || i === anchor) continue;
    const pm = partMass(p);
    m += pm;
    mx += pm * (p.x - x0);
    if (p.y > yv - 0.01) vaultKg += pm;
  }
  const comX = mx / m;
  d.meta.level10 = { massKg: Math.round(m), vaultKg: Math.round(vaultKg), comX: +comX.toFixed(2), outboard: +(comX - baseW / 2).toFixed(2), tipKNm: +(((comX - baseW / 2) * m * g) / 1000).toFixed(1), guyYieldKN: +(Ty / 1000).toFixed(1) };

  return { parts, top: yl + lanternH + 0.18, width: plinthW, x: x0 };
});

export const level10: LevelDef = {
  id: 'level10',
  name: 'The Citadel',
  subtitle: 'A strongroom hung out over nothing, and two cables that say otherwise.',
  lesson: 'Every load path ends somewhere: find the one member all the forces funnel into, and the rest of the structure, however strong, falls with it.',
  hint: 'The vault hangs out past the tower base. Follow the two taut cables down: both end at the foot of one concrete post. Hit the post high.',
  seed: 10,
  originX: 40,
  blueprint: {
    autoSize: false,
    modules: [{ type: 'level10-citadel' }],
  },
  // The core rides the vault down: it has to end up on the ground (below 2 m).
  objective: { kind: 'coreDown', height: 2 },
  par: 2,
  reward: 640,
};
