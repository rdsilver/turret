/**
 * GLASS RAPTOR — the fastest thing on the field: a lean biped sprinter made
 * of glass (a long neck and skull out front, a stiff tail behind for
 * balance, two long digitigrade legs). It crosses the field in about eight
 * seconds, near 9 m/s by the end.
 *
 * Its glass is tough to shoot through (a part takes a long stream of rounds,
 * over three times a wooden walker's shin), and a wrecked part shatters. The
 * glass is tempered, so its own footfalls don't crack it, but
 * a fall at full tilt does: take out a leg and it goes down at a sprint and
 * smashes itself to pieces on the ground. A biped has no spare leg, so either
 * one will do; the thin legs are the hard part to hit at that speed. The
 * body and the skull are vital too.
 *
 * Params: speed, stride, amp, drive, legHp, bodyHp, temper / legTemper (the
 * velocity change, m/s in one step, that shatters its body / its legs).
 */
import { registerCreature, type CreatureSpec, type MuscleGait } from '../CreatureTypes';
import { G, bodyMass, draftComX, polyAt } from './kit';

registerCreature('raptor', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const speed = P('speed', 3.2);
  const hipY = 2.0;
  const bodyDensity = 0.12;
  const legDensity = 0.1;
  // Tempered glass: the body (under 1.6 m/s of knocks at a run) shatters on a
  // fall; the legs take their own strides' knocks (up to ~4 m/s) but not
  // much more; the foot bones hit the ground at every step (over 15 m/s), so
  // only rounds break those.
  const temper = P('temper', 3.5);
  const legTemper = P('legTemper', 6.5);
  const bodyHp = P('bodyHp', 1.5);
  const at = (pts: Array<[number, number]>) => pts.map(([x, y]) => [x, y + hipY] as [number, number]);
  const glass = (id: string, density: number, hpScale: number, tags: Array<'core' | 'limb' | 'back' | 'foot'> = [], shatterDv = temper) => ({ id, densityScale: density, hpScale, tags, shatterDv });

  // --- body, neck, skull ----------------------------------------------------
  polyAt(
    d,
    at([
      [-0.95, -0.22],
      [0.45, -0.3],
      [0.85, -0.02],
      [0.6, 0.33],
      [-0.3, 0.42],
      [-1.0, 0.14],
    ]),
    'glass',
    glass('torso', bodyDensity, bodyHp, ['core']),
  );
  polyAt(
    d,
    at([
      [-0.92, -0.02],
      [-0.58, 0.3],
      [-1.22, 1.08],
      [-1.5, 0.84],
    ]),
    'glass',
    glass('neck', bodyDensity, bodyHp * 0.7),
  );
  d.weld('neck', 'torso', { at: [-0.8, hipY + 0.12], seam: 0.42, strength: 4, bond: 'wood' });
  // A long, low skull pointing at the turret.
  polyAt(
    d,
    at([
      [-2.3, 0.92],
      [-1.35, 0.86],
      [-1.18, 1.1],
      [-1.42, 1.34],
      [-1.95, 1.28],
      [-2.32, 1.06],
    ]),
    'glass',
    glass('head', bodyDensity * 0.8, bodyHp * 0.6),
  );
  d.weld('head', 'neck', { at: [-1.34, hipY + 1.0], seam: 0.3, strength: 4, bond: 'wood' });
  // --- tail: two tapering sections held straight out behind ------------------
  polyAt(
    d,
    at([
      [0.72, -0.1],
      [1.85, 0.0],
      [1.85, 0.22],
      [0.66, 0.34],
    ]),
    'glass',
    glass('tail1', bodyDensity, bodyHp * 0.6),
  );
  polyAt(
    d,
    at([
      [1.85, 0.0],
      [3.0, 0.1],
      [3.0, 0.17],
      [1.85, 0.22],
    ]),
    'glass',
    glass('tail2', bodyDensity, bodyHp * 0.5),
  );
  d.weld('tail1', 'torso', { at: [0.75, hipY + 0.1], seam: 0.4, strength: 4, bond: 'wood' });
  d.weld('tail2', 'tail1', { at: [1.85, hipY + 0.11], seam: 0.22, strength: 4, bond: 'wood' });
  // --- little clawed arms tucked under the chest -----------------------------
  for (const side of ['L', 'R']) {
    const back = side === 'R' ? (['back'] as const) : [];
    const x = side === 'L' ? -0.72 : -0.6;
    d.strut(x, hipY - 0.02, x - 0.3, hipY - 0.42, 0.1, 'glass', glass(`arm${side}`, bodyDensity, bodyHp * 0.4, ['limb', ...back]));
    d.weld(`arm${side}`, 'torso', { at: [x, hipY - 0.02], seam: 0.1, strength: 3, bond: 'wood' });
  }

  // --- legs: digitigrade (thigh forward to the knee, shin back to a high ankle, long foot bones forward) ---
  // Hips right under the centre of mass of everything above them: neck and
  // tail balance, so the trim torque has little to fight at a sprint.
  const hx = draftComX(d);
  const kneeY = 1.2;
  const ankleY = 0.5;
  const legHp = P('legHp', 1.5);
  for (const side of ['L', 'R']) {
    const back = side === 'R' ? (['back'] as const) : [];
    polyAt(
      d,
      [
        [hx - 0.4, kneeY - 0.03],
        [hx - 0.14, kneeY - 0.08],
        [hx + 0.34, hipY + 0.12],
        [hx - 0.28, hipY + 0.24],
      ],
      'glass',
      glass(`thigh${side}`, legDensity, legHp, ['limb', ...back], legTemper),
    );
    d.strut(hx - 0.26, kneeY, hx + 0.26, ankleY, 0.2, 'glass', glass(`shin${side}`, legDensity, legHp, ['limb', ...back], legTemper));
    d.strut(hx + 0.26, ankleY, hx - 0.02, 0.14, 0.14, 'glass', glass(`meta${side}`, legDensity, legHp, ['limb', ...back], Infinity));
    d.box(hx - 0.2, 0.07, 0.75, 0.14, 'glass', { ...glass(`foot${side}`, legDensity, legHp, ['limb', 'foot', ...back], Infinity), friction: 1.2 });
  }
  const tref = bodyMass(d) * G * 0.5;
  const strength = 4.5;
  const omega = P('omega', 80);
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `hip${side}`, a: 'torso', b: `thigh${side}`, at: [hx, hipY], seam: 0.44, strength, bond: 'wood', muscle: { torque: tref * P('hipK', 3), min: -70, max: 85, omega } });
    d.joints.push({ kind: 'muscle', id: `knee${side}`, a: `thigh${side}`, b: `shin${side}`, at: [hx - 0.26, kneeY], seam: 0.2, strength, bond: 'wood', muscle: { torque: tref * P('kneeK', 1.8), min: -140, max: 6, omega } });
    d.joints.push({ kind: 'weld', id: `ankle${side}`, a: `shin${side}`, b: `meta${side}`, at: [hx + 0.26, ankleY], seam: 0.16, strength, bond: 'wood' });
    d.weld(`foot${side}`, `meta${side}`, { at: [hx - 0.02, 0.14], seam: 0.16, strength: 3, bond: 'wood' });
  }

  const amp = P('amp', 0.5);
  const gait: Record<string, MuscleGait> = {
    hipL: { shape: 'sin', amp, bias: 0.04, phase: 0 },
    hipR: { shape: 'sin', amp, bias: 0.04, phase: 0.5 },
    kneeL: { shape: 'swing', amp: P('kneeAmp', -1), bias: -0.06, phase: 0.25 },
    kneeR: { shape: 'swing', amp: P('kneeAmp', -1), bias: -0.06, phase: 0.75 },
  };
  const legs = ['L', 'R'].map((s) => ({ name: s, joints: [`hip${s}`, `knee${s}`, `ankle${s}`], parts: [`thigh${s}`, `shin${s}`, `meta${s}`, `foot${s}`], foot: `foot${s}` }));
  return {
    name: 'Glass Raptor',
    // Either leg (the near one first: nothing in front of it), then the vitals.
    weakPoints: ['shinL', 'thighL', 'metaL', 'shinR', 'thighR', 'metaR', 'neck', 'head', 'torso'],
    core: 'torso',
    legs,
    gait: { speed, stride: P('stride', 3.4), muscles: gait },
    lean: 0,
    // A biped has no spare leg: lose either one and it goes down.
    legGroups: [['L'], ['R']],
    downedTilt: 40,
    // Lose a leg and it goes down at a sprint (and the fall shatters it).
    sprinter: true,
    footLift: 0.6,
    drive: P('drive', 1.5),
    vitals: ['torso', 'head'],
    bounty: 110,
  } satisfies CreatureSpec;
});
