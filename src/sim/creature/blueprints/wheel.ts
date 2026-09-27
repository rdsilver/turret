/**
 * ROLLER — a big wheel that rolls itself at the line. Its rim is eight
 * curved segments joined end to end: seven of rubber and one plank of wood.
 * There is nothing else to it, and nothing inside the ring.
 *
 * Rounds bounce off the rubber and barely mark it; the wooden plank is the
 * only part worth shooting, and it turns with the wheel. It comes over the
 * top (where the top turret can reach it), down the front toward you, and
 * then away under the wheel and round the back, where the rubber in front
 * soaks up everything. So hold fire until the plank swings round (shoot
 * something else meanwhile), then pour it on while it faces you: a few
 * seconds of hits break it. Break the plank and the ring bursts apart.
 * (Grinding through a rubber segment also bursts the ring, very slowly.) The
 * top turret waits for the plank the same way.
 * (Rolling: creature/rolling.ts.)
 *
 * Params: speed, radius, rim (thickness), plankHp, rubberHp, density, seam
 * (seam strength), phase (degrees round the wheel the plank starts at, 90 =
 * on top, 180 = facing the turret; default: anywhere).
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';
import { DEG } from '../../../core/math';

registerCreature('wheel', (d, rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const speed = P('speed', 0.85);
  const N = 8;
  const Ro = P('radius', 1);
  const T = P('rim', 0.24);
  const Ri = Ro - T;
  const half = Math.PI / N;
  // Segments run a little past their seams, so the ring shows no gaps as it flexes.
  const reach = half + 1.5 * DEG;
  // Each segment's origin sits halfway across its radial extent (its outline is symmetric about it).
  const Rc = (Ri * Math.cos(reach) + Ro) / 2;
  // One segment, centred on top: a curved outer edge, a straight inner one (convex, CCW, y up).
  const seg: [number, number][] = [[Ri * Math.cos(Math.PI / 2 - reach), Ri * Math.sin(Math.PI / 2 - reach) - Rc]];
  const K = 6;
  for (let k = 0; k <= K; k++) {
    const a = Math.PI / 2 - reach + (2 * reach * k) / K;
    seg.push([Ro * Math.cos(a), Ro * Math.sin(a) - Rc]);
  }
  seg.push([Ri * Math.cos(Math.PI / 2 + reach), Ri * Math.sin(Math.PI / 2 + reach) - Rc]);
  // Light rubber; the plank weighs the same, so the wheel is balanced.
  const density = P('density', 0.15);
  const phase = (typeof params.phase === 'number' ? params.phase : rng.range(0, 360)) * DEG;
  const rim: string[] = [];
  for (let i = 0; i < N; i++) {
    const a = phase + (i * 2 * Math.PI) / N;
    const wood = i === 0;
    const id = wood ? 'plank' : `rim${i}`;
    rim.push(id);
    d.poly(Rc * Math.cos(a), Ro + Rc * Math.sin(a), seg, wood ? 'wood' : 'rubber', {
      id,
      angle: a / DEG - 90,
      densityScale: wood ? (density * 1100) / 520 : density,
      tags: wood ? ['core'] : ['rim'],
      hpScale: wood ? P('plankHp', 1.3) : P('rubberHp', 4),
    });
  }
  // Rubber seams all round (the plank's too): stretchy, so the ring squashes a little where it meets the ground.
  const Rm = (Ri + Ro) / 2;
  for (let i = 0; i < N; i++) {
    const a = phase + ((i + 0.5) * 2 * Math.PI) / N;
    d.weld(rim[i]!, rim[(i + 1) % N]!, { at: [Rm * Math.cos(a), Ro + Rm * Math.sin(a)], seam: T, strength: P('seam', 4), bond: 'rubber' });
  }
  return {
    name: 'Roller',
    weakPoints: ['plank'],
    core: 'plank',
    legs: [],
    gait: { speed, stride: 1, muscles: {} },
    roll: { rim, burst: 3 },
    vitals: ['plank'],
    bounty: 110,
  } satisfies CreatureSpec;
});
