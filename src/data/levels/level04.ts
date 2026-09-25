/**
 * Level 4 — Load-Bearing Beam.
 *
 * A two-storey timber frame stands on one steel transfer beam. The beam is pinned to the inner
 * edge of a concrete core under the right half of the building and its free left end stands on
 * a single slender timber post. The building's centre of mass sits just outboard of the pin, so
 * the post only carries a modest share of the load, but it is the only thing stopping the whole
 * top from rotating off the core. Knock the post out and the beam swings down, the frame racks
 * and the upper storeys pour off the podium. Shots at the frame mostly just knock it about.
 *
 * Tuning notes (npx tsx tools/level-lab.ts level04 --sweep full --brute 6 --stats base):
 *  - The post stands in its slot on pins across 3 cm gaps (no bearing contact), so its load
 *    goes through its joints (it shows up in the stress view) and friction cannot pin it:
 *    a direct hit shears the pins and throws the light (densityScale 0.5) post clear. A
 *    bearing post was pinned by friction and just got wedged back under the beam.
 *  - coreW sets how far the pin sits from the centre of mass: 4.4+ and only the post wins;
 *    4.25 and hits on the frame start tipping the building too.
 *  - The core is static (it is the podium, effectively ground): a dynamic core got yanked
 *    off its footing by the falling building through the pin.
 */
import type { LevelDef } from '../../game/LevelDefinition';
import { registerModule } from '../../sim/generator/StructureGenerator';
import type { MaterialId } from '../../sim/Materials';

/** Concrete core (right), transfer beam across the full width (pinned to the core), post (left). */
registerModule('level04-podium', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const num = (k: string, v: number) => (typeof s[k] === 'number' ? (s[k] as number) : v);
  const W = num('w', 10);
  const H = num('h', 3.2);
  const coreW = num('coreW', 4.3);
  const postW = num('postW', 0.35);
  const gap = num('gap', 0.03);
  const postStrength = num('postStrength', 1.5);
  const beamH = num('beamH', 0.5);
  const beamMat = (s.beamMaterial as MaterialId) ?? 'steel';
  const x = ctx.x;
  const y0 = ctx.baseY;
  const coreX = x + W / 2 - coreW / 2;
  const core = d.boxOn(coreX, y0, coreW, H, 'concrete', { id: 'core', fixed: true, tags: ['foundation'] });
  const postX = x - W / 2 + postW / 2;
  const post = d.boxOn(postX, y0 + gap, postW, H - 2 * gap, 'wood', { id: 'post', tags: ['weakpoint'], densityScale: num('postDensity', 0.5) });
  const beam = d.boxOn(x, y0 + H, W, beamH, beamMat, { id: 'beam', densityScale: beamMat === 'steel' ? num('beamDensity', 0.12) : 1 });
  // The beam is pinned on the core's inner top edge and otherwise just rests on the core.
  d.hinge(beam, core, [coreX - coreW / 2, y0 + H], { seam: 0.4, strength: num('pivotStrength', 3) });
  // The post is pinned to the beam and welded to the footing across small gaps: all of its load
  // goes through those joints, none through bearing contact.
  d.hinge(post, beam, [postX, y0 + H - gap / 2], { seam: postW, strength: postStrength, tags: ['weakpoint'] });
  const footing = ctx.prev ? ctx.prev.parts[ctx.prev.parts.length - 1]! : -1;
  if (footing >= 0) d.weld(post, footing, { at: [postX, y0 + gap / 2], seam: postW, strength: postStrength, tags: ['weakpoint'] });
  else d.weld(post, 'ground', { at: [postX, y0 + gap / 2], seam: postW, strength: postStrength, tags: ['weakpoint'] });
  return { parts: [core, post, beam], top: y0 + H + beamH, width: W, x };
});

export const level04: LevelDef = {
  id: 'level04',
  name: 'Load-Bearing Beam',
  subtitle: 'Two storeys on one beam, one beam on one post',
  lesson: 'A transfer beam gathers a whole building onto a few supports, so each of those supports carries far more than its size suggests.',
  hint: 'Follow the blue beam down. The core holds its right end; the left end stands on a single timber post.',
  seed: 4,
  originX: 40,
  blueprint: {
    modules: [
      { type: 'foundation', w: 11, fixed: true },
      { type: 'level04-podium', coreW: 4.3, postStrength: 1.5, gap: 0.03 },
      { type: 'tower', storeys: 2, w: 10, h: 2.6, columns: 3, strength: 2.5 },
    ],
  },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineHeight: 5 },
  par: 1,
  reward: 280,
};
