/**
 * BROODMOTHER — a big, slow wooden walker carrying a glowing brood sac at
 * its belly. A few seconds after it appears, and every few seconds after
 * that, a hatchling springs up on the ground in front of it: a small stick
 * walker that runs at the line at twice a walker's pace (creature/brood.ts).
 * No more than two are about at once, and six in all.
 *
 * Hatchlings are fragile (a short burst drops one) but quick, and they keep
 * coming while the sac is whole: burst the sac (or cut it off) and no more
 * hatch. The mother herself goes down like any walker, at the knees and
 * shins, but she is heavier built.
 *
 * Params: speed, sacHp, legHp, interval, maxLive, count, kidSpeed, kidSize,
 * kidHp.
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';
import { G, buildLeg, draftMass, walkerGait } from './kit';

registerCreature('brood', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const density = 0.45;
  const legLen = 0.9;
  const legW = 0.26;
  const hipY = 0.12 + legLen * 2;
  const torsoW = 0.9;
  const torsoH = 1.3;
  const top = hipY + torsoH;
  const speed = P('speed', 0.55);
  d.box(0, hipY + torsoH / 2 - 0.05, torsoW, torsoH, 'wood', { id: 'torso', densityScale: density, tags: ['core'], hpScale: 3 });
  d.circle(-0.05, top + 0.26, 0.32, 'wood', { id: 'head', densityScale: density * 0.6, hpScale: 2 });
  d.weld('head', 'torso', { at: [-0.05, top - 0.05], seam: 0.4, strength: 3 });
  // The brood sac, slung round the front of the belly (the organ).
  const sacR = 0.4;
  const sacY = hipY + 0.42;
  d.circle(-torsoW / 2 - sacR * 0.55, sacY, sacR, 'core', { id: 'sac', densityScale: 0.12, tags: ['organ'], hpScale: P('sacHp', 2.04) });
  d.weld('sac', 'torso', { at: [-torsoW / 2, sacY], seam: 0.5, strength: 3 });
  // Short, thick arms (swing for balance), kept high so the sac stays in view.
  const shoulderY = top - 0.2;
  for (const side of ['L', 'R']) {
    const far = side === 'R' ? ['back'] : [];
    d.box(0, shoulderY - 0.3, 0.2, 0.62, 'wood', { id: `arm${side}`, densityScale: density, tags: ['limb', ...far] });
  }
  const massEstimate = draftMass(d) + 4 * legW * legLen * 520 * density + 2 * 0.56 * 0.12 * 520 * density;
  const tref = massEstimate * G * 0.5;
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `shoulder${side}`, a: 'torso', b: `arm${side}`, at: [0, shoulderY], seam: 0.2, strength: 2.5, muscle: { torque: tref * 0.15, min: -120, max: 150, omega: 18 } });
    buildLeg(d, side, 0, hipY, { thigh: legLen, shin: legLen, w: legW, mat: 'wood', density, hipTorque: tref * 1.7, kneeTorque: tref * 1.5, hp: P('legHp', 1.6), footW: 0.56 }, 'torso');
  }
  return {
    name: 'Broodmother',
    weakPoints: ['sac', 'shinL', 'thighL', 'shinR', 'thighR', 'torso'],
    core: 'torso',
    legs: [
      { name: 'left', joints: ['hipL', 'kneeL'], parts: ['thighL', 'shinL', 'footL'], foot: 'footL' },
      { name: 'right', joints: ['hipR', 'kneeR'], parts: ['thighR', 'shinR', 'footR'], foot: 'footR' },
    ],
    gait: { speed, stride: 2.4, muscles: walkerGait(0.45) },
    lean: 4,
    vitals: ['torso', 'head'],
    abilities: [
      {
        id: 'brood',
        part: 'sac',
        kind: 'stickman',
        sizeMul: P('kidSize', 0.4),
        speed: P('kidSpeed', 1.5),
        hpMul: P('kidHp', 0.6),
        interval: P('interval', 5.5),
        delay: 3,
        // (Scaled with the creature: about 3.6 m in front of it.)
        ahead: 1,
        maxLive: P('maxLive', 2),
        count: P('count', 6),
      },
    ],
    bounty: 140,
  } satisfies CreatureSpec;
});
