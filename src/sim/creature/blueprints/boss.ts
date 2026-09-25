/**
 * STRIDER — the walking fortress (final level). Four long steel legs, an
 * armour shell and front plate, two sling arms that throw rubber shields and
 * a volatile engine peeking over the back of the shell.
 *
 * Ways to stop it: blow the engine (hard to hit, but it takes the whole thing
 * with it), cut the slings first so shots stop bouncing, or grind down both
 * front (or both back) legs.
 */
import { registerCreature, type CreatureSpec, type MuscleGait } from '../CreatureTypes';
import { G, buildLeg, draftMass } from './kit';

registerCreature('strider', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const legLen = 1.25;
  const hipY = 0.12 + legLen * 2;
  const bodyW = 3.6;
  const bodyH = 0.9;
  const top = hipY + bodyH - 0.1;
  const speed = P('speed', 0.45);
  const legDensity = 0.05;
  d.box(0, hipY + bodyH / 2 - 0.1, bodyW, bodyH, 'wood', { id: 'body', densityScale: 0.45, tags: ['core'], hpScale: 4 });
  // Armour: a shell over the front two thirds and a plate across the face.
  d.poly(
    -0.35,
    top,
    [
      [-1.55, -0.05],
      [1.15, -0.05],
      [1.0, 0.45],
      [-0.2, 0.62],
      [-1.35, 0.4],
    ],
    'armor',
    { id: 'shell', densityScale: 0.04, tags: ['armor'], hpScale: 2 },
  );
  d.weld('shell', 'body', { at: [-0.35, top - 0.02], seam: 2.4, strength: 3 });
  d.box(-bodyW / 2 - 0.1, hipY + bodyH / 2 - 0.2, 0.2, bodyH + 0.5, 'armor', { id: 'face', densityScale: 0.05, tags: ['armor'], hpScale: 2 });
  d.weld('face', 'body', { at: [-bodyW / 2, hipY + bodyH / 2 - 0.1], seam: bodyH, strength: 3 });
  // Sensor head under the face plate.
  d.box(-bodyW / 2 - 0.45, hipY + 0.05, 0.5, 0.35, 'steel', { id: 'head', densityScale: 0.05, tags: ['armor'], hpScale: 2 });
  d.weld('head', 'face', { at: [-bodyW / 2 - 0.2, hipY + 0.05], seam: 0.3, strength: 3 });
  // The engine: rear top, only its upper edge shows over the shell from the front.
  d.box(1.25, top + 0.38, 1.0, 0.8, 'explosive', { id: 'engine', densityScale: 0.6, tags: ['engine', 'organ'], hpScale: P('engineHp', 3) });
  d.weld('engine', 'body', { at: [1.25, top - 0.02], seam: 0.9, strength: 3 });
  d.box(1.6, top + 1.05, 0.14, 0.6, 'steel', { id: 'stack', densityScale: 0.06 });
  d.weld('stack', 'engine', { at: [1.6, top + 0.78], seam: 0.14, strength: 3 });
  // Two sling arms on the front of the shell (organs).
  const slings = [
    { id: 'slingA', x: -0.9, far: false },
    { id: 'slingB', x: -0.5, far: true },
  ];
  const shoulderY = top + 0.35;
  for (const s of slings) {
    const tags = s.far ? ['limb', 'organ', 'back'] : ['limb', 'organ'];
    d.box(s.x, shoulderY + 0.6, 0.16, 1.2, 'wood', { id: s.id, densityScale: 0.45, tags, hpScale: P('slingHp', 1.6) });
    d.box(s.x, shoulderY + 1.25, 0.36, 0.2, 'steel', { id: `${s.id}Cup`, densityScale: 0.2, tags: s.far ? ['organ', 'back'] : ['organ'] });
    d.weld(`${s.id}Cup`, s.id, { at: [s.x, shoulderY + 1.18], seam: 0.16, strength: 3 });
  }
  const legMass = 4 * (2 * 0.24 * legLen * 7000 * legDensity + 0.6 * 0.14 * 7000 * legDensity);
  const tref = (draftMass(d) + legMass) * G * 0.3;
  for (const s of slings) {
    d.joints.push({ kind: 'muscle', id: `shoulder${s.id}`, a: 'body', b: s.id, at: [s.x, shoulderY], seam: 0.16, strength: 2.5, muscle: { torque: tref * 0.12, min: -170, max: 170, omega: 16 } });
  }
  const hips: Array<[string, number]> = [
    ['FL', -bodyW / 2 + 0.45],
    ['FR', -bodyW / 2 + 0.45],
    ['BL', bodyW / 2 - 0.45],
    ['BR', bodyW / 2 - 0.45],
  ];
  for (const [side, x] of hips) {
    buildLeg(d, side, x, hipY, { thigh: legLen, shin: legLen, w: 0.24, mat: 'steel', density: legDensity, hipTorque: tref * 2.5, kneeTorque: tref * 3, hp: P('legHp', 1.4), footW: 0.6, omega: P('omega', 90), strength: 4.5 }, 'body');
  }
  const amp = 0.4;
  const gait: Record<string, MuscleGait> = {};
  // A slow, deliberate walk: one leg at a time (FL, BR, FR, BL).
  const phase: Record<string, number> = { FL: 0, BR: 0.25, FR: 0.5, BL: 0.75 };
  for (const [side] of hips) {
    gait[`hip${side}`] = { shape: 'sin', amp, bias: 0.02, phase: phase[side]! };
    gait[`knee${side}`] = { shape: 'swing', amp: -0.8, bias: -0.08, phase: phase[side]! + 0.25 };
  }
  return {
    name: 'Strider',
    weakPoints: ['slingA', 'slingB', 'engine', 'shinFL', 'shinFR', 'thighFL', 'thighFR'],
    core: 'body',
    legs: hips.map(([side]) => ({ name: side, joints: [`hip${side}`, `knee${side}`], parts: [`thigh${side}`, `shin${side}`, `foot${side}`], foot: `foot${side}` })),
    legGroups: [
      ['FL', 'FR'],
      ['BL', 'BR'],
    ],
    gait: { speed, stride: P('stride', 3.2), muscles: gait },
    downedTilt: 35,
    lean: 0,
    footLift: 1.2,
    vitals: ['body', 'engine'],
    engines: ['engine'],
    abilities: [
      { id: 'throwRubber', part: 'slingA', muscle: 'shoulderslingA', interval: 4.2, delay: 3, size: 0.9, ahead: 6.5, maxLive: 3, windup: -1.8, release: 1.1 },
      { id: 'throwRubber', part: 'slingB', muscle: 'shoulderslingB', interval: 4.2, delay: 5.1, size: 0.9, ahead: 7.5, maxLive: 3, windup: -1.8, release: 1.1 },
    ],
    bounty: 400,
  } satisfies CreatureSpec;
});
