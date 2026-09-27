/**
 * SHAPES — hollow polygons that tumble at the line, like the Roller: a ring
 * of straight rim segments, one per side, joined at the corners, with
 * nothing inside. A triangle, a square, a pentagon, a hexagon and a
 * heptagon, each with two wooden sides and the rest steel (the triangle is a
 * third steel, the square half, the heptagon five sevenths); which sides are
 * steel is random. Then a stone octagon. Each rolls by tipping over its
 * leading corner and falling onto the next face (rolling.ts, RollSpec.tip):
 * the fewer the sides, the harder it lurches.
 *
 * Wreck any one side (or tear a corner) and the ring bursts apart. The steel
 * sides shrug off rounds (they weigh what wood would, so the ring stays
 * balanced); the wooden ones are the weak points, and they turn with the
 * ring, so shoot them while they face you. The more sides, the rarer that is.
 *
 * The OCTAGON is stone and can only be hurt in one side at a time, the one
 * that glows (the Shifter's roaming weak spot, weakSpot.ts): the glow jumps
 * at random to another side turned toward the turret every few seconds,
 * sooner once a visit has worn half off it or the roll has carried it out
 * of sight, and the damage stays. A side breaks on its second good visit.
 *
 * Params: speed, radius (circumradius), rim (thickness), hp (a side's hit
 * points), density, seam (corner strength), angle (degrees it starts turned
 * by); octagon: period, burnout.
 */
import { registerCreature, type CreatureSpec } from '../CreatureTypes';
import type { StructureDraft } from '../../generator/StructureDraft';
import type { CreatureParams } from '../CreatureTypes';
import { Random, hashString } from '../../../core/Random';
import { DEG } from '../../../core/math';
import { steelInWood } from './kit';

interface ShapeDef {
  id: string;
  name: string;
  sides: number;
  speed: number;
  radius: number;
  hp: number;
  bounty: number;
  /** Stone, hurt only in one roaming side at a time. */
  roaming?: boolean;
}

const SHAPES: ShapeDef[] = [
  { id: 'triangle', name: 'Triangle', sides: 3, speed: 0.8, radius: 0.8, hp: 1.6, bounty: 60 },
  { id: 'square', name: 'Square', sides: 4, speed: 0.85, radius: 0.75, hp: 1.6, bounty: 70 },
  { id: 'pentagon', name: 'Pentagon', sides: 5, speed: 0.9, radius: 0.75, hp: 1.75, bounty: 80 },
  { id: 'hexagon', name: 'Hexagon', sides: 6, speed: 0.95, radius: 0.75, hp: 1.85, bounty: 90 },
  { id: 'heptagon', name: 'Heptagon', sides: 7, speed: 1, radius: 0.78, hp: 1.95, bounty: 100 },
  { id: 'octagon', name: 'Octagon', sides: 8, speed: 0.8, radius: 0.85, hp: 0.8, bounty: 160, roaming: true },
];

/** Wood's density over stone's: a stone octagon weighs what a wooden one would. */
const STONE_AS_WOOD = 520 / 2500;
/** Wooden sides of every shape but the octagon (the rest are steel). */
const WOOD_SIDES = 2;

function buildShape(def: ShapeDef, d: StructureDraft, rng: Random, params: CreatureParams): CreatureSpec {
  const P = (k: string, v: number) => (typeof params[k] === 'number' ? (params[k] as number) : v);
  const N = def.sides;
  const R = P('radius', def.radius);
  const T = P('rim', 0.2);
  // Resting on a face: the hub sits at the inradius.
  const r = R * Math.cos(Math.PI / N);
  // Inner corners: the rim is T thick everywhere (mitred at the corners).
  const Ri = R - T / Math.cos(Math.PI / N);
  const turn = P('angle', 0) * DEG;
  // Corner k at radius `at` (y up): the bottom face is level at turn 0.
  const corner = (k: number, at: number): [number, number] => {
    const a = -Math.PI / 2 - Math.PI / N + (2 * Math.PI * k) / N + turn;
    return [at * Math.cos(a), r + at * Math.sin(a)];
  };
  // Which sides are steel (its own stream: builds from nearby seeds would draw alike from the shared one).
  const pick = new Random(hashString(`${def.id}:${rng.seed}`));
  const order = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) {
    const k = Math.floor(pick.next() * (i + 1));
    [order[i], order[k]] = [order[k]!, order[i]!];
  }
  const steel = new Set(def.roaming ? [] : order.slice(WOOD_SIDES));
  const density = P('density', 0.35) * (def.roaming ? STONE_AS_WOOD : 1);
  const hp = P('hp', def.hp);
  const rim: string[] = [];
  for (let i = 0; i < N; i++) {
    // Side i: outer corners i, i+1, then inner corners i+1, i (counter-clockwise), about their middle.
    const pts = [corner(i, R), corner(i + 1, R), corner(i + 1, Ri), corner(i, Ri)];
    const cx = pts.reduce((a, q) => a + q[0], 0) / 4;
    const cy = pts.reduce((a, q) => a + q[1], 0) / 4;
    const id = `side${i}`;
    rim.push(id);
    d.poly(
      cx,
      cy,
      pts.map(([x, y]) => [x - cx, y - cy] as [number, number]),
      def.roaming ? 'stone' : 'wood',
      { id, densityScale: density, hpScale: hp },
    );
    if (steel.has(i)) steelInWood(d.parts[d.parts.length - 1]!);
  }
  // Corners: side i to side i+1 across the mitre at corner i+1.
  for (let i = 0; i < N; i++) {
    const [xo, yo] = corner(i + 1, R);
    const [xi, yi] = corner(i + 1, Ri);
    d.weld(rim[i]!, rim[(i + 1) % N]!, { at: [(xo + xi) / 2, (yo + yi) / 2], seam: T / Math.cos(Math.PI / N), strength: P('seam', 4), bond: 'steel' });
  }
  // Enough torque to tip it over a corner with some to spare (gravity's pull
  // about the corner, weight x half a side, over the drive's own limit of
  // half its weight x the hub height).
  const drive = 1.5 * (Math.sin(Math.PI / N) / (0.5 * Math.cos(Math.PI / N)));
  const wood = rim.filter((_, i) => !steel.has(i));
  return {
    name: def.name,
    // Only the wood is worth shooting (the octagon: whichever side glows).
    weakPoints: wood,
    core: wood[0]!,
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
