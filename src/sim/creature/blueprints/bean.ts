/**
 * JUMPING BEAN — a big seed pod with something alive inside. It never walks:
 * it rests, rocks as the grub winds up (the tell), then kicks off in a random
 * hop — mostly forward, now and then a big leap or a skip backwards — and
 * tumbles through the air.
 *
 * How to stop it: grind the wooden shell down, or hit the grub's glowing
 * peephole for a quick kill. Mid-air it's a tumbling target; the easy shots
 * come while it sits and rocks. Stopped, the grub pops out.
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';

registerCreature('bean', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const speed = P('speed', 0.9);
  const a = 0.68;
  const b = 0.4;
  const y = b + 0.02;
  // A bean: an oval, flatter underneath (convex, counter-clockwise).
  const n = 14;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const s = Math.sin(t);
    pts.push([a * Math.cos(t), b * s * (s < 0 ? 0.8 : 1)]);
  }
  d.poly(0, y, pts, 'wood', { id: 'shell', densityScale: 0.5, tags: ['core'], hpScale: P('hp', 3) });
  // The grub's peephole, near the front of the pod.
  d.circle(-0.26, y + 0.13, 0.09, 'core', { id: 'grub', densityScale: 0.3, hpScale: P('grubHp', 0.6) });
  d.weld('grub', 'shell', { at: [-0.26, y + 0.13], seam: 0.14, strength: 3 });
  return {
    name: 'Jumping Bean',
    weakPoints: ['grub', 'shell'],
    core: 'shell',
    legs: [],
    gait: { speed, stride: 1, muscles: {} },
    hop: { up: [P('upMin', 5), P('upMax', 11)], wait: [0.35, 1.1], back: 0.12, spin: 5, tell: 0.45, twitch: 3, popOut: 'grub', popSpeed: 7 },
    lean: 0,
    vitals: ['shell', 'grub'],
    bounty: 80,
  } satisfies CreatureSpec;
});
