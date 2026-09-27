/**
 * HASTENER — a swift-winged flyer carrying a glowing crystal in its talons.
 * Like the mender it doesn't fly at the line: it takes station above another
 * creature (the one closest to the line) and keeps pace with it. From the
 * crystal it holds a rippling violet beam on that creature, and while the
 * beam holds the creature speeds up — for good: it keeps the extra speed
 * after the beam lets go, after the hastener moves on and after it is shot
 * down (streaks behind it show how much it gained). Up to 1.6 times its speed
 * in about six seconds (level params `rate`, `cap`); then the hastener moves
 * on to the next creature that isn't hastened yet. It never hastens a flyer.
 * Once nothing is left to escort it hangs in the air a moment, then flies at
 * the line.
 *
 * Beat it by taking it out first: every second it lives makes something
 * faster, and what it gave can't be taken back. The crystal hangs below and
 * ahead of the body in plain view of the gun: shoot it off and the beam is
 * gone for good (it just tags along after that, harmless until it is alone).
 * Or shoot a wing off: the beam lets go at once and the crystal's weight
 * drags it down within a few metres. Whatever it already hastened, stop
 * first — it is faster than it looks. The top turret leaves it be on its way
 * in (an escort never crosses the line while it has an ally), then goes for
 * it first once it has seen it beam for 1.5 s (param `notice`) — unless
 * something else is about to break through.
 */
import { registerCreature, type AbilitySpec, type CreatureSpec, type MuscleGait } from '../CreatureTypes';
import { G, draftMass } from './kit';

registerCreature('hastener', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const H = P('height', 3.4);
  const speed = P('speed', 1.4);
  // Body: a slim teardrop, blunt at the front (points CCW, definition space).
  const body: [number, number][] = [
    [-0.4, 0.02],
    [-0.3, -0.13],
    [0, -0.16],
    [0.34, -0.06],
    [0.4, 0.02],
    [0.3, 0.1],
    [0, 0.16],
    [-0.3, 0.14],
  ];
  d.poly(0, H, body, 'wood', { id: 'body', densityScale: 0.45, tags: ['core'], hpScale: P('bodyHp', 1.2) });
  d.circle(-0.5, H + 0.07, 0.14, 'wood', { id: 'head', densityScale: 0.4, hpScale: 1 });
  d.weld('head', 'body', { at: [-0.4, H + 0.05], seam: 0.18, strength: 3 });
  d.strut(-0.6, H + 0.06, -0.8, H + 0.02, 0.06, 'steel', { id: 'beak', densityScale: 0.05 });
  d.weld('beak', 'head', { at: [-0.62, H + 0.06], seam: 0.06, strength: 3 });
  // A forked tail: two thin blades.
  d.strut(0.36, H + 0.02, 0.86, H + 0.16, 0.07, 'wood', { id: 'tailU', densityScale: 0.3 });
  d.weld('tailU', 'body', { at: [0.38, H + 0.03], seam: 0.08, strength: 3 });
  d.strut(0.36, H - 0.02, 0.84, H - 0.16, 0.07, 'wood', { id: 'tailD', densityScale: 0.3 });
  d.weld('tailD', 'body', { at: [0.38, H - 0.03], seam: 0.08, strength: 3 });
  // Talons: a short steel grip reaching down and forward…
  d.strut(-0.08, H - 0.12, -0.2, H - 0.46, 0.06, 'steel', { id: 'talon', densityScale: 0.12, hpScale: 1.2 });
  d.weld('talon', 'body', { at: [-0.09, H - 0.13], seam: 0.08, strength: 4 });
  // …holding the crystal (a glowing prism, 6.3 HP: a few seconds of fire).
  const cx = -0.24;
  const cy = H - 0.72;
  const gem: [number, number][] = [
    [0, -0.26],
    [0.15, 0],
    [0, 0.26],
    [-0.15, 0],
  ];
  d.poly(cx, cy, gem, 'core', { id: 'crystal', densityScale: 0.15, tags: ['organ'], hpScale: P('crystalHp', 0.55) });
  d.weld('crystal', 'talon', { at: [cx + 0.02, cy + 0.24], seam: 0.12, strength: 3 });
  const shoulder: [number, number] = [-0.06, H + 0.12];
  const elbow: [number, number] = [0.14, H + 0.74];
  const tip: [number, number] = [0.6, H + 1.22];
  const wingHp = P('wingHp', 0.9);
  // Light wings (a swift's), swept back: the beat barely shakes the body.
  const wingD = P('wingD', 0.1);
  for (const side of ['L', 'R']) {
    const tags = side === 'R' ? ['limb', 'wing', 'back'] : ['limb', 'wing'];
    d.strut(shoulder[0], shoulder[1], elbow[0], elbow[1], 0.15, 'wood', { id: `wing${side}1`, densityScale: wingD, tags, hpScale: wingHp });
    d.strut(elbow[0], elbow[1], tip[0], tip[1], 0.11, 'wood', { id: `wing${side}2`, densityScale: wingD * 0.3, tags, hpScale: wingHp });
  }
  // (draftMass counts each polygon as 0.1 m²: the body is 0.19 m², the crystal 0.08.)
  const mass = draftMass(d) + 0.09 * 520 * 0.45 - 0.02 * 1500 * 0.15;
  const tref = mass * G * 0.35;
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `shoulder${side}`, a: 'body', b: `wing${side}1`, at: shoulder, seam: 0.14, strength: 2.5, muscle: { torque: tref * P('wingK', 4), min: -120, max: 120, omega: 40 } });
    d.joints.push({ kind: 'muscle', id: `elbow${side}`, a: `wing${side}1`, b: `wing${side}2`, at: elbow, seam: 0.1, strength: 2.5, muscle: { torque: tref * P('wingK', 4) * 0.45, min: -90, max: 90, omega: 40 } });
  }
  // The mender's hovering stroke.
  const gait: Record<string, MuscleGait> = {};
  for (const [side, lag] of [
    ['L', 0],
    ['R', 0.04],
  ] as const) {
    gait[`shoulder${side}`] = { shape: 'sin', amp: 1.0, bias: 0.65, phase: lag };
    gait[`elbow${side}`] = { shape: 'sin', amp: 0.5, bias: 0.4, phase: lag + 0.75 };
  }
  const abilities: AbilitySpec[] = [
    { id: 'haste', part: 'crystal', rate: P('rate', 0.1), cap: P('cap', 1.6), reach: 16, tick: 0.25 },
    { id: 'escort', part: 'body', above: P('above', 5.5), minHeight: 8, maxHeight: 24, speed: 1.8, drop: 6, notice: P('notice', 1.5), behind: 2.5 },
  ];
  return {
    name: 'Hastener',
    weakPoints: ['crystal', 'wingL1', 'wingR1', 'body'],
    core: 'body',
    legs: [],
    gait: { speed, stride: 1, muscles: gait },
    fly: {
      wings: [
        { joints: ['shoulderL', 'elbowL'], parts: ['wingL1', 'wingL2'] },
        { joints: ['shoulderR', 'elbowR'], parts: ['wingR1', 'wingR2'] },
      ],
      flapHz: P('flapHz', 1.2),
      liftMax: 1.6,
      swoop: P('swoop', 0.1),
      swoopPeriod: 7,
      gear: ['crystal', 'talon'],
    },
    lean: 0,
    vitals: ['body', 'head'],
    abilities,
    // Worth shooting first while it beams (escort sets Creature.targetPriority):
    // the top turret goes for it unless something is 10 m closer to the line.
    targetPriority: 10,
    bounty: 90,
  } satisfies CreatureSpec;
});
