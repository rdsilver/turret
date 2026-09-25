/**
 * ORRERY — a floating clockwork of nested polygons: a glowing triangle at the
 * heart, then a solid square of armour around it, a pentagon around that, and
 * so on out to an octagon. The rings turn at different speeds in alternating
 * directions.
 *
 * A single round on the triangle ends it, but every ring is a closed wall of
 * armour plates. Wear a plate down and it breaks away, opening a hole — which
 * then rotates with its ring. Get through the octagon, then the heptagon, and
 * so on, layer by layer, before it drifts to the line.
 */
import { registerCreature, type CreatureSpec, type FloatRing } from '../CreatureTypes';
import type { MaterialId } from '../../Materials';

registerCreature('orrery', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const H = P('height', 3.2);
  const coreR = 0.35;
  const step = P('ringStep', 0.36);
  const thick = 0.08;
  const speed = P('speed', 0.5);
  const plateHp = P('plateHp', 0.5);
  // Heart: a triangle (CCW points, definition space). One hit wrecks it.
  const tri: [number, number][] = [0, 1, 2].map((i) => {
    const a = Math.PI + (i * 2 * Math.PI) / 3;
    return [coreR * Math.cos(a), coreR * Math.sin(a)];
  });
  d.poly(0, H, tri, 'core', { id: 'tri', densityScale: 0.2, tags: ['core'], hpScale: 0.001 });
  const rings: FloatRing[] = [];
  // Spin (rad/s): inner rings faster, alternating directions.
  const spin: Record<number, number> = { 4: 0.5, 5: -0.36, 6: 0.26, 7: -0.18, 8: 0.12 };
  for (let n = 4; n <= 8; n++) {
    const r = coreR + (n - 3) * step;
    const apothem = r * Math.cos(Math.PI / n);
    // Plates run the full edge and overlap at the corners: a closed wall.
    const len = 2 * r * Math.sin(Math.PI / n) + thick;
    // Alternating materials; armour plates absorb more, so they carry fewer points.
    const mat: MaterialId = n % 2 === 0 ? 'steel' : 'armor';
    const hp = mat === 'armor' ? plateHp * 0.55 : plateHp;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const m = Math.PI + ((i + 0.5) * 2 * Math.PI) / n;
      const id = `ring${n}_${i}`;
      ids.push(id);
      d.box(apothem * Math.cos(m), H + apothem * Math.sin(m), len, thick, mat, {
        id,
        angle: (m * 180) / Math.PI + 90,
        densityScale: 0.05,
        tags: ['armor', 'ring'],
        hpScale: hp,
      });
    }
    rings.push({ parts: ids, spin: spin[n]! });
  }
  return {
    name: 'Orrery',
    core: 'tri',
    legs: [],
    gait: { speed, stride: 1, muscles: {} },
    float: { rings, spin: 1.4, bob: 0.25, bobPeriod: 3.1 },
    vitals: ['tri'],
    bounty: 200,
  } satisfies CreatureSpec;
});
