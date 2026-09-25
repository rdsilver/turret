/**
 * Level 3 — Balancing Act.
 *
 * A two-storey timber frame whose floors hang between the posts on their end welds, a slender
 * glass pillar standing on the top floor, and a tall concrete block balanced loose on the
 * pillar. Shatter the pillar (or shove the block off its perch) and five and a half tonnes drop
 * onto a floor that was only ever sized to carry them at rest: the block punches through both
 * floors one after the other and the frame folds outward.
 *
 * Tuning notes (npx tsx tools/level-lab.ts level03 --sweep full --brute 6 --stats base):
 *  - The pillar is thin-walled glass (densityScale 0.3): light enough that a direct hit
 *    shatters it, heavy enough that the loose block does not creep off it while settling
 *    (at 0.15 the block slid ~6 cm during the pre-settle and pulled its tether taut).
 *  - Posts and floors are welded at interModuleStrength 4, so shots at the frame only rattle
 *    it; the floors' end welds are what the falling block overwhelms.
 *  - The footing is static: a block landing on a dynamic footing broke its ground weld and
 *    pushed it into the ground.
 */
import type { LevelDef } from '../../game/LevelDefinition';
import { registerModule } from '../../sim/generator/StructureGenerator';

const H = 5.6; // post height above the footing
const W = 3.9; // outer width of the frame
const POST = 0.45;
const GAP = W - 2 * POST; // the floors span between the posts' inner faces

/** The glass pillar and the block balanced on it (the block stands loose and is tethered). */
registerModule('level03-perch', (ctx) => {
  const d = ctx.draft;
  const pw = Number(ctx.spec.pillarW ?? 0.32);
  const ph = Number(ctx.spec.pillarH ?? 2.2);
  const ww = Number(ctx.spec.w ?? 1.2);
  const wh = Number(ctx.spec.h ?? 2.2);
  const density = Number(ctx.spec.pillarDensity ?? 0.3);
  const pillar = d.boxOn(ctx.x, ctx.baseY, pw, ph, 'glass', { id: 'pillar', tags: ['weakpoint'], densityScale: density });
  const weight = d.boxOn(ctx.x, ctx.baseY + ph, ww, wh, 'concrete', { id: 'weight', tags: ['weight'] });
  d.markLoose(weight);
  return { parts: [pillar, weight], top: ctx.baseY + ph + wh, width: ww, x: ctx.x };
});

export const level03: LevelDef = {
  id: 'level03',
  name: 'Balancing Act',
  subtitle: 'Five and a half tonnes of concrete on a glass pillar',
  lesson: 'When the whole load path runs through one slender part, that part is the building, and a dropped load hits far harder than a resting one.',
  hint: 'Leave the frame alone. Shatter the glass pillar, or knock the block off its perch.',
  seed: 3,
  originX: 40,
  blueprint: {
    interModuleStrength: 4,
    modules: [
      { type: 'foundation', w: 6, fixed: true },
      { type: 'column', x: -(W - POST) / 2, w: POST, h: H, material: 'wood', detached: true },
      { type: 'column', x: (W - POST) / 2, w: POST, h: H, material: 'wood', detached: true },
      {
        type: 'parts',
        x: 0,
        parts: [
          { x: 0, y: H / 2 - 0.15, w: GAP, h: 0.3, material: 'wood', id: 'floor1' },
          { x: 0, y: H - 0.225, w: GAP, h: 0.45, material: 'wood', id: 'floor2' },
        ],
      },
      { type: 'level03-perch', x: 0, pillarW: 0.32, pillarH: 2.2, w: 1.2, h: 2.2, pillarDensity: 0.3 },
    ],
  },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 220,
};
