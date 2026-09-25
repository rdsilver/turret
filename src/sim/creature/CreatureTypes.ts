/**
 * Creature definitions. A creature is a structure (parts + joints) whose
 * muscles are driven by a gait, plus a locomotion spec the controller uses:
 * which part is the body ("core"), which joint chains are legs, how it
 * walks, what powers it, and which organs grant abilities.
 *
 * Blueprints are functions that draft the body with StructureDraft (definition
 * space: y up, facing LEFT toward the turret) and return a CreatureSpec that
 * refers to parts and joints by id.
 */
import type { StructureDraft } from '../generator/StructureDraft';
import type { Random } from '../../core/Random';

/** Gait term for one muscle; phase is in cycles (0..1). Angles in radians. */
export interface MuscleGait {
  /** 'sin': bias + amp*sin(2π(φ+phase)); 'swing': bias + amp*max(0, sin(2π(φ+phase))) (knee flex during swing). */
  shape: 'sin' | 'swing' | 'hold';
  amp: number;
  bias: number;
  phase: number;
}

/**
 * Muscle convention: define muscles with a = parent (body side), b = child
 * (limb side). The driven angle is child minus parent, so positive swings the
 * limb forward (toward the turret) for a creature facing left.
 */
export interface LegSpec {
  name: string;
  /** Joint ids from the body outward (hip, knee, ...). Any broken = leg lost. */
  joints: string[];
  /** Part ids in the leg (any wrecked = leg lost). */
  parts: string[];
  /** Part touching the ground (grounding check). */
  foot: string;
}

export interface AbilitySpec {
  id: string;
  /** Organ part that performs it: destroyed / severed organ = ability lost. */
  part: string;
  [param: string]: number | string | boolean;
}

export interface FloatRing {
  /** Part ids that rotate together around the core. */
  parts: string[];
  /** Spin (rad/s; sign = direction). */
  spin: number;
}

export interface FloatSpec {
  rings: FloatRing[];
  /** Core spin (rad/s). */
  spin: number;
  /** Vertical bob amplitude (m) and period (s). */
  bob: number;
  bobPeriod: number;
}

export interface CreatureSpec {
  name: string;
  /** Part id of the body the controller balances and propels. */
  core: string;
  legs: LegSpec[];
  /** Legs needed for full speed; fewer working legs slow it down (quadratically). */
  gait: {
    /** Target walking speed (m/s). */
    speed: number;
    /** Distance covered per gait cycle (m). */
    stride: number;
    muscles: Record<string, MuscleGait>;
  };
  /**
   * Leg groups (by leg name) that each need at least one working leg, e.g. a
   * quadruped's front and back pairs: lose a whole group and it can't walk.
   */
  legGroups?: string[][];
  /** Body tilt (degrees from its upright angle) that counts as downed (default 60). */
  downedTilt?: number;
  /** Upright body angle (degrees, CCW positive in definition space; small forward lean = positive). */
  lean?: number;
  /** Balance assist strength (multiplier; 1 = default). */
  balance?: number;
  /** Propulsion strength (multiplier; 1 = default). */
  drive?: number;
  /** Lift assist on swinging feet, as a multiple of the leg's weight (0 = off). Helps short-legged walkers clear the ground. */
  footLift?: number;
  /** Parts tagged as vital: any destroyed kills the creature (defaults to the core). */
  vitals?: string[];
  /** Engine parts: power follows their integrity and heat. */
  engines?: string[];
  abilities?: AbilitySpec[];
  /** Base payout for stopping it. */
  bounty?: number;
  /**
   * Floating creatures don't walk: every part is moved kinematically. The core
   * drifts toward the turret (gait.speed) with a gentle bob, spinning; each ring
   * of parts rotates rigidly around it. A destroyed ring part drops away; the
   * creature is stopped only by destroying a vital part, after which everything
   * drops.
   */
  float?: FloatSpec;
  /**
   * Cut in two, a piece with at least `min` parts tagged `tag` (and legs) walks
   * on as a creature of its own, led by its front-most tagged part.
   */
  split?: { tag: string; min: number };
}

export interface CreatureParams {
  [k: string]: number | string | boolean | undefined;
}

export type CreatureBlueprint = (draft: StructureDraft, rng: Random, params: CreatureParams) => CreatureSpec;

const blueprints = new Map<string, CreatureBlueprint>();

export function registerCreature(id: string, fn: CreatureBlueprint): void {
  blueprints.set(id, fn);
}

export function getCreatureBlueprint(id: string): CreatureBlueprint {
  const b = blueprints.get(id);
  if (!b) throw new Error(`Unknown creature "${id}" (known: ${[...blueprints.keys()].join(', ')})`);
  return b;
}

export function creatureIds(): string[] {
  return [...blueprints.keys()];
}
