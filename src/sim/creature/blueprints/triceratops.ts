/**
 * TRICERATOPS — a heavy four-legged dinosaur that walks into your fire head
 * first. A great armour frill rises above and behind the steel skull, and two
 * long brow horns and a nose horn jut out in front: everything the main gun
 * can see straight on, from the beak up to the top of the frill, is plate or
 * steel, and it soaks up rounds for a long time.
 *
 * Go under it or over it. Under: the thick legs below the head — the front
 * pair is half hidden by the skull and horns, so shoot the shins, low; lose
 * both front (or both back) legs and it grinds to a halt. Over: the back rises
 * to a hump over the hips that the frill can't cover from above. The top
 * turret on its mast (and a well-judged lob) can reach it, and it is vital.
 */
import { registerCreature, type CreatureSpec, type MuscleGait } from '../CreatureTypes';
import { MATERIALS } from '../../Materials';
import type { StructureDraft } from '../../generator/StructureDraft';
import { G, buildLeg } from './kit';

/** A convex polygon given by absolute definition-space points, re-centred on their mean. */
function polyAt(pts: Array<[number, number]>): { x: number; y: number; pts: [number, number][] } {
  let x = 0;
  let y = 0;
  for (const [px, py] of pts) {
    x += px / pts.length;
    y += py / pts.length;
  }
  return { x, y, pts: pts.map(([px, py]) => [px - x, py - y]) };
}

/** Mass of everything drafted so far (kg), polygons included (kit's draftMass counts them as 0.1 m²). */
function massOf(d: StructureDraft): number {
  let m = 0;
  for (const p of d.parts) {
    const s = p.shape;
    let a = 0;
    if (s.kind === 'box') a = s.w * s.h;
    else if (s.kind === 'circle') a = Math.PI * s.r * s.r;
    else {
      // Shoelace formula.
      s.points.forEach(([x0, y0], i) => {
        const [x1, y1] = s.points[(i + 1) % s.points.length]!;
        a += (x0 * y1 - x1 * y0) / 2;
      });
    }
    m += Math.abs(a) * MATERIALS[p.material].density * (p.densityScale ?? 1);
  }
  return m;
}

