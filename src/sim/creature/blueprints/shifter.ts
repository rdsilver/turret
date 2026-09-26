/**
 * SHIFTER — a stone golem that can only be hurt in one place at a time. One
 * block of it glows cyan: that is its weak spot. Every other block is dead
 * stone, and rounds just ping off it. The glow moves on every few seconds
 * (the next block's outline flickers just before) to the head, the body, a
 * thigh or a shin. It never stays on the same block twice in a row, and
 * visits every block once before any comes round again.
 *
 * Chase the glow. Damage stays where it landed, but each glow only takes so
 * much: once a visit has worn a third off its block, the glow dims and jumps
 * on at once. So a block breaks on its third good visit (a leg block gives way
 * a little before that; the head or the body kills it), and there is no
 * breaking one block in a single burst. Keep up with the glow and the visits
 * come round quickly, so every block wears down together. Holding fire on one
 * block, or spraying it, wastes nearly every round on dead stone while the
 * glow takes its time everywhere else.
 * (Roaming logic: weakSpot.ts; the glow: view/WeakSpotView.ts.)
 *
 * Params: speed, hp (every block's hit points: how many hits a visit takes),
 * period, burnout, and the tuning knobs below.
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';
import { G, buildLeg, draftMass, walkerGait } from './kit';

registerCreature('shifter', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const speed = P('speed', 0.65);
  // Stone is heavy: a lighter "rubble" density keeps the golem stocky but not immovable.
  const density = 0.12;
  const legLen = 0.8;
  const legW = 0.34;
  const hipY = 0.12 + legLen * 2;
  const torsoW = 0.92;
  const torsoH = 1.15;
  const top = hipY + torsoH - 0.05;
  // Hit points of every block (a visit's allowance is a share of them, see burnout).
  const hp = P('hp', 1);
  d.box(0, hipY + torsoH / 2 - 0.05, torsoW, torsoH, 'stone', { id: 'torso', densityScale: density, tags: ['core'], hpScale: P('torsoHp', 0.9) * hp });
  // A squat block of a head, set a little forward.
  d.box(-0.1, top + 0.2, 0.52, 0.44, 'stone', { id: 'head', densityScale: density, hpScale: P('headHp', 0.9) * hp });
  d.weld('head', 'torso', { at: [-0.1, top - 0.02], seam: 0.44, strength: 3 });
  // Stubby arms, kept inside the body's outline so they never shield anything (always dead stone).
  const shoulderY = top - 0.14;
  const shoulderX = -0.1;
  const armLen = 0.85;
  for (const side of ['L', 'R']) {
    const far = side === 'R' ? ['back'] : [];
    d.box(shoulderX, shoulderY - armLen / 2 + 0.08, 0.26, armLen, 'stone', { id: `arm${side}`, densityScale: density, tags: ['limb', ...far] });
  }
  const legMass = 2 * (2 * legW * legLen * 2500 * density + 0.56 * 0.12 * 2500 * density);
  const tref = (draftMass(d) + legMass) * G * 0.5;
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `shoulder${side}`, a: 'torso', b: `arm${side}`, at: [shoulderX, shoulderY], seam: 0.26, strength: 3, muscle: { torque: tref * 0.2, min: -120, max: 150, omega: 18 } });
    buildLeg(d, side, 0, hipY, { thigh: legLen, shin: legLen, w: legW, mat: 'stone', density, hipTorque: tref * P('hipK', 3), kneeTorque: tref * P('kneeK', 2.6), hp: P('legHp', 0.8) * hp, footW: 0.56, strength: 3 }, 'torso');
  }
  const gait = walkerGait(P('amp', 0.4));
  gait.shoulderL = { ...gait.shoulderL!, amp: 0.18 };
  gait.shoulderR = { ...gait.shoulderR!, amp: 0.18 };
  return {
    name: 'Shifter',
    // Gunners chase Creature.weakSpot; this order only applies once nothing glows.
    weakPoints: ['shinL', 'thighL', 'shinR', 'thighR', 'head', 'torso'],
    core: 'torso',
    legs: [
      { name: 'left', joints: ['hipL', 'kneeL'], parts: ['thighL', 'shinL', 'footL'], foot: 'footL' },
      { name: 'right', joints: ['hipR', 'kneeR'], parts: ['thighR', 'shinR', 'footR'], foot: 'footR' },
    ],
    gait: { speed, stride: P('stride', 2.2), muscles: gait },
    lean: 3,
    vitals: ['torso', 'head'],
    abilities: [
      {
        id: 'roamingWeakSpot',
        part: 'torso',
        parts: 'head,torso,thighL,shinL,thighR,shinR',
        period: P('period', 5),
        jitter: 0.5,
        warn: 0.8,
        delay: 3.5,
        burnout: P('burnout', 0.34),
      },
    ],
    bounty: 150,
  } satisfies CreatureSpec;
});
