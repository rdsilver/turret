/**
 * SMOKER — a wooden walker with a steel boiler on its back and a tall
 * smokestack above it, puffing out thick grey smoke (creature/smoke.ts). The
 * smoke trails behind it as it walks: a wall of it that hides whatever comes
 * behind, from you and from the top turret alike (rounds still go through,
 * if you can guess where to put them). The smoker itself walks in front of
 * its smoke, in plain sight: shoot the stack off and the smoke stops coming
 * (what is out already thins away in a few seconds), or take its legs.
 * All of it is steel (of the same weight as the wood it was drafted in):
 * slow to wear down anywhere, so the stack is the way in.
 *
 * Params: speed, stackHp, legHp, interval, radius, life, steelShare.
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';
import { G, buildLeg, draftMass, swapWoodForSteel, walkerGait } from './kit';
import { Random, hashString } from '../../../core/Random';

registerCreature('smoker', (d, rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const S = 1.3;
  const density = 0.45;
  const legLen = 0.85 * S;
  const legW = 0.24 * S;
  const hipY = 0.12 + legLen * 2;
  const torsoW = 0.56 * S;
  const torsoH = 1.15 * S;
  const top = hipY + torsoH;
  const speed = P('speed', 0.7);
  d.box(0, hipY + torsoH / 2 - 0.05, torsoW, torsoH, 'wood', { id: 'torso', densityScale: density, tags: ['core'], hpScale: 2.5 });
  d.circle(-0.04 * S, top + 0.22 * S, 0.28 * S, 'wood', { id: 'head', densityScale: density * 0.6, hpScale: 1.6 });
  d.weld('head', 'torso', { at: [-0.04 * S, top - 0.05], seam: 0.32 * S, strength: 3 });
  // The boiler on its back, and the stack rising from it behind the head (the organ).
  const boilerX = torsoW / 2 + 0.2 * S;
  d.box(boilerX, hipY + torsoH * 0.55, 0.42 * S, torsoH * 0.7, 'steel', { id: 'boiler', densityScale: 0.04, tags: ['back'] });
  d.weld('boiler', 'torso', { at: [torsoW / 2, hipY + torsoH * 0.55], seam: torsoH * 0.5, strength: 3 });
  // Tall enough to stand clear above the head (the head would take rounds aimed at a shorter one).
  const stackH = 1.7 * S;
  const stackBottom = top - 0.1;
  d.box(boilerX + 0.04 * S, stackBottom + stackH / 2, 0.2 * S, stackH, 'steel', { id: 'stack', densityScale: 0.04, tags: ['organ'], hpScale: P('stackHp', 0.35) });
  d.weld('stack', 'boiler', { at: [boilerX + 0.04 * S, stackBottom + 0.05], seam: 0.2 * S, strength: 3 });
  const shoulderY = top - 0.18 * S;
  for (const side of ['L', 'R']) {
    const far = side === 'R' ? ['back'] : [];
    d.box(0, shoulderY - 0.36 * S, 0.17 * S, 0.74 * S, 'wood', { id: `arm${side}`, densityScale: density, tags: ['limb', ...far] });
  }
  const massEstimate = draftMass(d) + 4 * legW * legLen * 520 * density + 2 * 0.46 * S * 0.12 * 520 * density;
  const tref = massEstimate * G * 0.5 * S;
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `shoulder${side}`, a: 'torso', b: `arm${side}`, at: [0, shoulderY], seam: 0.17 * S, strength: 2.5, muscle: { torque: tref * 0.15, min: -120, max: 150, omega: 18 } });
    buildLeg(d, side, 0, hipY, { thigh: legLen, shin: legLen, w: legW, mat: 'wood', density, hipTorque: tref * 1.6, kneeTorque: tref * 1.4, hp: P('legHp', 1.3), footW: 0.46 * S }, 'torso');
  }
  const spec: CreatureSpec = {
    name: 'Smoker',
    weakPoints: ['stack', 'shinL', 'thighL', 'shinR', 'torso'],
    core: 'torso',
    legs: [
      { name: 'left', joints: ['hipL', 'kneeL'], parts: ['thighL', 'shinL', 'footL'], foot: 'footL' },
      { name: 'right', joints: ['hipR', 'kneeR'], parts: ['thighR', 'shinR', 'footR'], foot: 'footR' },
    ],
    gait: { speed, stride: 2.6 * S, muscles: walkerGait(0.45) },
    lean: 4,
    vitals: ['torso', 'head'],
    abilities: [{ id: 'smoke', part: 'stack', interval: P('interval', 0.3), radius: P('radius', 6), life: P('life', 8), height: 6.5, behind: 1.2, delay: 1 }],
    bounty: 110,
  };
  // All its wood in steel (`steelShare` below 1 leaves some, picked on its own stream: builds from
  // nearby seeds would draw alike from the shared one).
  swapWoodForSteel(d, spec, P('steelShare', 1), new Random(hashString(`smoker:${rng.seed}`)));
  return spec;
});
