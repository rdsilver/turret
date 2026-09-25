/**
 * BEETLE — a low, six-legged walker under an armour dome. Bullets spark off
 * the shell; the head hides behind the front lip. The legs are thin steel:
 * sustained fire (or armour-piercing rounds) gets through. Lose both front or
 * both back legs and it grinds to a halt.
 */
import { registerCreature, type CreatureSpec, type MuscleGait } from '../CreatureTypes';
import { G, buildLeg, draftMass } from './kit';

registerCreature('beetle', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const legLen = P('legLen', 0.5);
  const hipY = 0.12 + legLen * 2;
  const speed = P('speed', 0.55);
  const legDensity = P('legDensity', 0.045);

  d.box(0, hipY + 0.2, 2.4, 0.5, 'wood', { id: 'body', densityScale: 0.5, tags: ['core'], hpScale: 2 });
  d.box(-1.42, hipY + 0.12, 0.5, 0.4, 'wood', { id: 'head', densityScale: 0.4, hpScale: 1.2 });
  d.weld('head', 'body', { at: [-1.2, hipY + 0.12], seam: 0.36, strength: 3 });
  // Armour dome over the body.
  d.poly(
    0,
    hipY + 0.45,
    [
      [-1.5, -0.05],
      [1.35, -0.05],
      [1.2, 0.35],
      [0.3, 0.62],
      [-0.7, 0.56],
      [-1.4, 0.3],
    ],
    'armor',
    { id: 'shell', densityScale: 0.05, tags: ['armor'], hpScale: 1.5 },
  );
  d.weld('shell', 'body', { at: [0, hipY + 0.42], seam: 2.2, strength: 3 });
  // Front lip: covers the head and the front thighs from direct fire.
  d.strut(-1.62, hipY + 0.48, -1.92, hipY - 0.36, 0.14, 'armor', { id: 'lip', densityScale: 0.05, tags: ['armor'], hpScale: 1.5 });
  d.weld('lip', 'shell', { at: [-1.6, hipY + 0.42], seam: 0.14, strength: 3 });
  d.weld('lip', 'head', { at: [-1.7, hipY + 0.12], seam: 0.14, strength: 3 });

  const legMass = 6 * (2 * 0.16 * legLen * 7000 * legDensity + 0.46 * 0.12 * 7000 * legDensity);
  const tref = (draftMass(d) + legMass) * G * 0.3;
  const hips: Array<[string, number]> = [
    ['F', -0.9],
    ['M', 0],
    ['B', 0.9],
  ];
  const legs: string[] = [];
  for (const [row, x] of hips) {
    for (const side of ['L', 'R']) {
      const id = `${row}${side}`;
      legs.push(id);
      buildLeg(d, id, x, hipY, { thigh: legLen, shin: legLen, w: 0.16, mat: 'steel', density: legDensity, hipTorque: tref * P('hipK', 2.5), kneeTorque: tref * P('kneeK', 3), hp: P('legHp', 0.5), footW: 0.4, omega: 90 }, 'body');
    }
  }
  // Tripod gait: front-left, middle-right and back-left move together.
  const tripod: Record<string, number> = { FL: 0, MR: 0, BL: 0, FR: 0.5, ML: 0.5, BR: 0.5 };
  const amp = P('amp', 0.45);
  const gait: Record<string, MuscleGait> = {};
  for (const id of legs) {
    gait[`hip${id}`] = { shape: 'sin', amp, bias: 0.02, phase: tripod[id]! };
    gait[`knee${id}`] = { shape: 'swing', amp: -0.85, bias: -0.08, phase: tripod[id]! + 0.25 };
  }
  return {
    name: 'Beetle',
    core: 'body',
    legs: legs.map((id) => ({ name: id, joints: [`hip${id}`, `knee${id}`], parts: [`thigh${id}`, `shin${id}`, `foot${id}`], foot: `foot${id}` })),
    legGroups: [
      ['FL', 'FR'],
      ['BL', 'BR'],
    ],
    gait: { speed, stride: P('stride', 1.8), muscles: gait },
    downedTilt: 40,
    lean: 0,
    footLift: 1.2,
    vitals: ['body', 'head'],
    bounty: 110,
  } satisfies CreatureSpec;
});
