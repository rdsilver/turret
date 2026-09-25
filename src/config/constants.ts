/**
 * Engine-agnostic constants shared by the simulation (runs in the browser and
 * in Node for headless tests) and the Phaser view layer.
 *
 * Coordinate conventions
 * ----------------------
 * Simulation space: meters, +x right, +y DOWN, ground surface at y = 0.
 * Angles are radians; positive = clockwise on screen (same as Phaser).
 *
 * Level/definition space (what level designers write): meters, +x right,
 * +y UP (height above ground), angles in degrees counter-clockwise.
 * Conversion happens exclusively in StructureBuilder / defs helpers.
 */

export const PHYSICS_HZ = 60;
export const PHYSICS_DT = 1 / PHYSICS_HZ;
/** Never run more than this many physics steps in one rendered frame (avoids spiral of death). */
export const MAX_STEPS_PER_FRAME = 5;

/** Slightly heavier than Earth: collapses read as massive but not floaty. */
export const DEFAULT_GRAVITY = 12;

/** Solver iterations. Higher = stiffer joint chains and stacks, linear cost. */
export const SOLVER_ITERATIONS = 8;
export const INTERNAL_PGS_ITERATIONS = 1;

/** Render scale: pixels per meter. */
export const PPM = 30;

/** Logical canvas size (Scale.FIT keeps aspect). */
export const VIEW_WIDTH = 1920;
export const VIEW_HEIGHT = 1080;

/** Arena extents in simulation meters. */
export const ARENA = {
  /** Left wall of the arena (behind the turret). */
  left: -12,
  /** Right edge of the arena. */
  right: 110,
  /** Anything that falls below this (sim y, i.e. below ground) is deleted. */
  killY: 40,
  /** Anything above this height is considered escaped (sim y, negative = up). */
  ceilingY: -160,
} as const;

/** Turret pivot location in simulation space. */
/** Every creature is built at this multiple of its blueprint size. */
export const CREATURE_SCALE = 3;

export const TURRET = {
  x: 2.5,
  /** Pivot height above ground (meters). */
  pivotHeight: 2.6,
  barrelLength: 3.4,
  minAngleDeg: -82, // pointing nearly straight up (sim angle, negative = up)
  maxAngleDeg: 12, // slightly below horizontal
} as const;

/** Collision groups (16-bit membership << 16 | 16-bit filter). */
export const GROUP = {
  GROUND: 0x0001,
  STRUCTURE: 0x0002,
  PROJECTILE: 0x0004,
  DEBRIS: 0x0008,
  GRAB: 0x0010,
  TURRET: 0x0020,
  /** Creature parts: don't collide with other creature parts (legs cross in 2D). */
  CREATURE: 0x0040,
} as const;

export function interactionGroups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}
