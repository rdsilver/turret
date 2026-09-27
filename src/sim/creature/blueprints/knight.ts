/**
 * KNIGHT — a wooden walker in a suit of armour: a helm, a breastplate, and
 * plates on the front of each thigh and shin. Rounds just spark off the
 * plates. But every plate hangs on a single steel bolt, a stud near the top
 * of its face: shoot the bolt off and the plate falls away, leaving the wood behind it
 * bare. Unbolt a leg (thigh or shin) and it goes down like any walker; the
 * helm and the breastplate guard the head and body.
 *
 * Params: speed, boltHp, plateHp, legHp.
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';
import { MATERIALS } from '../../Materials';
import { G, buildLeg, draftMass, walkerGait } from './kit';

registerCreature('knight', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const S = 1.3;
  const density = 0.45;
  const legLen = 0.85 * S;
  const legW = 0.24 * S;
  const hipY = 0.12 + legLen * 2;
  const torsoW = 0.56 * S;
  const torsoH = 1.15 * S;
  const top = hipY + torsoH;
  const headR = 0.3 * S;
  const headY = top + 0.22 * S;
  const speed = P('speed', 0.65);
  d.box(0, hipY + torsoH / 2 - 0.05, torsoW, torsoH, 'wood', { id: 'torso', densityScale: density, tags: ['core'], hpScale: 2.5 });
  d.circle(0, headY, headR, 'wood', { id: 'head', densityScale: density * 0.6, hpScale: 1.6 });
  d.weld('head', 'torso', { at: [0, top - 0.05], seam: 0.34 * S, strength: 3 });
  const shoulderY = top - 0.18 * S;
  for (const side of ['L', 'R']) {
    const far = side === 'R' ? ['back'] : [];
    d.box(0, shoulderY - 0.36 * S, 0.17 * S, 0.74 * S, 'wood', { id: `arm${side}`, densityScale: density, tags: ['limb', ...far] });
    d.box(0, shoulderY - 1.02 * S, 0.14 * S, 0.62 * S, 'wood', { id: `fore${side}`, densityScale: density, tags: ['limb', ...far] });
    d.weld(`fore${side}`, `arm${side}`, { at: [0, shoulderY - 0.72 * S], seam: 0.14 * S, strength: 3 });
  }
  const massEstimate = draftMass(d) + 4 * legW * legLen * 520 * density + 2 * 0.46 * S * 0.12 * 520 * density;
  const tref = massEstimate * G * 0.5 * S;
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `shoulder${side}`, a: 'torso', b: `arm${side}`, at: [0, shoulderY], seam: 0.17 * S, strength: 2.5, muscle: { torque: tref * 0.15, min: -120, max: 150, omega: 18 } });
    buildLeg(d, side, 0, hipY, { thigh: legLen, shin: legLen, w: legW, mat: 'wood', density, hipTorque: tref * 1.6, kneeTorque: tref * 1.4, hp: P('legHp', 1.3), footW: 0.46 * S }, 'torso');
  }
  // Armour: a plate on the front (turret side) of a part, hanging on one steel
  // bolt, a stud standing out of its face. Plates weigh next to nothing (the
  // gait doesn't notice); the bolt goes last so it is drawn on top.
  const T = 0.13 * S;
  const boltR = 0.075 * S;
  const light = (density * 520) / MATERIALS.armor.density;
  const plate = (id: string, on: string, frontX: number, y: number, h: number, far: string[]) => {
    const x = frontX - T / 2 + 0.03;
    d.box(x, y, T, h, 'armor', { id, densityScale: light, tags: ['armor', ...far], hpScale: P('plateHp', 2) });
    // (Near the top of the plate, not its middle: aim for the part and the plate takes it.)
    const bolt = `bolt${id[0]!.toUpperCase()}${id.slice(1)}`;
    const by = y + h * 0.32;
    d.circle(x - T / 2, by, boltR, 'steel', { id: bolt, densityScale: 0.05, tags: ['organ', ...far], hpScale: P('boltHp', 0.25) });
    d.weld(bolt, id, { at: [x - T / 2, by], seam: boltR * 1.6, strength: 3 });
    d.weld(bolt, on, { at: [x - T / 2, by], seam: boltR * 1.6, strength: 3 });
    return bolt;
  };
  const kneeY = 0.12 + legLen;
  plate('helm', 'head', -headR, headY, headR * 1.8, []);
  plate('breast', 'torso', -torsoW / 2, hipY + torsoH * 0.5, torsoH * 0.85, []);
  for (const side of ['L', 'R']) {
    const far = side === 'R' ? ['back'] : [];
    plate(`cuisse${side}`, `thigh${side}`, -legW / 2, kneeY + legLen * 0.5, legLen * 0.8, far);
    plate(`greave${side}`, `shin${side}`, -legW * 0.44, 0.12 + legLen * 0.5, legLen * 0.8, far);
  }
  return {
    name: 'Knight',
    // Unbolt a leg, then take it; the helm and breastplate guard the vitals.
    weakPoints: ['boltGreaveL', 'shinL', 'boltCuisseL', 'thighL', 'boltGreaveR', 'shinR', 'boltCuisseR', 'thighR', 'boltHelm', 'head', 'boltBreast', 'torso'],
    core: 'torso',
    legs: [
      { name: 'left', joints: ['hipL', 'kneeL'], parts: ['thighL', 'shinL', 'footL'], foot: 'footL' },
      { name: 'right', joints: ['hipR', 'kneeR'], parts: ['thighR', 'shinR', 'footR'], foot: 'footR' },
    ],
    gait: { speed, stride: 2.6 * S, muscles: walkerGait(0.45) },
    lean: 4,
    vitals: ['torso', 'head'],
    bounty: 130,
  } satisfies CreatureSpec;
});
