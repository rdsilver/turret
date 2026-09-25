/**
 * Level 7 — "Redundancy".
 *
 * A water tower built by the book: four concrete legs, three bays, every bay X-braced with steel,
 * joints sized well above their loads. Knock out a leg or a brace and the load simply walks
 * around the gap to the others; random shooting gets nowhere (it survives 15 random hits without
 * the drums).
 *
 * The weakness is not in the frame but in how it is used: the left bay of the ground floor was
 * left unbraced as a store, and two fuel drums stand in it at the foot of the legs that carry the
 * tank. A second stack of drums stands just outside. Set off the outside stack and the blast sets
 * off the drums inside: one chain reaction removes both left legs and the ground-floor bracing at
 * once — several load paths in one event, which no amount of redundancy covers. The frame drops,
 * leans left, and the tank comes down on top of it.
 */
import type { LevelDef } from '../../game/LevelDefinition';
import { registerModule } from '../../sim/generator/StructureGenerator';
import { braceBay } from '../../sim/generator/modules/bracing';
import type { MaterialId } from '../../sim/Materials';

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

/**
 * Ground storey of the tower: `cols` legs welded to the ground, a floor beam and X bracing in
 * every bay except `openBay` (left open as a store room). Params: w, h, cols, colW, beamH,
 * material, braceMaterial, braceT, strength (leg / beam welds), braceStrength.
 */
registerModule('level07-base', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const w = n(s.w, 9);
  const h = n(s.h, 3.2);
  const cols = Math.max(2, Math.round(n(s.cols, 4)));
  const colW = n(s.colW, 0.45);
  const beamH = n(s.beamH, 0.3);
  const openBay = Math.round(n(s.openBay, 0));
  const mat = (s.material as MaterialId) ?? 'concrete';
  const braceMat = (s.braceMaterial as MaterialId) ?? 'steel';
  const strength = n(s.strength, 1);
  const ds = mat === 'steel' ? 0.4 : 1;
  const x0 = ctx.x;
  const b = ctx.baseY;
  const parts: number[] = [];
  const xs: number[] = [];
  for (let k = 0; k < cols; k++) {
    const x = x0 - w / 2 + colW / 2 + (k * (w - colW)) / (cols - 1);
    xs.push(x);
    parts.push(d.boxOn(x, b, colW, h, mat, { densityScale: ds, id: `leg${k + 1}` }));
  }
  parts.push(d.boxOn(x0, b + h, w, beamH, mat, { densityScale: ds, id: 'floor1' }));
  d.autoWeld({ among: [...parts], toGround: true, strength });
  for (let k = 0; k < cols - 1; k++) {
    if (k === openBay) continue;
    parts.push(
      ...braceBay(d, {
        x0: xs[k]!,
        x1: xs[k + 1]!,
        y0: b,
        y1: b + h,
        pattern: 'x',
        t: n(s.braceT, 0.16),
        material: braceMat,
        strength: n(s.braceStrength, strength),
        densityScale: braceMat === 'steel' ? 0.2 : 1,
        beamPen: beamH,
        floorPen: 0,
      }),
    );
  }
  return { parts, top: b + h + beamH, width: w, x: x0 };
});

export const level07: LevelDef = {
  id: 'level07',
  name: 'Redundancy',
  subtitle: 'Four legs, every bay braced: it can lose any member you like. Pity about what is stored underneath.',
  lesson:
    'A redundant structure has spare load paths: knock out one leg or brace and the load simply moves to the others. But redundancy only covers one failure at a time. A chain reaction that takes out several load paths at once beats any amount of backup.',
  hint: 'Single hits just move the load to another leg. Look under the tank: set off the drums outside and they will set off the ones inside.',
  seed: 7,
  originX: 47,
  blueprint: {
    // Joints sized for 1.8 x their static load: nothing sits near yield at rest.
    autoSize: 1.8,
    modules: [
      { type: 'level07-base', w: 9, h: 3.2, cols: 4, colW: 0.45, openBay: 0, material: 'concrete', braceMaterial: 'steel', strength: 2 },
      { type: 'tower', storeys: 2, w: 9, columns: 4, h: 3.2, colW: 0.45, material: 'concrete', braceMaterial: 'steel', brace: 'x', strength: 3 },
      // The water tank: a steel box, ~17.6 t.
      { type: 'block', w: 5.5, h: 4, material: 'steel', densityScale: 0.2, id: 'tank' },
      // Drum stack outside the left leg (the fuse). Small drums (0.6 x 0.9, ~380 kg): even the
  // un-upgraded cannon kicks them past their trigger velocity.
      { type: 'explosiveBarrel', x: -6.2, y: 0, w: 0.6, h: 0.9, detached: true, id: 'fuse' },
      { type: 'explosiveBarrel', x: -6.2, y: 0.9, w: 0.6, h: 0.9, detached: true, id: 'fuse2' },
      // ... and two drums in the open store bay, at the foot of the legs (within blast range).
      { type: 'explosiveBarrel', x: -2.87, y: 0, w: 0.6, h: 0.9, count: 2, gap: 0.4, detached: true, id: 'drum' },
    ],
  },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineHeight: 5 },
  par: 2,
  reward: 460,
};
