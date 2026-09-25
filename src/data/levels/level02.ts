/**
 * Level 2 — "One Column".
 *
 * A wide concrete roof on a single timber column. The column came in three
 * pieces, joined end to end with one pin each (drawn as rings), so it only
 * stands while it stays perfectly straight. Knock any piece sideways and the
 * column folds at its pins; the roof comes down on everything underneath.
 *
 * Roof hits can work too (the roof shoves the column top over), but the
 * column is the obvious, reliable target: that is the lesson.
 */
import type { LevelDef } from '../../game/LevelDefinition';
import { DEFAULT_GRAVITY } from '../../config/constants';
import { registerModule } from '../../sim/generator/StructureGenerator';
import { MATERIALS, type MaterialId } from '../../sim/Materials';

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);

interface Prop {
  id?: string;
  x: number;
  /** Base height (m) for props standing on the ground or on another prop. */
  y?: number;
  w: number;
  h: number;
  material: MaterialId;
  density?: number;
  /** Stand on the roof instead of the ground. */
  onRoof?: boolean;
}

/**
 * Static stepped footing, a column of `segs` stacked timbers joined by pins
 * (hinges: no bending strength, contact keeps them straight), a slab roof
 * welded to the column top, and loose props (tethered by the generator).
 * Pins get their linear strength from the static load they carry, since the
 * load-aware sizing pass only resizes welds.
 */
registerModule('level02-column', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const x = ctx.x;
  const footW = n(s.footW, 2.4);
  const footH = n(s.footH, 0.4);
  const plinthW = n(s.plinthW, 1.0);
  const plinthH = n(s.plinthH, 0.35);
  const colW = n(s.colW, 0.35);
  const colH = n(s.colH, 4.8);
  const colMat = (s.colMat as MaterialId) ?? 'wood';
  const segs = Math.max(1, Math.round(n(s.segs, 3)));
  const roofW = n(s.roofW, 6.4);
  const roofH = n(s.roofH, 0.6);
  const roofDensity = n(s.roofDensity, 0.3);
  const pinSeam = n(s.pinSeam, colW);
  const pinFactor = n(s.pinFactor, 1.4);
  const props = (s.props as Prop[]) ?? [];
  const parts: number[] = [];

  // Footing + plinth: static, part of the ground (never targets).
  parts.push(d.boxOn(x, 0, footW, footH, 'concrete', { tags: ['foundation'], id: 'footing', fixed: true }));
  const plinth = d.boxOn(x, footH, plinthW, plinthH, 'concrete', { tags: ['foundation'], id: 'plinth', fixed: true });
  parts.push(plinth);
  let y = footH + plinthH;

  const g = DEFAULT_GRAVITY;
  const roofLoad = roofW * roofH * MATERIALS.concrete.density * roofDensity * g;
  const segH = colH / segs;
  const segLoad = colW * segH * MATERIALS[colMat].density * g;
  const pinStrength = (load: number) => (pinFactor * load) / (MATERIALS[colMat].bond.tension * pinSeam);
  let below = plinth;
  for (let k = 0; k < segs; k++) {
    const seg = d.boxOn(x, y, colW, segH, colMat, { id: `column.${k}`, tags: ['weakpoint'] });
    const carried = roofLoad + (segs - k) * segLoad;
    d.hinge(seg, below, [x, y], { seam: pinSeam, strength: pinStrength(carried) });
    parts.push(seg);
    below = seg;
    y += segH;
  }
  const roof = d.boxOn(x, y, roofW, roofH, 'concrete', { id: 'roof', densityScale: roofDensity });
  d.weld(roof, below, { at: [x, y], seam: colW });
  parts.push(roof);
  y += roofH;

  for (const p of props) {
    const base = p.onRoof ? y : n(p.y, 0);
    parts.push(d.boxOn(x + p.x, base, p.w, p.h, p.material, { densityScale: p.density ?? 1, id: p.id, tags: ['decor'] }));
  }
  return { parts, top: y, width: roofW, x };
});

export const level02: LevelDef = {
  id: 'level02',
  name: 'One Column',
  subtitle: 'A big concrete roof. One column. Three pieces. Two pins.',
  lesson: 'Follow the load path: when everything rests on a single member, that member is a single point of failure.',
  hint: 'The whole roof stands on the column, and its joints are pins. Knock any piece of it sideways.',
  seed: 2,
  originX: 38,
  blueprint: {
    modules: [
      {
        type: 'level02-column',
        colW: 0.35,
        colH: 4.8,
        segs: 3,
        roofW: 6.4,
        roofH: 0.6,
        roofDensity: 0.3,
        props: [
          { id: 'crate.L', x: -2.5, w: 1.0, h: 0.8, material: 'wood', density: 0.5 },
          { id: 'crate.R', x: 2.5, w: 1.0, h: 0.8, material: 'wood', density: 0.5 },
          { id: 'planter.L', x: -2.7, w: 0.6, h: 0.6, material: 'wood', density: 0.5, onRoof: true },
          { id: 'planter.R', x: 2.7, w: 0.6, h: 0.6, material: 'wood', density: 0.5, onRoof: true },
        ],
      },
    ],
  },
  // Explicit line: Structure.height0 uses bounding radii, which a wide slab inflates.
  objective: { kind: 'massBelowLine', fraction: 0.6, lineHeight: 2.4 },
  par: 1,
  reward: 160,
};
