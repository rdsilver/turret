/**
 * MENDER — a moth-winged flyer carrying a glowing lamp on a short hanger. It
 * doesn't fly at the line: it takes station above another creature — the one
 * closest to the line, or one that is badly hurt — and keeps pace with it. The
 * lamp shines a cone of green light straight down, and whatever is damaged in
 * that light mends: shot-up legs lose their red, their knees firm up again. It
 * can't regrow a severed limb or rejoin a broken joint, and it never heals
 * itself (or another mender). Once nothing is left to escort it hangs in the
 * air a moment, then flies at the line: it has to be brought down too.
 *
 * Beat it by taking it out first. The lamp hangs below the body in plain view
 * of the gun: shoot it off and the light goes out for good (the mender just
 * tags along after that, harmless until it is alone). Or shoot a wing off: the
 * light goes out at once and the lamp's weight drags it down within a few
 * metres (no bird's long glide). Right at the line that can still be too far:
 * there, and once it is alone and flying at the line, go for the body or head.
 * Out-shooting its light works too — it mends 2.5 hit points a second (level
 * param `heal`) — but takes longer. The top turret leaves it be on its way in
 * (an escort never crosses the line while it has an ally), then goes for it
 * first once it has seen it mend for 2 s (param `notice`) — unless something
 * else is about to break through.
 */
import { registerCreature, type AbilitySpec, type CreatureSpec, type MuscleGait } from '../CreatureTypes';
import { G, draftMass } from './kit';

registerCreature('mender', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const H = P('height', 3.4);
  const speed = P('speed', 1.2);
  // Thorax: an oval shell (points CCW, definition space).
  const oval: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    oval.push([0.44 * Math.cos(a), 0.2 * Math.sin(a)]);
  }
  d.poly(0, H, oval, 'wood', { id: 'body', densityScale: 0.45, tags: ['core'], hpScale: P('bodyHp', 1.2) });
  d.circle(-0.52, H + 0.06, 0.15, 'wood', { id: 'head', densityScale: 0.4, hpScale: 1 });
  d.weld('head', 'body', { at: [-0.42, H + 0.05], seam: 0.18, strength: 3 });
  d.strut(0.34, H - 0.02, 0.78, H - 0.13, 0.15, 'wood', { id: 'tail', densityScale: 0.3 });
  d.weld('tail', 'body', { at: [0.36, H - 0.03], seam: 0.14, strength: 3 });
  // The lamp: a glowing censer under a steel cap, on a short steel hanger.
  d.strut(0, H - 0.16, 0, H - 0.56, 0.06, 'steel', { id: 'hanger', densityScale: 0.12, hpScale: 1.2 });
  d.weld('hanger', 'body', { at: [0, H - 0.17], seam: 0.08, strength: 4 });
  d.box(0, H - 0.58, 0.34, 0.07, 'steel', { id: 'cap', densityScale: 0.12 });
  d.weld('cap', 'hanger', { at: [0, H - 0.55], seam: 0.08, strength: 4 });
  // Big and fragile (6.4 HP): a round glowing target that a few seconds of fire breaks.
  d.circle(0, H - 0.81, 0.2, 'core', { id: 'lamp', densityScale: 0.15, tags: ['organ'], hpScale: P('lampHp', 0.5) });
  d.weld('lamp', 'cap', { at: [0, H - 0.62], seam: 0.16, strength: 3 });
  const shoulder: [number, number] = [-0.06, H + 0.14];
  const elbow: [number, number] = [0.1, H + 0.76];
  const tip: [number, number] = [0.5, H + 1.22];
  const wingHp = P('wingHp', 0.9);
  // Light, broad wings (a moth's): the beat barely shakes the body.
  const wingD = P('wingD', 0.1);
  for (const side of ['L', 'R']) {
    const tags = side === 'R' ? ['limb', 'wing', 'back'] : ['limb', 'wing'];
    d.strut(shoulder[0], shoulder[1], elbow[0], elbow[1], 0.17, 'wood', { id: `wing${side}1`, densityScale: wingD, tags, hpScale: wingHp });
    d.strut(elbow[0], elbow[1], tip[0], tip[1], 0.13, 'wood', { id: `wing${side}2`, densityScale: wingD * 0.3, tags, hpScale: wingHp });
  }
  // (draftMass counts the oval as 0.1 m²; it is 0.28 m², so add the rest.)
  const mass = draftMass(d) + 0.18 * 520 * 0.45;
  const tref = mass * G * 0.35;
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `shoulder${side}`, a: 'body', b: `wing${side}1`, at: shoulder, seam: 0.15, strength: 2.5, muscle: { torque: tref * P('wingK', 4), min: -120, max: 120, omega: 40 } });
    d.joints.push({ kind: 'muscle', id: `elbow${side}`, a: `wing${side}1`, b: `wing${side}2`, at: elbow, seam: 0.11, strength: 2.5, muscle: { torque: tref * P('wingK', 4) * 0.45, min: -90, max: 90, omega: 40 } });
  }
  // The bird's stroke, a little slower and deeper: it hovers more than it flies.
  const gait: Record<string, MuscleGait> = {};
  for (const [side, lag] of [
    ['L', 0],
    ['R', 0.04],
  ] as const) {
    gait[`shoulder${side}`] = { shape: 'sin', amp: 1.0, bias: 0.65, phase: lag };
    gait[`elbow${side}`] = { shape: 'sin', amp: 0.5, bias: 0.4, phase: lag + 0.75 };
  }
  const abilities: AbilitySpec[] = [
    { id: 'heal', part: 'lamp', rate: P('heal', 2.5), partRate: 0.3, r0: 1.1, tan: 0.4, reach: 24 },
    { id: 'escort', part: 'body', above: P('above', 5), minHeight: 8, maxHeight: 24, speed: 1.8, drop: 6, notice: P('notice', 2) },
  ];
  return {
    name: 'Mender',
    weakPoints: ['lamp', 'wingL1', 'wingR1', 'body'],
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
      gear: ['lamp', 'cap', 'hanger'],
    },
    lean: 0,
    vitals: ['body', 'head'],
    abilities,
    // Worth shooting first once seen mending (escort sets Creature.targetPriority):
    // the top turret goes for it unless something is 10 m closer to the line.
    targetPriority: 10,
    bounty: 90,
  } satisfies CreatureSpec;
});
