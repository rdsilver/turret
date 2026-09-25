/**
 * Level 5 — "Wide Base".
 *
 * A smooth-sided concrete ziggurat, nine and a half metres wide, mortared block by block
 * and far stronger than anything the cannon can do to it. On its summit: one slender
 * timber mast, and on the mast a steel water tank under a timber roof.
 *
 * The base is overbuilt; the top was built with what was left. Shots at the ziggurat chip
 * nothing and roll back down its slopes. The tank is the heaviest thing up high and the
 * mast is held only by the weld at its foot, so a direct hit on the upper mast or on the
 * tank tips it: the foot weld yields, the mast leans, gravity takes over (the further it
 * leans, the harder the tank pulls), and the tank topples down the far slope and bursts.
 * With the base cannon the first high hit cracks the foot weld and the second one tips it.
 *
 * Tuning (npx tsx tools/level-lab.ts level05 --sweep full --brute 6 --stats mid|base):
 *  - Ziggurat: concrete, clean running bond, mortar 1. The outer block of each row is a
 *    wedge and a capstone carries the slope up to the mast socket, so the silhouette is
 *    one straight slope with no ledge. On a stepped pyramid spent balls come to rest on
 *    the ledges, and a body the physics world force-sleeps while it touches an awake stack
 *    sinks through it and blows the stack apart (core bug, reported to the lead). Stone
 *    mortar also let hits knock blocks loose; concrete does not.
 *  - Mast foot: its weld seam (stemSeam 0.22) is half the mast width. That halves the
 *    bending strength without touching the load capacity. Weaker = more winners lower on
 *    the mast.
 *  - Tank mass (tankDensity) sets how hard the top is to push over. Lighter adds winners
 *    on the tank walls and the mid-mast; heavier leaves only the upper mast. Mid-campaign
 *    stats saturate at about 11 of 92 aims (every direct hit high on the tower).
 *  - Tank welds are weak (tankStrength 0.3), so the tank bursts open when it lands.
 */
import type { LevelDef } from '../../game/LevelDefinition';
import { registerModule } from '../../sim/generator/StructureGenerator';
import { polyAt } from '../../sim/generator/modules/util';
import type { MaterialId } from '../../sim/Materials';

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

/**
 * A smooth-sided ziggurat of mortared blocks in running bond: row k has `blocks - k`
 * blocks of width `blockW`, each row inset by half a block. The two outer blocks of every
 * row are wedges cut to one straight slope, so a spent cannonball rolls off instead of
 * parking on a ledge.
 */
registerModule('level05-ziggurat', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const rows = Math.max(1, Math.round(n(s.rows, 6)));
  const n0 = Math.max(rows + 1, Math.round(n(s.blocks, 8)));
  const bw = n(s.blockW, 1.2);
  const bh = n(s.blockH, 0.7);
  const mat = (s.material as MaterialId) ?? 'concrete';
  const mortar = n(s.mortar, 1);
  const parts: number[] = [];
  let y = ctx.baseY;
  let topW = bw;
  for (let k = 0; k < rows; k++) {
    const count = n0 - k;
    const w = count * bw;
    const left = ctx.x - w / 2;
    for (let i = 0; i < count; i++) {
      const x0 = left + i * bw;
      if (i === 0) {
        // Left wedge: bottom edge [x0, x0 + bw], top edge [x0 + bw / 2, x0 + bw].
        parts.push(polyAt(d, x0, y, [[0, 0], [bw, 0], [bw, bh], [bw / 2, bh]], mat));
      } else if (i === count - 1) {
        parts.push(polyAt(d, x0, y, [[0, 0], [bw, 0], [bw / 2, bh], [0, bh]], mat));
      } else {
        parts.push(d.boxOn(x0 + bw / 2, y, bw, bh, mat));
      }
    }
    y += bh;
    topW = w - bw;
  }
  d.autoWeld({ among: parts, toGround: ctx.baseY <= 0.001, strength: mortar });
  return { parts, top: y, width: topW, x: ctx.x };
});

/**
 * Capstone, mast and water tank. The mast is welded to the capstone (`stemSeam`, `stemStrength`)
 * and to the tank floor; the tank is a box (floor, two walls, lid) under a timber hip roof,
 * its own welds at `tankStrength`.
 */
