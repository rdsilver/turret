/**
 * Bipedal walkers. Definition space: y up, facing LEFT (toward the turret).
 * Positive muscle angles swing a limb forward (toward the turret).
 */
import { registerCreature, type CreatureSpec, type MuscleGait } from '../CreatureTypes';
import { G, buildLeg, draftMass, walkerGait } from './kit';

/**
 * STICK WALKER — level 1. A tall wooden stick figure. Knees are the obvious
 * target: a few hits weaken one enough to buckle under its own weight.
 */
registerCreature('stickman', (d, _rng, params) => {
  const S = typeof params.scale === 'number' ? params.scale : 1.35;
  const density = 0.45;
  const legLen = 0.85 * S;
  const hipY = 0.12 + legLen * 2;
  const torsoH = 1.1 * S;
  const speed = typeof params.speed === 'number' ? params.speed : 0.8;
  // Body first (so leg torques can be sized from the total mass).
  d.box(0, hipY + torsoH / 2 - 0.05, 0.52 * S, torsoH, 'wood', { id: 'torso', densityScale: density, tags: ['core'], hpScale: 2.5 });
  d.circle(0, hipY + torsoH + 0.22 * S, 0.3 * S, 'wood', { id: 'head', densityScale: density * 0.6, hpScale: 1.6 });
  d.weld('head', 'torso', { at: [0, hipY + torsoH - 0.05], seam: 0.34 * S, strength: 3 });
  // Arms (swing for balance and style).
  const shoulderY = hipY + torsoH - 0.18 * S;
  for (const side of ['L', 'R']) {
    const far = side === 'R' ? ['back'] : [];
    d.box(0, shoulderY - 0.36 * S, 0.17 * S, 0.74 * S, 'wood', { id: `arm${side}`, densityScale: density, tags: ['limb', ...far] });
    d.box(0, shoulderY - 1.02 * S, 0.14 * S, 0.62 * S, 'wood', { id: `fore${side}`, densityScale: density, tags: ['limb', ...far] });
    d.weld(`fore${side}`, `arm${side}`, { at: [0, shoulderY - 0.72 * S], seam: 0.14 * S, strength: 3 });
  }
  const legW = 0.24 * S;
  const massEstimate = draftMass(d) + 4 * legW * legLen * 520 * density + 2 * 0.46 * S * 0.12 * 520 * density;
  const tref = massEstimate * G * 0.5 * S;
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `shoulder${side}`, a: 'torso', b: `arm${side}`, at: [0, shoulderY], seam: 0.17 * S, strength: 2.5, muscle: { torque: tref * 0.15, min: -120, max: 150, omega: 18 } });
    buildLeg(d, side, 0, hipY, { thigh: legLen, shin: legLen, w: legW, mat: 'wood', density, hipTorque: tref * 1.6, kneeTorque: tref * 1.4, hp: 1.3, footW: 0.46 * S }, 'torso');
  }
  const spec: CreatureSpec = {
    name: 'Stick Walker',
    core: 'torso',
    legs: [
      { name: 'left', joints: ['hipL', 'kneeL'], parts: ['thighL', 'shinL', 'footL'], foot: 'footL' },
      { name: 'right', joints: ['hipR', 'kneeR'], parts: ['thighR', 'shinR', 'footR'], foot: 'footR' },
    ],
    gait: { speed, stride: 2.6 * S, muscles: walkerGait(0.5) },
    lean: 4,
    vitals: ['torso', 'head'],
    bounty: 60,
  };
  return spec;
});

/**
 * THROWER — a stick walker with an oversized sling arm that lobs rubber blocks
 * into its own path. Bullets glance off rubber: shoot the ARM (or its shoulder)
 * and the shields stop coming.
 */
