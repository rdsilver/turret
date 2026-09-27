/**
 * COLOSSUS — a walking steel war machine, taller than anything else on the
 * field, with long arms ending in armoured fists, and a boss in three acts:
 *
 * 1. ARMOURED. Its reactor core glows in the middle of its chest, behind an
 *    armour plate held on by two steel bolts (studs top and bottom). Rounds
 *    spark off the plate; shoot both bolts and it falls away.
 * 2. EXPOSED. Now pour it into the core. When the core is worn down to half,
 *    the power to the legs fails: they come apart at the hips and knees and
 *    fall away (legsGiveOut), and it crashes down.
 * 3. CRAWLING. It won't stop: it drags itself on at the line on its arms
 *    (CreatureSpec.crawl), core still glowing. Finish the core, or shoot both
 *    arms off.
 *
 * Its steel legs can be cut down the long way too (it crawls then, core
 * still behind its plate); a leg lost brings it down onto its arms all the
 * same.
 *
 * Params: speed, crawlSpeed, coreHp, boltHp, plateHp, legHp, armHp.
 */
import { registerCreature, type CreatureSpec, type MuscleGait } from '../CreatureTypes';
import { MATERIALS } from '../../Materials';
import { G, buildLeg, draftMass, walkerGait } from './kit';

registerCreature('colossus', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const S = 1.7;
  // Steel throughout, as light as wood would be (a gait sized for wood carries it).
  const asWood = (0.45 * 520) / MATERIALS.steel.density;
  const legLen = 0.9 * S;
  const legW = 0.34 * S;
  const hipY = 0.12 + legLen * 2;
  const torsoW = 1.0 * S;
  const torsoH = 1.3 * S;
  const top = hipY + torsoH;
  const speed = P('speed', 0.45);
  d.box(0, hipY + torsoH / 2 - 0.05, torsoW, torsoH, 'steel', { id: 'torso', densityScale: asWood, hpScale: 6 });
  d.box(-0.05 * S, top + 0.22 * S, 0.5 * S, 0.44 * S, 'steel', { id: 'head', densityScale: asWood, hpScale: 3 });
  d.weld('head', 'torso', { at: [-0.05 * S, top - 0.02], seam: 0.4 * S, strength: 4 });
  // The reactor core, standing half out of the chest (the only vital).
  const coreR = 0.3 * S;
  const coreY = hipY + torsoH * 0.6;
  d.circle(-torsoW / 2, coreY, coreR, 'core', { id: 'reactor', densityScale: 0.05, tags: ['organ'], hpScale: P('coreHp', 3.2) });
  d.weld('reactor', 'torso', { at: [-torsoW / 2 + coreR * 0.3, coreY], seam: coreR * 1.6, strength: 6, bond: 'steel' });
  // The chest plate over it, held by two bolts (studs on its face, top and bottom): both must go.
  const T = 0.16 * S;
  const plateH = torsoH * 0.8;
  const plateX = -torsoW / 2 - coreR - T / 2 + 0.03;
  d.box(plateX, coreY, T, plateH, 'armor', { id: 'plate', densityScale: (0.45 * 520) / MATERIALS.armor.density, tags: ['armor'], hpScale: P('plateHp', 3) });
  const boltR = 0.085 * S;
  for (const [id, dy] of [
    ['boltTop', plateH * 0.36],
    ['boltBottom', -plateH * 0.36],
  ] as const) {
    d.circle(plateX - T / 2, coreY + dy, boltR, 'steel', { id, densityScale: 0.05, tags: ['organ'], hpScale: P('boltHp', 0.45) });
    d.weld(id, 'plate', { at: [plateX - T / 2, coreY + dy], seam: boltR * 1.6, strength: 4 });
    d.weld(id, 'torso', { at: [plateX - T / 2, coreY + dy], seam: boltR * 1.6, strength: 4 });
  }
  // Long arms: upper arm, forearm, an armoured fist.
  const shoulderY = top - 0.22 * S;
  const upperL = 0.8 * S;
  const foreL = 0.78 * S;
  for (const side of ['L', 'R']) {
    const far = side === 'R' ? ['back'] : [];
    d.box(0, shoulderY - upperL / 2, 0.26 * S, upperL, 'steel', { id: `arm${side}`, densityScale: asWood, tags: ['limb', ...far], hpScale: P('armHp', 2.5) });
    d.box(0, shoulderY - upperL - foreL / 2, 0.24 * S, foreL, 'steel', { id: `fore${side}`, densityScale: asWood, tags: ['limb', ...far], hpScale: P('armHp', 2.5) });
    d.box(0, shoulderY - upperL - foreL - 0.14 * S, 0.36 * S, 0.3 * S, 'armor', { id: `fist${side}`, densityScale: (0.45 * 520) / MATERIALS.armor.density, tags: ['limb', ...far], friction: 1.2 });
    d.weld(`fist${side}`, `fore${side}`, { at: [0, shoulderY - upperL - foreL], seam: 0.24 * S, strength: 4 });
  }
  const massEstimate = draftMass(d) + 4 * legW * legLen * 520 * 0.45 + 2 * 0.56 * S * 0.12 * 520 * 0.45;
  const tref = massEstimate * G * 0.5 * S;
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `shoulder${side}`, a: 'torso', b: `arm${side}`, at: [0, shoulderY], seam: 0.26 * S, strength: 4, muscle: { torque: tref * 0.9, min: -120, max: 170, omega: 20 } });
    d.joints.push({ kind: 'muscle', id: `elbow${side}`, a: `arm${side}`, b: `fore${side}`, at: [0, shoulderY - upperL], seam: 0.24 * S, strength: 4, muscle: { torque: tref * 0.6, min: -10, max: 150, omega: 20 } });
    buildLeg(d, side, 0, hipY, { thigh: legLen, shin: legLen, w: legW, mat: 'steel', density: asWood, hipTorque: tref * 1.7, kneeTorque: tref * 1.5, hp: P('legHp', 3.5), footW: 0.6 * S, strength: 4 }, 'torso');
  }
  const gait = walkerGait(0.38);
  gait.elbowL = { shape: 'hold', amp: 0, bias: 0.25, phase: 0 };
  gait.elbowR = { shape: 'hold', amp: 0, bias: 0.25, phase: 0 };
  // Crawling: each arm reaches forward and down, plants and hauls; the two take turns.
  const crawlMuscles: Record<string, MuscleGait> = {
    shoulderL: { shape: 'sin', amp: 0.45, bias: 1.25, phase: 0 },
    shoulderR: { shape: 'sin', amp: 0.45, bias: 1.25, phase: 0.5 },
    elbowL: { shape: 'sin', amp: 0.35, bias: 0.45, phase: 0.25 },
    elbowR: { shape: 'sin', amp: 0.35, bias: 0.45, phase: 0.75 },
  };
  return {
    name: 'Colossus',
    // Bolts, then the core; then the legs, then the arms.
    weakPoints: ['boltBottom', 'boltTop', 'reactor', 'shinL', 'shinR', 'foreL', 'foreR'],
    core: 'torso',
    legs: [
      { name: 'left', joints: ['hipL', 'kneeL'], parts: ['thighL', 'shinL', 'footL'], foot: 'footL' },
      { name: 'right', joints: ['hipR', 'kneeR'], parts: ['thighR', 'shinR', 'footR'], foot: 'footR' },
    ],
    gait: { speed, stride: 2.4 * S, muscles: gait },
    lean: 3,
    vitals: ['reactor'],
    abilities: [{ id: 'legsGiveOut', part: 'reactor', joints: 'hipL,hipR,kneeL,kneeR', at: 0.5 }],
    crawl: {
      arms: [
        { joints: ['shoulderL', 'elbowL'], parts: ['armL', 'foreL', 'fistL'] },
        { joints: ['shoulderR', 'elbowR'], parts: ['armR', 'foreR', 'fistR'] },
      ],
      speed: P('crawlSpeed', 0.4),
      stride: 1.2 * S,
      muscles: crawlMuscles,
      lean: 25,
      hint: 'Its legs are gone but it keeps coming on its arms. Finish the core, or take both arms.',
    },
    bounty: 400,
  } satisfies CreatureSpec;
});
