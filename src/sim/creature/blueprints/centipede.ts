/**
 * CENTIPEDE — a long chain of body segments, each on its own pair of short
 * legs, rippling forward in a wave. Shooting its legs barely slows it down
 * (there are so many). Wreck a segment and it comes apart: every piece of two
 * or more segments keeps coming as a creature of its own, led by its front
 * segment. Cut it in the middle (twice) and it's done fastest; chew it from
 * the front and each new leader takes over.
 */
import { registerCreature, type CreatureSpec, type LegSpec, type MuscleGait } from '../CreatureTypes';
import { G, buildLeg, draftMass } from './kit';

registerCreature('centipede', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const n = Math.max(3, Math.round(P('segments', 6)));
  const legLen = 0.34;
  const hipY = 0.12 + legLen * 2;
  const segW = 0.92;
  const pitch = 1.0;
  const segH = 0.46;
  const y = hipY + segH / 2 - 0.04;
  const speed = P('speed', 0.9);
  const density = 0.5;
  for (let i = 0; i < n; i++) {
    const tags = i === 0 ? ['segment', 'core'] : ['segment'];
    d.box(i * pitch, y, segW, segH, 'wood', { id: `seg${i}`, densityScale: density, tags, hpScale: P('segHp', 2.4) });
  }
  // Armoured head with mandibles, in front of the first segment.
  d.box(-0.72, y + 0.06, 0.5, 0.4, 'steel', { id: 'head', densityScale: 0.03, tags: ['armor'], hpScale: 2 });
  d.weld('head', 'seg0', { at: [-0.47, y + 0.06], seam: 0.36, strength: 3 });
  d.strut(-0.95, y - 0.1, -1.22, y - 0.28, 0.08, 'steel', { id: 'jaw', densityScale: 0.08 });
  d.weld('jaw', 'head', { at: [-0.96, y - 0.1], seam: 0.08, strength: 3 });
  const legMass = n * 2 * (2 * 0.12 * legLen * 520 * density + 0.3 * 0.12 * 520 * density);
  const segMass = (draftMass(d) + legMass) / n;
  const tref = segMass * G * 0.5;
  // Flexible links between segments: they bend with the ground and each other.
  for (let i = 0; i < n - 1; i++) {
    d.joints.push({
      kind: 'muscle',
      id: `link${i}`,
      a: `seg${i}`,
      b: `seg${i + 1}`,
      at: [i * pitch + pitch / 2, y],
      seam: segH * 0.8,
      strength: 2.5,
      muscle: { torque: tref * 1.2, min: -25, max: 25, omega: 30 },
    });
  }
  const legs: LegSpec[] = [];
  const gait: Record<string, MuscleGait> = {};
  const amp = 0.5;
  for (let i = 0; i < n; i++) {
    for (const side of ['L', 'R']) {
      const id = `${i}${side}`;
      buildLeg(d, id, i * pitch, hipY, { thigh: legLen, shin: legLen, w: 0.12, mat: 'wood', density, hipTorque: tref * 2, kneeTorque: tref * 2.4, hp: P('legHp', 0.9), footW: 0.3, omega: P('omega', 160) }, `seg${i}`);
      legs.push({ name: id, joints: [`hip${id}`, `knee${id}`], parts: [`thigh${id}`, `shin${id}`, `foot${id}`], foot: `foot${id}` });
      // A wave runs from head to tail; the two legs of a segment alternate.
      const ph = i * 0.18 + (side === 'R' ? 0.5 : 0);
      gait[`hip${id}`] = { shape: 'sin', amp, bias: 0.02, phase: ph };
      gait[`knee${id}`] = { shape: 'swing', amp: -0.9, bias: -0.08, phase: ph + 0.25 };
    }
  }
  for (let i = 0; i < n - 1; i++) gait[`link${i}`] = { shape: 'hold', amp: 0, bias: 0, phase: 0 };
  return {
    name: 'Centipede',
    core: 'seg0',
    legs,
    gait: { speed, stride: P('stride', 1.3), muscles: gait },
    lean: 0,
    downedTilt: 50,
    footLift: 1.2,
    vitals: ['seg0'],
    split: { tag: 'segment', min: 2 },
    bounty: 140,
  } satisfies CreatureSpec;
});
