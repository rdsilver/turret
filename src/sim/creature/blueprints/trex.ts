/**
 * T-REX — the tyrant (final level). An all-metal tyrannosaur: a huge armoured
 * skull with a snapping jaw, a thick neck, a long tail for counterweight, two
 * digitigrade steel legs, and two stubby arms that are rubber throwers — they
 * keep lobbing big bouncing blocks into its path, and bullets glance off
 * rubber, so going straight for the legs means shooting through a wall.
 *
 * Ways to stop it: cut the little arms first (they are thin, and each one
 * lost is one less stream of shields; the far arm is held up higher), then
 * hold fire on one shin until the knee gives: a biped has no spare leg, so
 * losing either one brings it down. The thighs are thick and slow to wear
 * through. The skull is armour plate: a head shot works too, but it takes a
 * long, risky stream of rounds.
 */
import { registerCreature, type CreatureSpec, type MuscleGait } from '../CreatureTypes';
import type { StructureDraft, PartOpts } from '../../generator/StructureDraft';
import { material, type MaterialId } from '../../Materials';
import { G } from './kit';

/** Convex polygon from absolute (definition-space) points, counter-clockwise; placed at their centroid. */
function polyAt(d: StructureDraft, pts: Array<[number, number]>, mat: MaterialId, o: PartOpts): number {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    cx += x / pts.length;
    cy += y / pts.length;
  }
  return d.poly(cx, cy, pts.map(([x, y]) => [x - cx, y - cy] as [number, number]), mat, o);
}

/** Mass of one drafted part (kg; kit's draftMass counts every polygon as 0.1 m², too rough for this body). */
function partMass(d: StructureDraft, i: number): number {
  const p = d.parts[i]!;
  const s = p.shape;
  let area = 0;
  if (s.kind === 'box') area = s.w * s.h;
  else if (s.kind === 'circle') area = Math.PI * s.r * s.r;
  else {
    for (let k = 0; k < s.points.length; k++) {
      const [x0, y0] = s.points[k]!;
      const [x1, y1] = s.points[(k + 1) % s.points.length]!;
      area += (x0 * y1 - x1 * y0) / 2;
    }
    area = Math.abs(area);
  }
  return area * material(p.material).density * (p.densityScale ?? 1);
}

/** Mass of everything drafted so far (kg). */
function bodyMass(d: StructureDraft): number {
  let m = 0;
  for (let i = 0; i < d.parts.length; i++) m += partMass(d, i);
  return m;
}

/** Centre of mass (x) of everything drafted so far. */
function draftComX(d: StructureDraft): number {
  let m = 0;
  let mx = 0;
  for (let i = 0; i < d.parts.length; i++) {
    const pm = partMass(d, i);
    m += pm;
    mx += pm * d.parts[i]!.x;
  }
  return m > 0 ? mx / m : 0;
}