registerCreature('thrower', (d, _rng, params) => {
  const density = 0.45;
  const legLen = 0.85;
  const hipY = 0.12 + legLen * 2;
  const torsoH = 1.15;
  const speed = typeof params.speed === 'number' ? params.speed : 0.7;
  d.box(0, hipY + torsoH / 2 - 0.05, 0.46, torsoH, 'wood', { id: 'torso', densityScale: density, tags: ['core'], hpScale: 2.5 });
  d.circle(0, hipY + torsoH + 0.22, 0.27, 'wood', { id: 'head', densityScale: density * 0.6, hpScale: 1.6 });
  d.weld('head', 'torso', { at: [0, hipY + torsoH - 0.05], seam: 0.3, strength: 3 });
  const shoulderY = hipY + torsoH - 0.18;
  // Ordinary left arm.
  d.box(0, shoulderY - 0.36, 0.12, 0.74, 'wood', { id: 'armL', densityScale: density, tags: ['limb'] });
  // The sling arm: longer, steel-capped scoop at the end (the organ).
  d.box(0.05, shoulderY - 0.55, 0.16, 1.1, 'wood', { id: 'sling', densityScale: density, tags: ['limb', 'organ'], hpScale: 0.8 });
  d.box(0.05, shoulderY - 1.18, 0.34, 0.2, 'steel', { id: 'scoop', densityScale: 0.25, tags: ['organ'] });
  d.weld('scoop', 'sling', { at: [0.05, shoulderY - 1.1], seam: 0.16, strength: 3 });
  const massEstimate = draftMass(d) + 4 * 0.17 * legLen * 520 * density + 2 * 0.46 * 0.12 * 520 * density;
  const tref = massEstimate * G * 0.5;
  d.joints.push({ kind: 'muscle', id: 'shoulderL', a: 'torso', b: 'armL', at: [0, shoulderY], seam: 0.12, strength: 2.5, muscle: { torque: tref * 0.15, min: -120, max: 150, omega: 18 } });
  d.joints.push({ kind: 'muscle', id: 'shoulderR', a: 'torso', b: 'sling', at: [0.05, shoulderY], seam: 0.16, strength: 2.5, muscle: { torque: tref * 0.3, min: -170, max: 170, omega: 16 } });
  for (const side of ['L', 'R']) {
    buildLeg(d, side, 0, hipY, { thigh: legLen, shin: legLen, w: 0.17, mat: 'wood', density, hipTorque: tref * 1.6, kneeTorque: tref * 1.4, hp: 1.3 }, 'torso');
  }
  const gait = walkerGait(0.5);
  delete gait.shoulderR; // driven by the ability (wind-up / release)
  return {
    name: 'Thrower',
    core: 'torso',
    legs: [
      { name: 'left', joints: ['hipL', 'kneeL'], parts: ['thighL', 'shinL', 'footL'], foot: 'footL' },
      { name: 'right', joints: ['hipR', 'kneeR'], parts: ['thighR', 'shinR', 'footR'], foot: 'footR' },
    ],
    gait: { speed, stride: 2.6, muscles: gait },
    lean: 4,
    vitals: ['torso', 'head'],
    abilities: [{ id: 'throwRubber', part: 'sling', muscle: 'shoulderR', interval: 3.4, delay: 2.2, size: 0.75, ahead: 4.5, maxLive: 4, windup: -1.8, release: 1.1 }],
    bounty: 90,
  } satisfies CreatureSpec;
});

/**
 * HOUND — a fast quadruped. Trots (diagonal legs move together). It keeps
 * coming on three legs; take out a front pair and it goes down on its nose.
 */
registerCreature('hound', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const density = P('density', 0.5);
  const legLen = P('legLen', 0.62);
  const hipY = 0.12 + legLen * 2;
  const bodyW = 2.5;
  const speed = P('speed', 1.6);
  d.box(0, hipY + 0.28, bodyW, 0.56, 'wood', { id: 'body', densityScale: density, tags: ['core'], hpScale: 2.2 });
  d.box(-bodyW / 2 - 0.35, hipY + 0.62, 0.7, 0.45, 'wood', { id: 'head', densityScale: density * 0.8, hpScale: 1.4 });
  d.weld('head', 'body', { at: [-bodyW / 2, hipY + 0.5], seam: 0.4, strength: 3 });
  d.box(bodyW / 2 + 0.35, hipY + 0.5, 0.7, 0.12, 'wood', { id: 'tail', densityScale: density, angle: -20 });
  d.weld('tail', 'body', { at: [bodyW / 2, hipY + 0.45], seam: 0.12, strength: 3 });
  const massEstimate = draftMass(d) + 8 * 0.16 * legLen * 520 * density + 4 * 0.46 * 0.12 * 520 * density;
  const tref = massEstimate * G * 0.3;
  const hips: Array<[string, number]> = [
    ['FL', -bodyW / 2 + 0.3],
    ['FR', -bodyW / 2 + 0.3],
    ['BL', bodyW / 2 - 0.3],
    ['BR', bodyW / 2 - 0.3],
  ];
  for (const [side, x] of hips) {
    buildLeg(d, side, x, hipY, { thigh: legLen, shin: legLen, w: 0.16, mat: 'wood', density, hipTorque: tref * P('hipK', 2.5), kneeTorque: tref * P('kneeK', 3), hp: P('legHp', 0.8), omega: P('omega', 90) }, 'body');
  }
  const amp = P('amp', 0.6);
  const gait: Record<string, MuscleGait> = {};
  // Trot: FL+BR together, FR+BL half a cycle later.
  const phase: Record<string, number> = { FL: 0, BR: 0, FR: 0.5, BL: 0.5 };
  for (const [side] of hips) {
    gait[`hip${side}`] = { shape: 'sin', amp, bias: P('hipBias', 0.02), phase: phase[side]! };
    gait[`knee${side}`] = { shape: 'swing', amp: P('kneeAmp', -0.9), bias: P('kneeBias', -0.08), phase: phase[side]! + P('kneePhase', 0.25) };
  }
  return {
    name: 'Hound',
    core: 'body',
    legs: hips.map(([side]) => ({ name: side, joints: [`hip${side}`, `knee${side}`], parts: [`thigh${side}`, `shin${side}`, `foot${side}`], foot: `foot${side}` })),
    gait: { speed, stride: P('stride', 3), muscles: gait },
    legGroups: [
      ['FL', 'FR'],
      ['BL', 'BR'],
    ],
    downedTilt: 35,
    lean: 0,
    footLift: P('lift', 1.6),
    drive: P('drive', 1),
    vitals: ['body', 'head'],
    bounty: 70,
  } satisfies CreatureSpec;
});
