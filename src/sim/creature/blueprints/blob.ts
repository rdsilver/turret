/**
 * BLOB — a rolling lump of glowing green jelly: a ring of soft lobes round a
 * nucleus, wobbling as it rolls at the line (a wheel, rolling.ts). Shoot it
 * anywhere: it soaks the damage up until it bursts, and a big blob bursts
 * into two medium ones, each of those into two small ones, which just pop
 * (creature/blob.ts). The smaller, the faster, and the fewer hits it takes.
 * One big blob is seven blobs to stop in all.
 *
 * Params: gen (2 = big, 1 = medium, 0 = small), hp (scales every size's
 * pool), speed (scales every size's speed).
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';

/** By generation (0 = small .. 2 = big): radius, rolling speed, damage pool, bounty. */
const SIZES = [
  { r: 0.42, speed: 1.15, hp: 10, bounty: 20 },
  { r: 0.62, speed: 0.95, hp: 20, bounty: 35 },
  { r: 0.9, speed: 0.75, hp: 36, bounty: 60 },
];

registerCreature('blob', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const gen = Math.max(0, Math.min(SIZES.length - 1, Math.round(P('gen', 2))));
  const size = SIZES[gen]!;
  const R = size.r;
  const N = 8;
  // Lobes overlap their neighbours and the nucleus: a lumpy blob, no gaps.
  const Rc = R * 0.6;
  const rl = R * 0.42;
  const density = 0.25;
  const rim: string[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i * 2 * Math.PI) / N;
    const id = `lobe${i}`;
    rim.push(id);
    d.circle(Rc * Math.cos(a), R + Rc * Math.sin(a), rl, 'core', { id, densityScale: density, hpScale: 12 });
  }
  d.circle(0, R, R * 0.55, 'core', { id: 'nucleus', densityScale: density, hpScale: 12 });
  // Soft seams: lobe to lobe round the ring, and every lobe to the nucleus.
  for (let i = 0; i < N; i++) {
    const a = ((i + 0.5) * 2 * Math.PI) / N;
    const mid = Rc * Math.cos(Math.PI / N);
    d.weld(rim[i]!, rim[(i + 1) % N]!, { at: [mid * Math.cos(a), R + mid * Math.sin(a)], seam: rl, strength: 5, bond: 'rubber' });
    const b = (i * 2 * Math.PI) / N;
    d.weld(rim[i]!, 'nucleus', { at: [Rc * 0.5 * Math.cos(b), R + Rc * 0.5 * Math.sin(b)], seam: rl, strength: 5, bond: 'rubber' });
  }
  return {
    name: gen === 2 ? 'Blob' : gen === 1 ? 'Blob (medium)' : 'Blob (small)',
    weakPoints: ['nucleus', ...rim],
    core: 'nucleus',
    legs: [],
    gait: { speed: size.speed * P('speed', 1), stride: 1, muscles: {} },
    roll: { rim, burst: 2 },
    vitals: [],
    abilities: [{ id: 'blobSplit', part: 'nucleus', hp: size.hp * P('hp', 1), gen }],
    bounty: size.bounty,
  } satisfies CreatureSpec;
});