registerModule('level05-watertower', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const x = ctx.x;
  const capW = n(s.capW, 2.4);
  const capTop = n(s.capTop, 0.9);
  const capH = n(s.capH, 0.875);
  const stemW = n(s.stemW, 0.45);
  const stemH = n(s.stemH, 5.5);
  const stemMat = (s.stemMat as MaterialId) ?? 'wood';
  const stemSeam = n(s.stemSeam, 0.22);
  const stemStrength = n(s.stemStrength, 0.4);
  const topSeam = n(s.topSeam, stemSeam);
  const tankW = n(s.tankW, 3.4);
  const tankH = n(s.tankH, 2.0);
  const wallT = n(s.wallT, 0.25);
  const floorH = n(s.floorH, 0.3);
  const tankMat = (s.tankMat as MaterialId) ?? 'steel';
  const tankDensity = n(s.tankDensity, 0.13);
  const tankStrength = n(s.tankStrength, 0.3);
  const roofH = n(s.roofH, 1.0);
  const parts: number[] = [];
  let y = ctx.baseY;

  // Capstone: a trapezoid continuing the ziggurat's slope up to the mast socket. Its top is
  // barely wider than the mast, so there is no ledge a spent ball can rest on.
  const cap = polyAt(d, x, y, [[-capW / 2, 0], [capW / 2, 0], [capTop / 2, capH], [-capTop / 2, capH]], 'concrete', { id: 'capstone' });
  parts.push(cap);
  y += capH;

  const mast = d.boxOn(x, y, stemW, stemH, stemMat, { id: 'mast', tags: ['weakpoint'] });
  parts.push(mast);
  d.weld(mast, cap, { at: [x, y], seam: stemSeam, strength: stemStrength, tags: ['weakpoint'] });
  y += stemH;

  const shell = { densityScale: tankDensity };
  const floor = d.boxOn(x, y, tankW, floorH, tankMat, { id: 'tank.floor', ...shell });
  d.weld(floor, mast, { at: [x, y], seam: topSeam });
  parts.push(floor);
  y += floorH;
  const wl = d.boxOn(x - tankW / 2 + wallT / 2, y, wallT, tankH, tankMat, { id: 'tank.wallL', ...shell });
  const wr = d.boxOn(x + tankW / 2 - wallT / 2, y, wallT, tankH, tankMat, { id: 'tank.wallR', ...shell });
  parts.push(wl, wr);
  y += tankH;
  const lid = d.boxOn(x, y, tankW, floorH, tankMat, { id: 'tank.lid', ...shell });
  parts.push(lid);
  y += floorH;
  const rw = tankW + 0.4;
  const roof = polyAt(d, x, y, [[-rw / 2, 0], [rw / 2, 0], [0.35, roofH], [-0.35, roofH]], 'wood', { id: 'tank.roof' });
  parts.push(roof);
  d.autoWeld({ among: [floor, wl, wr, lid, roof], toGround: false, strength: tankStrength });
  y += roofH;
  return { parts, top: y, width: tankW, x };
});

export const level05: LevelDef = {
  id: 'level05',
  name: 'Wide Base',
  subtitle: 'A fortune in concrete at the bottom. One wooden pole at the top.',
  lesson: 'A wide base only steadies what sits low: a heavy load on a slender mast topples once it leans, and the higher you push, the longer your lever.',
  hint: 'The ziggurat will outlast your cannon. Aim high and straight: the top of the mast, or the tank itself.',
  seed: 5,
  originX: 40,
  blueprint: {
    modules: [
      { type: 'level05-ziggurat', rows: 6, blocks: 8, blockW: 1.2, blockH: 0.7, material: 'concrete', mortar: 1 },
      { type: 'level05-watertower' },
    ],
  },
  // Explicit line (above the ziggurat and the mast foot): Structure.height0 uses bounding
  // radii, which the wide tank inflates. Everything above it is the mast and the tank.
  objective: { kind: 'massBelowLine', fraction: 0.6, lineHeight: 6 },
  par: 2,
  reward: 340,
};
