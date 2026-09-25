/**
 * BIRD — a flapping flyer. It comes in high and fast over the field, swooping
 * gently. Its wings carry it: shoot one off (or weaken its shoulder) and it
 * can't hold altitude any more; it glides down and is stopped when it lands.
 * A body or head shot also works — if you can hit something that small.
 */
import { registerCreature, type CreatureSpec, type MuscleGait } from '../CreatureTypes';
import { G, draftMass } from './kit';

registerCreature('bird', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const H = P('height', 3.0);
  const speed = P('speed', 1.5);
  d.box(0, H, 0.9, 0.34, 'wood', { id: 'body', densityScale: 0.45, tags: ['core'], hpScale: P('bodyHp', 1.4) });
  d.circle(-0.58, H + 0.1, 0.17, 'wood', { id: 'head', densityScale: 0.4, hpScale: 1.2 });
  d.weld('head', 'body', { at: [-0.44, H + 0.08], seam: 0.2, strength: 3 });
  d.strut(-0.7, H + 0.07, -0.95, H + 0.01, 0.07, 'steel', { id: 'beak', densityScale: 0.05 });
  d.weld('beak', 'head', { at: [-0.72, H + 0.07], seam: 0.07, strength: 3 });
  d.strut(0.4, H + 0.02, 0.86, H + 0.13, 0.1, 'wood', { id: 'tail', densityScale: 0.35 });
  d.weld('tail', 'body', { at: [0.42, H + 0.03], seam: 0.1, strength: 3 });
  const shoulder: [number, number] = [-0.08, H + 0.14];
  const elbow: [number, number] = [0.08, H + 0.72];
  const tip: [number, number] = [0.42, H + 1.18];
  const wingHp = P('wingHp', 1.2);
  for (const side of ['L', 'R']) {
    const tags = side === 'R' ? ['limb', 'wing', 'back'] : ['limb', 'wing'];
    d.strut(shoulder[0], shoulder[1], elbow[0], elbow[1], 0.13, 'wood', { id: `wing${side}1`, densityScale: 0.35, tags, hpScale: wingHp });
    d.strut(elbow[0], elbow[1], tip[0], tip[1], 0.09, 'wood', { id: `wing${side}2`, densityScale: 0.3, tags, hpScale: wingHp });
  }
  const tref = draftMass(d) * G * 0.35;
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `shoulder${side}`, a: 'body', b: `wing${side}1`, at: shoulder, seam: 0.13, strength: 2.5, muscle: { torque: tref * P('wingK', 4), min: -120, max: 120, omega: 40 } });
    d.joints.push({ kind: 'muscle', id: `elbow${side}`, a: `wing${side}1`, b: `wing${side}2`, at: elbow, seam: 0.09, strength: 2.5, muscle: { torque: tref * P('wingK', 4) * 0.45, min: -90, max: 90, omega: 40 } });
  }
  // Positive swings a wing back and down: a stroke from up-forward to down-back.
  const gait: Record<string, MuscleGait> = {};
  for (const [side, lag] of [
    ['L', 0],
    ['R', 0.04],
  ] as const) {
    gait[`shoulder${side}`] = { shape: 'sin', amp: 1.0, bias: 0.65, phase: lag };
    gait[`elbow${side}`] = { shape: 'sin', amp: 0.5, bias: 0.15, phase: lag + 0.12 };
  }
  return {
    name: 'Bird',
    weakPoints: ['wingL1', 'wingR1', 'body', 'head'],
    core: 'body',
    legs: [],
    gait: { speed, stride: 1, muscles: gait },
    fly: {
      wings: [
        { joints: ['shoulderL', 'elbowL'], parts: ['wingL1', 'wingL2'] },
        { joints: ['shoulderR', 'elbowR'], parts: ['wingR1', 'wingR2'] },
      ],
      flapHz: P('flapHz', 1.2),
      liftMax: 1.6,
      swoop: 0.35,
      swoopPeriod: 4.5,
    },
    lean: 0,
    vitals: ['body', 'head'],
    bounty: 70,
  } satisfies CreatureSpec;
});
