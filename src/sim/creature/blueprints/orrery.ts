/**
 * ORRERY — a floating clockwork of nested polygons: a glowing triangle at the
 * heart, then a square around it, a pentagon around that, and so on out to an
 * octagon. Each ring is a frame of armoured bars with gaps at its corners, and
 * the rings turn at different speeds in alternating directions.
 *
 * The armour can't be shot through. A single bullet that reaches the triangle
 * ends it — so watch the rings: once every few seconds all the corner gaps
 * swing into line facing the turret, and a round fired through that corridor
 * gets to the heart. Rounds that hit a ring knock it out of step for a moment,
 * so hosing it down only keeps the corridor shut: wait, then fire a short burst.
 */
import { registerCreature, type CreatureSpec, type FloatRing } from '../CreatureTypes';
import type { MaterialId } from '../../Materials';

registerCreature('orrery', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const H = P('height', 3.2);
  const coreR = 0.35;
  const step = P('ringStep', 0.36);
  const fill = P('fill', 0.6);
  const thick = 0.08;
  const speed = P('speed', 0.5);
  // Heart: a triangle with a corner pointing left (CCW points, definition space).
  const tri: [number, number][] = [0, 1, 2].map((i) => {
    const a = Math.PI + (i * 2 * Math.PI) / 3;
    return [coreR * Math.cos(a), coreR * Math.sin(a)];
  });
  d.poly(0, H, tri, 'core', { id: 'tri', densityScale: 0.2, tags: ['core'], hpScale: 0.001 });
  const rings: FloatRing[] = [];
  // Turns per period (sign = direction): inner rings faster, alternating.
  const turns: Record<number, number> = { 4: 2, 5: -2, 6: 1, 7: -1, 8: 1 };
  for (let n = 4; n <= 8; n++) {
    const r = coreR + (n - 3) * step;
    const apothem = r * Math.cos(Math.PI / n);
    const len = fill * 2 * r * Math.sin(Math.PI / n);
    const mat: MaterialId = n % 2 === 0 ? 'steel' : 'armor';
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      // Bar on edge i (between corners i and i+1; corner 0 points left): the corners stay open.
      const m = Math.PI + ((i + 0.5) * 2 * Math.PI) / n;
      const id = `ring${n}_${i}`;
      ids.push(id);
      d.box(apothem * Math.cos(m), H + apothem * Math.sin(m), len, thick, mat, {
        id,
        angle: (m * 180) / Math.PI + 90,
        densityScale: 0.05,
        tags: ['armor', 'ring'],
        hpScale: 5000,
      });
    }
    rings.push({ parts: ids, symmetry: n, turns: turns[n]! });
  }
  return {
    name: 'Orrery',
    core: 'tri',
    legs: [],
    gait: { speed, stride: 1, muscles: {} },
    float: { period: P('period', 5), rings, spin: 1.4, bob: 0.25, bobPeriod: 3.1, flinch: P('flinch', 0.45), recover: P('recover', 1.6) },
    vitals: ['tri'],
    bounty: 200,
  } satisfies CreatureSpec;
});
