/**
 * Machine walkers: bipeds with armour, engines and held equipment. Each has a
 * weak point that is NOT the obvious big target. Definition space: y up,
 * facing LEFT (toward the turret).
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';
import { G, buildLeg, draftMass, walkerGait } from './kit';

const LEGS2 = [
  { name: 'left', joints: ['hipL', 'kneeL'], parts: ['thighL', 'shinL', 'footL'], foot: 'footL' },
  { name: 'right', joints: ['hipR', 'kneeR'], parts: ['thighR', 'shinR', 'footR'], foot: 'footR' },
];

/**
 * ENGINE WALKER — steel legs, an armour-plated chest and a volatile engine
 * block bolted on top. Shots on the engine heat it: it stalls when it
 * overheats, and blows apart when it is destroyed.
 */
registerCreature('engine', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const legLen = 0.85;
  const hipY = 0.12 + legLen * 2;
  const torsoH = 1.1;
  const top = hipY + torsoH;
  const speed = P('speed', 0.8);
  const legDensity = 0.06;
  d.box(0, hipY + torsoH / 2 - 0.05, 0.7, torsoH, 'wood', { id: 'torso', densityScale: 0.5, tags: ['core'], hpScale: 3 });
  d.box(-0.43, hipY + torsoH / 2, 0.16, torsoH - 0.1, 'steel', { id: 'chest', densityScale: 0.12, tags: ['armor'], hpScale: 2 });
  d.weld('chest', 'torso', { at: [-0.35, hipY + torsoH / 2], seam: torsoH - 0.2, strength: 3 });
  // The engine block: exposed, striped, and explosive.
  d.box(0.05, top + 0.33, 0.9, 0.7, 'explosive', { id: 'engine', densityScale: 0.8, tags: ['engine', 'organ'], hpScale: P('engineHp', 4.5) });
  d.weld('engine', 'torso', { at: [0.05, top - 0.02], seam: 0.66, strength: 3 });
  d.box(0.38, top + 0.95, 0.13, 0.55, 'steel', { id: 'stack', densityScale: 0.08 });
  d.weld('stack', 'engine', { at: [0.38, top + 0.68], seam: 0.13, strength: 3 });
  const shoulderY = top - 0.15;
  for (const side of ['L', 'R']) {
    const far = side === 'R' ? ['back'] : [];
    d.box(0, shoulderY - 0.4, 0.16, 0.8, 'steel', { id: `arm${side}`, densityScale: 0.06, tags: ['limb', ...far] });
  }
  const legMass = 2 * (2 * 0.2 * legLen * 7000 * legDensity + 0.5 * 0.12 * 7000 * legDensity);
  const tref = (draftMass(d) + legMass) * G * 0.5;
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `shoulder${side}`, a: 'torso', b: `arm${side}`, at: [0, shoulderY], seam: 0.16, strength: 2.5, muscle: { torque: tref * 0.12, min: -120, max: 150, omega: 18 } });
    buildLeg(d, side, 0, hipY, { thigh: legLen, shin: legLen, w: 0.2, mat: 'steel', density: legDensity, hipTorque: tref * 1.8, kneeTorque: tref * 1.8, hp: P('legHp', 0.6), footW: 0.5, omega: 80, strength: 3.5 }, 'torso');
  }
  return {
    name: 'Engine Walker',
    weakPoints: ['engine', 'shinL', 'shinR'],
    core: 'torso',
    legs: LEGS2,
    gait: { speed, stride: 2.8, muscles: walkerGait(0.45) },
    lean: 3,
    vitals: ['torso', 'engine'],
    engines: ['engine'],
    bounty: 130,
  } satisfies CreatureSpec;
});

/**
 * SHIELD-BEARER — a walker holding a heavy armour plate out in front. The plate
 * stops bullets cold. The arm holding it, the head above it and the shins
 * below it do not.
 */
registerCreature('shield', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const legLen = 0.9;
  const hipY = 0.12 + legLen * 2;
  const torsoH = 1.2;
  const top = hipY + torsoH;
  const speed = P('speed', 0.75);
  d.box(0, hipY + torsoH / 2 - 0.05, 0.56, torsoH, 'wood', { id: 'torso', densityScale: 0.5, tags: ['core'], hpScale: 2.5 });
  d.circle(0, top + 0.26, 0.3, 'wood', { id: 'head', densityScale: 0.3, hpScale: 2.2 });
  d.weld('head', 'torso', { at: [0, top - 0.05], seam: 0.34, strength: 3 });
  const shoulderY = top - 0.18;
  // Shield arm: reaches forward and down from the shoulder to the plate's top edge.
  const plateX = -1.05;
  const plateTop = hipY + 0.55;
  const plateBottom = P('plateBottom', 0.72);
  d.strut(0, shoulderY, plateX + 0.12, plateTop - 0.05, 0.17, 'steel', { id: 'shieldArm', densityScale: 0.04, tags: ['limb', 'organ'], hpScale: P('armHp', 0.8) });
  d.box(plateX, (plateTop + plateBottom) / 2, 0.24, plateTop - plateBottom, 'armor', { id: 'plate', densityScale: 0.03, tags: ['armor'], hpScale: 3 });
  d.weld('plate', 'shieldArm', { at: [plateX + 0.08, plateTop - 0.08], seam: 0.17, strength: 3 });
  // Free arm.
  d.box(0, shoulderY - 0.4, 0.15, 0.8, 'wood', { id: 'armR', densityScale: 0.45, tags: ['limb', 'back'] });
  const legW = 0.22;
  const legMass = 2 * (2 * legW * legLen * 520 * 0.45 + 0.46 * 0.12 * 520 * 0.45);
  const tref = (draftMass(d) + legMass) * G * 0.5;
  d.joints.push({ kind: 'muscle', id: 'shoulderL', a: 'torso', b: 'shieldArm', at: [0, shoulderY], seam: 0.17, strength: 2.5, muscle: { torque: tref * 2.2, min: -60, max: 60, omega: 45 } });
  d.joints.push({ kind: 'muscle', id: 'shoulderR', a: 'torso', b: 'armR', at: [0, shoulderY], seam: 0.15, strength: 2.5, muscle: { torque: tref * 0.12, min: -120, max: 150, omega: 18 } });
  for (const side of ['L', 'R']) {
    buildLeg(d, side, 0, hipY, { thigh: legLen, shin: legLen, w: legW, mat: 'wood', density: 0.45, hipTorque: tref * 1.8, kneeTorque: tref * 1.8, hp: P('legHp', 1.2), footW: 0.5, omega: 70 }, 'torso');
  }
  const gait = walkerGait(0.42);
  // The shield arm holds steady (a slight bob comes from the walk itself).
  gait.shoulderL = { shape: 'hold', amp: 0, bias: 0, phase: 0 };
  return {
    name: 'Shield-Bearer',
    weakPoints: ['shieldArm', 'head', 'shinL', 'shinR', 'torso'],
    core: 'torso',
    legs: LEGS2,
    gait: { speed, stride: 2.8, muscles: gait },
    lean: 2,
    vitals: ['torso', 'head'],
    bounty: 120,
  } satisfies CreatureSpec;
});