registerCreature('trex', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const speed = P('speed', 0.55);
  const hipY = 2.45;
  const bodyDensity = 0.05;
  const legDensity = 0.045;
  // Body and tail outlines are given relative to the hip height.
  const at = (pts: Array<[number, number]>) => pts.map(([x, y]) => [x, y + hipY] as [number, number]);

  // --- body -------------------------------------------------------------
  polyAt(
    d,
    at([
      [-1.0, -0.5],
      [0.35, -0.4],
      [0.95, -0.05],
      [0.95, 0.38],
      [0.25, 0.62],
      [-0.75, 0.58],
      [-1.2, 0.08],
    ]),
    'steel',
    { id: 'torso', densityScale: bodyDensity, tags: ['core'], hpScale: P('torsoHp', 3) },
  );
  // A short, thick neck up and forward; the skull (armour plate) and a chomping jaw.
  polyAt(
    d,
    at([
      [-1.1, 0.0],
      [-0.6, 0.55],
      [-1.45, 1.15],
      [-1.75, 0.6],
    ]),
    'steel',
    { id: 'neck', densityScale: bodyDensity, hpScale: 2.5 },
  );
  d.weld('neck', 'torso', { at: [-0.9, hipY + 0.25], seam: 0.65, strength: 4 });
  // Head points are relative to the back of the jaw line, scaled up (a tyrant's head is huge).
  const hx0 = -1.6;
  const hy0 = hipY + 0.82;
  const hk = 1.15;
  const head = (pts: Array<[number, number]>) => pts.map(([x, y]) => [hx0 + x * hk, hy0 + y * hk] as [number, number]);
  polyAt(
    d,
    head([
      [-1.45, 0.06],
      [-0.1, -0.02],
      [0.08, 0.3],
      [-0.1, 0.6],
      [-0.7, 0.58],
      [-1.4, 0.4],
      [-1.48, 0.23],
    ]),
    'armor',
    { id: 'head', densityScale: 0.04, tags: ['armor'], hpScale: P('headHp', 2.5) },
  );
  d.weld('head', 'neck', { at: [hx0, hy0 + 0.1], seam: 0.5, strength: 4 });
  const jaw = polyAt(
    d,
    head([
      [-1.38, -0.22],
      [-0.18, -0.28],
      [-0.06, -0.02],
      [-1.42, 0.02],
    ]),
    'steel',
    { id: 'jaw', densityScale: bodyDensity, hpScale: 2 },
  );
  // Teeth along both jaws (armour: pale, and they spark when hit).
  const teeth: Array<[number, number, number]> = [
    [-1.32, 0.06, -1],
    [-1.08, 0.04, -1],
    [-0.84, 0.03, -1],
    [-0.6, 0.02, -1],
    [-1.2, -0.02, 1],
    [-0.96, -0.03, 1],
    [-0.72, -0.04, 1],
  ];
  teeth.forEach(([x, y, dir], i) => {
    const id = `tooth${i}`;
    polyAt(d, head(dir < 0 ? [[x - 0.06, y], [x, y - 0.15], [x + 0.06, y]] : [[x - 0.06, y], [x + 0.06, y], [x, y + 0.13]]), 'armor', { id, densityScale: 0.04 });
    const [ax, ay] = head([[x, y]])[0]!;
    d.weld(id, dir < 0 ? 'head' : 'jaw', { at: [ax, ay], seam: 0.1, strength: 3 });
  });
  // --- tail: three tapering sections, welded ------------------------------
  const tail: Array<Array<[number, number]>> = [
    [
      [0.8, -0.05],
      [2.0, 0.0],
      [2.0, 0.3],
      [0.8, 0.48],
    ],
    [
      [2.0, 0.0],
      [3.0, -0.08],
      [3.0, 0.12],
      [2.0, 0.3],
    ],
    [
      [3.0, -0.08],
      [3.8, -0.16],
      [3.8, -0.1],
      [3.0, 0.12],
    ],
  ];
  const tailIds = ['tail1', 'tail2', 'tail3'];
  tail.forEach((pts, i) => polyAt(d, at(pts), 'steel', { id: tailIds[i], densityScale: bodyDensity, hpScale: 2 }));
  d.weld('tail1', 'torso', { at: [0.82, hipY + 0.2], seam: 0.5, strength: 4 });
  d.weld('tail2', 'tail1', { at: [2.0, hipY + 0.15], seam: 0.3, strength: 4 });
  d.weld('tail3', 'tail2', { at: [3.0, hipY + 0.02], seam: 0.2, strength: 4 });
  // --- arms: stubby rubber throwers on the chest (organs) ---------------------
  const arms = [
    { side: 'L', x: -1.08, far: false },
    { side: 'R', x: -0.92, far: true },
  ];
  const shoulderY = hipY + 0.05;
  let armMass = 0;
  for (const a of arms) {
    const back = a.far ? ['back' as const] : [];
    // One piece from shoulder to a clawed scoop: shoot it anywhere and it counts.
    const arm = polyAt(
      d,
      [
        [a.x - 0.36, shoulderY - 0.5],
        [a.x - 0.2, shoulderY - 0.5],
        [a.x + 0.08, shoulderY - 0.02],
        [a.x - 0.06, shoulderY + 0.06],
        [a.x - 0.4, shoulderY - 0.36],
      ],
      'steel',
      { id: `arm${a.side}`, densityScale: bodyDensity, tags: ['limb', 'organ', ...back], hpScale: P('armHp', 0.5) },
    );
    armMass = partMass(d, arm);
  }

  // --- legs: digitigrade (thigh forward to the knee, shin back to a high ankle, long foot bones forward to the toes).
  // The hips sit right under the centre of mass of everything above them, so
  // head and tail balance and the trim torque has little to fight.
  const hx = draftComX(d);
  const kneeY = 1.45;
  const ankleY = 0.6;
  const legHp = P('legHp', 1.7);
  for (const side of ['L', 'R']) {
    const back = side === 'R' ? ['back' as const] : [];
    const tags = ['limb' as const, ...back];
    polyAt(
      d,
      [
        [hx - 0.5, kneeY - 0.04],
        [hx - 0.14, kneeY - 0.09],
        [hx + 0.5, hipY + 0.15],
        [hx - 0.38, hipY + 0.3],
      ],
      'steel',
      { id: `thigh${side}`, densityScale: legDensity, tags, hpScale: legHp },
    );
    d.strut(hx - 0.3, kneeY, hx + 0.3, ankleY, 0.34, 'steel', { id: `shin${side}`, densityScale: legDensity, tags, hpScale: legHp });
    d.strut(hx + 0.3, ankleY, hx - 0.02, 0.14, 0.24, 'steel', { id: `meta${side}`, densityScale: legDensity, tags, hpScale: legHp });
    d.box(hx - 0.2, 0.07, 0.9, 0.14, 'steel', { id: `foot${side}`, densityScale: legDensity, friction: 1.2, tags: ['limb', 'foot', ...back] });
  }
  // Muscles sized from the whole body (strong hips also mean a strong body-trim torque).
  const tref = bodyMass(d) * G * 0.5;
  const strength = 4.5;
  const omega = P('omega', 70);
  for (const side of ['L', 'R']) {
    d.joints.push({ kind: 'muscle', id: `hip${side}`, a: 'torso', b: `thigh${side}`, at: [hx, hipY], seam: 0.5, strength, muscle: { torque: tref * P('hipK', 3), min: -65, max: 80, omega } });
    d.joints.push({ kind: 'muscle', id: `knee${side}`, a: `thigh${side}`, b: `shin${side}`, at: [hx - 0.3, kneeY], seam: 0.26, strength, muscle: { torque: tref * P('kneeK', 1.8), min: -140, max: 6, omega } });
    d.joints.push({ kind: 'weld', id: `ankle${side}`, a: `shin${side}`, b: `meta${side}`, at: [hx + 0.3, ankleY], seam: 0.2, strength });
    d.weld(`foot${side}`, `meta${side}`, { at: [hx - 0.02, 0.14], seam: 0.2, strength: 3 });
  }
  // Arms and jaw: torque a few times their own weight's moment (sized off the
  // whole body they would be far too stiff for such light parts).
  for (const a of arms) {
    d.joints.push({ kind: 'muscle', id: `shoulder${a.side}`, a: 'torso', b: `arm${a.side}`, at: [a.x, shoulderY], seam: 0.14, strength: 3, muscle: { torque: armMass * G * 0.3 * 5, min: -170, max: 170, omega: 14 } });
  }
  d.joints.push({ kind: 'muscle', id: 'jawHinge', a: 'head', b: 'jaw', at: head([[-0.14, -0.1]])[0]!, seam: 0.25, strength: 4, muscle: { torque: partMass(d, jaw) * 1.1 * G * 0.75 * hk * 4, min: -40, max: 40, omega: 8 } });

  const amp = P('amp', 0.4);
  const gait: Record<string, MuscleGait> = {
    hipL: { shape: 'sin', amp, bias: 0.04, phase: 0 },
    hipR: { shape: 'sin', amp, bias: 0.04, phase: 0.5 },
    kneeL: { shape: 'swing', amp: P('kneeAmp', -0.9), bias: -0.06, phase: 0.25 },
    kneeR: { shape: 'swing', amp: P('kneeAmp', -0.9), bias: -0.06, phase: 0.75 },
    // Mouth held open (negative = jaw down), snapping in time with the stride.
    jawHinge: { shape: 'sin', amp: 0.1, bias: -0.18, phase: 0 },
  };
  const legs = ['L', 'R'].map((s) => ({ name: s, joints: [`hip${s}`, `knee${s}`, `ankle${s}`], parts: [`thigh${s}`, `shin${s}`, `meta${s}`, `foot${s}`], foot: `foot${s}` }));
  return {
    name: 'Tyrant',
    weakPoints: ['armL', 'armR', 'shinL', 'thighL', 'shinR', 'thighR', 'head'],
    core: 'torso',
    legs,
    gait: { speed, stride: P('stride', 3), muscles: gait },
    lean: 0,
    // A biped has no spare leg: lose either one and it can't walk.
    legGroups: [['L'], ['R']],
    downedTilt: 40,
    footLift: 0.6,
    vitals: ['torso', 'head'],
    // Big blocks, thrown short so they tumble in front of its legs. Between
    // throws each arm stays where its release left it: the near one low, the
    // far one raised (so the near arm doesn't hide it).
    abilities: [
      { id: 'throwRubber', part: 'armL', muscle: 'shoulderL', interval: P('interval', 3.6), delay: 2.4, size: P('block', 1.5), ahead: 3, maxLive: 3, lifetime: 10, windup: -1.2, release: 0.3 },
      { id: 'throwRubber', part: 'armR', muscle: 'shoulderR', interval: P('interval', 3.6), delay: 4.2, size: P('block', 1.5), ahead: 4.2, maxLive: 3, lifetime: 10, windup: -1.2, release: 1.1 },
    ],
    bounty: 450,
  } satisfies CreatureSpec;
});
