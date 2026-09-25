/**
 * Level 1 — "The Leaning Tower".
 *
 * Hilariously bad construction: an inverted pyramid of hollow crates, each
 * one shoved a little further to the right, crowned with a concrete block and
 * perched on ONE skinny post. The tower is not even fixed to the post: it
 * just sits on a small cap, its center of mass a hand's width from the edge.
 * Nearly any hit tips it past that edge and it goes over in a long, slow
 * topple, breaking up when it lands. Kicking out the post works too.
 */
import type { LevelDef } from '../../game/LevelDefinition';
import { registerModule } from '../../sim/generator/StructureGenerator';
import { MATERIALS, type MaterialId } from '../../sim/Materials';

interface Crate {
  w: number;
  h: number;
  /** Center offset (m) from the blueprint origin. */
  dx: number;
  material: MaterialId;
  density?: number;
  id?: string;
}

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

/**
 * A crate tower resting (unwelded) on a cap plank on one post.
 *
 * The post goes under the center of mass of cap + crates, `bias` m to the
 * LEFT of it, so the tower leans right (away from the turret) by a
 * controlled amount. The post is joined to the static footing and to the cap
 * by short welds (`postSeam` m: little bending strength); the crates are
 * nailed to each other along their full seams at `nail` strength, so the
 * tower tips as one piece and breaks up when it hits the ground.
 */
registerModule('level01-leaning', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const footW = n(s.footW, 2.2);
  const footH = n(s.footH, 0.4);
  const postW = n(s.postW, 0.45);
  const postH = n(s.postH, 2.0);
  const capW = n(s.capW, 1.3);
  const capH = n(s.capH, 0.25);
  const bias = n(s.bias, 0.06);
  const postSeam = n(s.postSeam, 0.2);
  const nail = n(s.nail, 0.4);
  const crates = (s.crates as Crate[]) ?? [];

  // Center of mass of the crates; the cap is centered on the post (px):
  //   px = (mx + capM * px) / (m + capM) - bias  =>  px = mx / m - bias * (m + capM) / m
  let m = 0;
  let mx = 0;
  for (const c of crates) {
    const cm = c.w * c.h * MATERIALS[c.material].density * (c.density ?? 1);
    m += cm;
    mx += cm * c.dx;
  }
  const capM = capW * capH * MATERIALS.wood.density;
  const px = ctx.x + (m > 0 ? (mx - bias * (m + capM)) / m : 0);

  // Static footing: part of the ground, never a target.
  const foot = d.boxOn(px, 0, footW, footH, 'concrete', { tags: ['foundation'], id: 'footing', fixed: true });
  let y = footH;
  const post = d.boxOn(px, y, postW, postH, 'wood', { id: 'post', tags: ['weakpoint'] });
  d.weld(post, foot, { at: [px, y], seam: postSeam, strength: nail });
  y += postH;
  const cap = d.boxOn(px, y, capW, capH, 'wood', { id: 'cap' });
  d.weld(cap, post, { at: [px, y], seam: postSeam, strength: nail });
  y += capH;
  const parts = [foot, post, cap];
  const tower: number[] = [];
  crates.forEach((c, k) => {
    tower.push(d.boxOn(ctx.x + c.dx, y, c.w, c.h, c.material, { densityScale: c.density ?? 1, id: c.id ?? `crate.${k}` }));
    y += c.h;
  });
  // Nailed to each other, but the whole tower just SITS on the cap.
  d.autoWeld({ among: tower, toGround: false, strength: nail });
  parts.push(...tower);
  return { parts, top: y, width: footW, x: ctx.x };
});

export const level01: LevelDef = {
  id: 'level01',
  name: 'The Leaning Tower',
  subtitle: 'Built by someone who owned exactly one post.',
  lesson: 'A tall, top-heavy structure on a narrow base only stands while its center of mass stays above that base.',
  hint: 'It is already leaning. Help it along: hit it anywhere on the side, or kick out the skinny post.',
  seed: 1,
  originX: 38,
  blueprint: {
    modules: [
      {
        type: 'level01-leaning',
        postW: 0.45,
        postH: 2.0,
        capW: 1.3,
        bias: 0.06,
        postSeam: 0.2,
        nail: 0.4,
        // Hollow crates (density 0.35), wider and further right the higher they go.
        crates: [
          { w: 1.0, h: 0.9, dx: -0.24, material: 'wood', density: 0.35 },
          { w: 1.2, h: 0.9, dx: -0.12, material: 'wood', density: 0.35 },
          { w: 1.4, h: 0.9, dx: 0.0, material: 'wood', density: 0.35 },
          { w: 1.6, h: 0.9, dx: 0.12, material: 'wood', density: 0.35 },
          { w: 1.8, h: 0.9, dx: 0.24, material: 'wood', density: 0.35 },
          { w: 0.9, h: 0.5, dx: 0.2, material: 'concrete', id: 'weight' },
        ],
      },
    ],
  },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 100,
};