registerCreature('triceratops', (d, _rng, params) => {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const speed = P('speed', 0.7);
  const legF = P('legF', 0.5);
  const legB = P('legB', 0.58);
  const hipFY = 0.12 + legF * 2;
  const hipBY = 0.12 + legB * 2;
  const hipFX = -0.95;
  const hipBX = 0.95;
  const legDensity = 0.4;
  const shape = (id: string, pts: Array<[number, number]>, mat: 'wood' | 'steel' | 'armor', o: { densityScale: number; hpScale?: number; tags?: string[] }) => {
    const p = polyAt(pts);
    d.poly(p.x, p.y, p.pts, mat, { id, ...o });
  };

  // Barrel body, highest over the hips (the core).
  shape(
    'body',
    [
      [-1.35, 0.98],
      [1.2, 1.08],
      [1.6, 1.45],
      [1.5, 1.98],
      [0.75, 2.42],
      [-0.3, 2.3],
      [-1.35, 1.95],
      [-1.65, 1.42],
    ],
    'wood',
    { densityScale: 0.35, tags: ['core'], hpScale: 4 },
  );
  // Tail: long and heavy enough to balance the head.
  shape(
    'tail',
    [
      [1.45, 1.4],
      [3.4, 1.14],
      [3.45, 1.24],
      [1.5, 1.95],
    ],
    'wood',
    { densityScale: 0.45 },
  );
  d.weld('tail', 'body', { at: [1.5, 1.68], seam: 0.5, strength: 3 });
  // The hump over the hips: vital, and out of the main gun's sight behind the frill.
  shape(
    'hips',
    [
      [-0.05, 2.28],
      [1.42, 1.97],
      [1.35, 2.35],
      [1.0, 2.64],
      [0.55, 2.72],
      [0.18, 2.55],
    ],
    'wood',
    { densityScale: 0.35, tags: ['organ'], hpScale: P('hipsHp', 5) },
  );
  d.weld('hips', 'body', { at: [0.75, 2.3], seam: 1.1, strength: 3 });
  // The frill: an armour fan rising behind the skull, over the shoulders.
  const frill: Array<[number, number]> = [
    [-1.8, 1.4],
    [-1.3, 1.42],
    [-0.84, 1.84],
    [-0.7, 2.2],
    [-0.9, 2.46],
    [-1.28, 2.56],
    [-1.68, 2.42],
    [-1.97, 1.98],
  ];
  shape('frill', frill, 'armor', { densityScale: 0.025, tags: ['armor'], hpScale: P('frillHp', 5) });
  d.weld('frill', 'body', { at: [-1.3, 1.8], seam: 0.8, strength: 3 });
  // Knobs along the rim (they chip off long before the frill gives).
  const rim = [2, 3, 4, 5].map((i) => [...frill[i]!, ...frill[i + 1]!] as [number, number, number, number]);
  rim.forEach(([ax, ay, bx, by], i) => {
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const len = Math.hypot(bx - ax, by - ay);
    const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
    // Outward normal of a counter-clockwise edge.
    const [nx, ny] = [uy, -ux];
    shape(
      `knob${i}`,
      [
        [mx - ux * 0.09 - nx * 0.04, my - uy * 0.09 - ny * 0.04],
        [mx + nx * 0.16, my + ny * 0.16],
        [mx + ux * 0.09 - nx * 0.04, my + uy * 0.09 - ny * 0.04],
      ],
      'armor',
      { densityScale: 0.025, tags: ['armor'], hpScale: 0.4 },
    );
    d.weld(`knob${i}`, 'frill', { at: [mx, my], seam: 0.1, strength: 3 });
  });
  // Skull (steel), head held low.
  shape(
    'head',
    [
      [-2.4, 0.95],
      [-1.55, 0.85],
      [-1.45, 1.3],
      [-1.6, 1.62],
      [-2.05, 1.62],
      [-2.5, 1.35],
      [-2.62, 1.1],
    ],
    'steel',
    { densityScale: 0.03, tags: ['armor'], hpScale: P('headHp', 8) },
  );
  d.weld('head', 'body', { at: [-1.5, 1.2], seam: 0.5, strength: 3 });
  d.weld('head', 'frill', { at: [-1.7, 1.5], seam: 0.3, strength: 3 });
  // Parrot beak and a short nose horn.
  shape(
    'beak',
    [
      [-2.8, 0.88],
      [-2.4, 0.95],
      [-2.5, 1.3],
      [-2.72, 1.16],
    ],
    'steel',
    { densityScale: 0.03, tags: ['armor'], hpScale: 2 },
  );
  d.weld('beak', 'head', { at: [-2.5, 1.1], seam: 0.25, strength: 3 });
  shape(
    'noseHorn',
    [
      [-2.47, 1.3],
      [-2.22, 1.42],
      [-2.56, 1.72],
    ],
    'steel',
    { densityScale: 0.03, tags: ['armor'], hpScale: 2 },
  );
  d.weld('noseHorn', 'head', { at: [-2.35, 1.38], seam: 0.2, strength: 3 });
  // Two long brow horns (the far one drawn behind), pointing forward and up.
  for (const [id, dx, dy, far] of [
    ['hornL', 0, 0, false],
    ['hornR', 0.14, 0.04, true],
  ] as const) {
    const bx = -1.95 + dx;
    const by = 1.58 + dy;
    const tx = -3.05 + dx;
    const ty = 2.0 + dy * 2;
    const len = Math.hypot(tx - bx, ty - by);
    const nx = -(ty - by) / len;
    const ny = (tx - bx) / len;
    shape(
      id,
      [
        [bx + nx * 0.09, by + ny * 0.09],
        [bx - nx * 0.09, by - ny * 0.09],
        [tx - nx * 0.015, ty - ny * 0.015],
        [tx + nx * 0.015, ty + ny * 0.015],
      ],
      'steel',
      { densityScale: 0.03, tags: far ? ['armor', 'back'] : ['armor'], hpScale: 2 },
    );
    d.weld(id, 'head', { at: [bx, by], seam: 0.18, strength: 3 });
  }

  // Four thick legs, the back pair longer (hips higher than shoulders). Muscles
  // are sized from the whole weight (legs estimated before they exist).
  const legMass = 2 * (2 * 0.34 * legF * 520 * legDensity + 0.5 * 0.12 * 520 * legDensity) + 2 * (2 * 0.38 * legB * 520 * legDensity + 0.54 * 0.12 * 520 * legDensity);
  const tref = (massOf(d) + legMass) * G * 0.3;
  const legHp = P('legHp', 12.5);
  // Part hp grows with 0.35 + sqrt(area) (partMaxHp).
  const hpArea = (bw: number, bh: number) => 0.35 + Math.sqrt(bw * bh);
  const legDefs: Array<[string, number, number, number, number]> = [
    ['FL', hipFX, hipFY, legF, 0.34],
    ['FR', hipFX, hipFY, legF, 0.34],
    ['BL', hipBX, hipBY, legB, 0.38],
    ['BR', hipBX, hipBY, legB, 0.38],
  ];
  for (const [side, x, y, len, w] of legDefs) {
    const ids = buildLeg(
      d,
      side,
      x,
      y,
      { thigh: len, shin: len, w, mat: 'wood', density: legDensity, hipTorque: tref * 2.5, kneeTorque: tref * 3, hp: legHp, footW: w + 0.16, omega: 90, strength: 3 },
      'body',
    );
    // buildLeg leaves the foot at base hp, and a wrecked foot cripples the leg
    // as surely as a wrecked shin: make the flat little foot as tough as the
    // shin, so shooting at the toes isn't a shortcut past the grind.
    const foot = d.parts.find((p) => p.id === ids.foot)!;
    foot.hpScale = legHp * (hpArea(w * 0.88, len + 0.06) / hpArea(w + 0.16, 0.12));
  }
  const amp = P('amp', 0.42);
  const gait: Record<string, MuscleGait> = {};
  // A plodding four-beat walk: FL, BR, FR, BL.
  const phase: Record<string, number> = { FL: 0, BR: 0.25, FR: 0.5, BL: 0.75 };
  for (const [side] of legDefs) {
    gait[`hip${side}`] = { shape: 'sin', amp, bias: 0.02, phase: phase[side]! };
    gait[`knee${side}`] = { shape: 'swing', amp: -0.8, bias: -0.08, phase: phase[side]! + 0.25 };
  }
  return {
    name: 'Triceratops',
    weakPoints: ['shinFL', 'shinFR', 'thighFL', 'thighFR', 'shinBL', 'shinBR', 'hips'],
    weakPointsFromAbove: ['hips'],
    core: 'body',
    legs: legDefs.map(([side]) => ({ name: side, joints: [`hip${side}`, `knee${side}`], parts: [`thigh${side}`, `shin${side}`, `foot${side}`], foot: `foot${side}` })),
    legGroups: [
      ['FL', 'FR'],
      ['BL', 'BR'],
    ],
    gait: { speed, stride: P('stride', 1.75), muscles: gait },
    downedTilt: 35,
    lean: 0,
    footLift: 1.2,
    vitals: ['body', 'head', 'hips'],
    bounty: 300,
  } satisfies CreatureSpec;
});
