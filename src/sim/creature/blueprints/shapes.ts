/**
 * SHAPES — solid polygons that tumble at the line: a triangle, a square, a
 * pentagon, a hexagon and a heptagon of wood, and a stone octagon. Each is
 * cut into wedges from its centre, one per side, held together by the seams
 * between them; it rolls by tipping over its leading corner and falling onto
 * the next face (rolling.ts, RollSpec.tip). The fewer the sides, the harder
 * it lurches.
 *
 * Wreck any one wedge (or tear a seam) and the shape bursts apart. The wedges
 * turn with it, so rounds land on whichever faces the gun and the wear is
 * shared out: the more sides, the longer it lasts.
 *
 * The OCTAGON is stone and can only be hurt in one wedge at a time, the one
 * that glows (the Shifter's roaming weak spot, weakSpot.ts): the glow jumps
 * at random to another wedge turned toward the turret every few seconds,
 * sooner once a visit has worn half off it or the roll has carried it out
 * of sight, and the damage stays. A wedge breaks on its second good visit.
 *
 * Params: speed, radius (circumradius), hp (wedge hit points), density, seam
 * (seam strength), angle (degrees it starts turned by); octagon: period,
 * burnout.
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';
import type { StructureDraft } from '../../generator/StructureDraft';
import type { CreatureParams } from '../CreatureTypes';
import type { Random } from '../../../core/Random';
import { DEG } from '../../../core/math';

interface ShapeDef {
  id: string;
  name: string;
  sides: number;
  speed: number;
  radius: number;
  hp: number;
  bounty: number;
  /** Stone, hurt only in one roaming wedge at a time. */
  roaming?: boolean;
}

const SHAPES: ShapeDef[] = [
  { id: 'triangle', name: 'Triangle', sides: 3, speed: 0.8, radius: 0.8, hp: 1.2, bounty: 60 },
  { id: 'square', name: 'Square', sides: 4, speed: 0.85, radius: 0.75, hp: 1.2, bounty: 70 },
  { id: 'pentagon', name: 'Pentagon', sides: 5, speed: 0.9, radius: 0.75, hp: 1.3, bounty: 80 },
  { id: 'hexagon', name: 'Hexagon', sides: 6, speed: 0.95, radius: 0.75, hp: 1.35, bounty: 90 },
  { id: 'heptagon', name: 'Heptagon', sides: 7, speed: 1, radius: 0.78, hp: 1.45, bounty: 100 },
  { id: 'octagon', name: 'Octagon', sides: 8, speed: 0.8, radius: 0.85, hp: 1, bounty: 160, roaming: true },
];

/** Wood's density over stone's: a stone octagon weighs what a wooden one would. */
const STONE_AS_WOOD = 520 / 2500;

function buildShape(def: ShapeDef, d: StructureDraft, _rng: Random, params: CreatureParams): CreatureSpec {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const N = def.sides;
  const R = P('radius', def.radius);
  // Resting on a face: the hub sits at the inradius.
  const r = R * Math.cos(Math.PI / N);
  const turn = P('angle', 0) * DEG;
  // Corner k (y up): the bottom face is level at turn 0.
  const corner = (k: number): [number, number] => {
    const a = -Math.PI / 2 - Math.PI / N + (2 * Math.PI * k) / N + turn;
    return [R * Math.cos(a), r + R * Math.sin(a)];
  };
  const mat = def.roaming ? 'stone' : 'wood';
  const density = P('density', 0.35) * (def.roaming ? STONE_AS_WOOD : 1);
  const hp = P('hp', def.hp);
  const rim: string[] = [];
  for (let i = 0; i < N; i++) {
    const [x1, y1] = corner(i);
    const [x2, y2] = corner(i + 1);
    // Wedge i: the hub and corners i, i+1 (counter-clockwise), about its centroid.
    const cx = (x1 + x2) / 3;
    const cy = (r + y1 + y2) / 3;
    const id = `wedge${i}`;
    rim.push(id);
    d.poly(
      cx,
      cy,
      [
        [0 - cx, r - cy],
        [x1 - cx, y1 - cy],
        [x2 - cx, y2 - cy],
      ],
      mat,
      { id, densityScale: density, hpScale: hp },
    );
  }
  // Seams along the spokes: wedge i to wedge i+1 across the edge from the hub to corner i+1.
  for (let i = 0; i < N; i++) {
    const [x, y] = corner(i + 1);
    d.weld(rim[i]!, rim[(i + 1) % N]!, { at: [x / 2, (r + y) / 2], seam: R, strength: P('seam', 4), bond: 'steel' });
  }
  // Enough torque to tip it over a corner with some to spare (gravity's pull
  // about the corner, weight x half a side, over the drive's own limit of
  // half its weight x the hub height).
  const drive = 1.5 * (Math.sin(Math.PI / N) / (0.5 * Math.cos(Math.PI / N)));
  return {
    name: def.name,
    weakPoints: rim,
    core: rim[0]!,
    legs: [],
    gait: { speed: P('speed', def.speed), stride: 1, muscles: {} },
    roll: { rim, burst: 3, tip: true },
    drive: P('drive', drive),
    vitals: rim,
    abilities: def.roaming
      ? [{ id: 'roamingWeakSpot', part: rim[0]!, parts: rim.join(','), period: P('period', 3), jitter: 0.5, warn: 0.8, delay: 2.5, burnout: P('burnout', 0.5), facing: 1 }]
      : undefined,
    bounty: def.bounty,
  };
}

for (const def of SHAPES) registerCreature(def.id, (d, rng, params) => buildShape(def, d, rng, params));
