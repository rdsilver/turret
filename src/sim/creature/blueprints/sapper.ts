/**
 * SAPPER — a wooden walker with four glowing canisters racked on its back and
 * a throwing arm with a steel claw. Every few seconds it reaches back, takes a
 * canister and lobs it some fifteen metres ahead: a shield bomb. Once the bomb
 * lands its red light blinks (and beeps) faster and faster; if it is still
 * there when the fuse runs out it springs up into a tall armour wall that
 * stops every round and shields whatever walks behind it (creatures walk
 * straight through it). The wall stands for a while, then keels over.
 *
 * Shoot the bomb while it ticks: it takes only a few hits (about a second of
 * fire, most of it spent finding a small target) and pops harmlessly. Better,
 * stop the throwing: shoot off the arm (the claw is carried out in front of
 * the body) and it has no way to throw; every canister shot off its pack is
 * one bomb fewer. Once the pack is empty it is only a walker: knees and
 * shins, like any other. A wall already up hides the legs behind it, but not
 * the head and shoulders of anything walking close behind it.
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';
import { G, buildLeg, draftMass, walkerGait } from './kit';

registerCreature('bomber', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const density = 0.45;
  const legLen = 0.85;
  const hipY = 0.12 + legLen * 2;
  const torsoH = 1.1;
  const top = hipY + torsoH;
  const speed = P('speed', 0.75);
  d.box(0, hipY + torsoH / 2 - 0.05, 0.5, torsoH, 'wood', { id: 'torso', densityScale: density, tags: ['core'], hpScale: 2.5 });
  d.circle(0, top + 0.22, 0.26, 'wood', { id: 'head', densityScale: density * 0.6, hpScale: 1.6 });
  d.weld('head', 'torso', { at: [0, top - 0.05], seam: 0.3, strength: 3 });
  // The pack: a steel rack on its back holding its bombs (four; params.cans 1..4), top one first.
  d.box(0.32, hipY + 0.58, 0.1, 0.96, 'steel', { id: 'rack', densityScale: 0.05 });
  d.weld('rack', 'torso', { at: [0.25, hipY + 0.58], seam: 0.6, strength: 3 });
  const ammo: string[] = [];
  const cans = Math.max(1, Math.min(4, Math.round(P('cans', 4))));
  for (let i = 0; i < cans; i++) {
    const id = `can${i + 1}`;
    const y = hipY + 0.95 - i * 0.24;
    d.box(0.46, y, 0.17, 0.21, 'core', { id, densityScale: 0.18, tags: ['organ'], hpScale: P('canHp', 0.6) });
    d.weld(id, 'rack', { at: [0.37, y], seam: 0.18, strength: 3 });
    ammo.push(id);
  }
  const shoulderY = top - 0.18;
  // The throwing arm (near side, the organ) with a steel claw at the end.
  d.box(0, shoulderY - 0.45, 0.15, 0.9, 'wood', { id: 'throwArm', densityScale: density, tags: ['limb', 'organ'], hpScale: P('armHp', 0.9) });
  d.box(0, shoulderY - 0.94, 0.3, 0.14, 'steel', { id: 'claw', densityScale: 0.08, tags: ['organ'] });
  d.weld('claw', 'throwArm', { at: [0, shoulderY - 0.88], seam: 0.15, strength: 3 });
  // Free arm, far side.
  d.box(0, shoulderY - 0.36, 0.12, 0.74, 'wood', { id: 'armR', densityScale: density, tags: ['limb', 'back'] });
  const legW = 0.18;
  const massEstimate = draftMass(d) + 4 * legW * legLen * 520 * density + 2 * 0.46 * 0.12 * 520 * density;
  const tref = massEstimate * G * 0.5;
  d.joints.push({ kind: 'muscle', id: 'shoulderL', a: 'torso', b: 'throwArm', at: [0, shoulderY], seam: 0.15, strength: 2.5, muscle: { torque: tref * 0.5, min: -170, max: 170, omega: 14 } });
  d.joints.push({ kind: 'muscle', id: 'shoulderR', a: 'torso', b: 'armR', at: [0, shoulderY], seam: 0.12, strength: 2.5, muscle: { torque: tref * 0.15, min: -120, max: 150, omega: 18 } });
  for (const side of ['L', 'R']) {
    buildLeg(d, side, 0, hipY, { thigh: legLen, shin: legLen, w: legW, mat: 'wood', density, hipTorque: tref * 1.6, kneeTorque: tref * 1.4, hp: P('legHp', 1.3) }, 'torso');
  }
  const gait = walkerGait(0.5);
  delete gait.shoulderL; // the throwing arm is driven by the ability (carry, wind-up, release)
  return {
    name: 'Sapper',
    weakPoints: ['throwArm', 'shinL', 'thighL', 'shinR', 'torso'],
    core: 'torso',
    legs: [
      { name: 'left', joints: ['hipL', 'kneeL'], parts: ['thighL', 'shinL', 'footL'], foot: 'footL' },
      { name: 'right', joints: ['hipR', 'kneeR'], parts: ['thighR', 'shinR', 'footR'], foot: 'footR' },
    ],
    gait: { speed, stride: 2.6, muscles: gait },
    lean: 4,
    vitals: ['torso', 'head'],
    abilities: [
      {
        id: 'throwShieldBomb',
        part: 'throwArm',
        hand: 'claw',
        muscle: 'shoulderL',
        ammo: ammo.join(','),
        interval: P('interval', 5),
        delay: P('delay', 3),
        ahead: P('ahead', 4.5),
        size: 0.5,
        flight: 1.5,
        fuse: P('fuse', 3.5),
        maxLive: P('maxLive', 2),
        minX: 22,
        maxX: 42,
        bombHp: P('bombHp', 0.11),
        wallH: P('wallH', 9),
        wallW: 1,
        wallLife: P('wallLife', 14),
        wallHp: P('wallHp', 0.3),
        windup: -2.3,
        release: 1.3,
        carry: 0.6,
      },
    ],
    bounty: 110,
  } satisfies CreatureSpec;
});
