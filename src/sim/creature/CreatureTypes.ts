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

export interface FlyWing {
  /** Joints from the body outward (any broken = wing lost; damage weakens lift). */
  joints: string[];
  /** Wing parts (any wrecked or cut off = wing lost). */
  parts: string[];
}

export interface FlySpec {
  wings: FlyWing[];
  /** Wingbeats per second (the gait muscles run on this clock). */
  flapHz: number;
  /** Lift available with every wing healthy, as a multiple of its weight. */
  liftMax: number;
  /** Gentle altitude swoops around the spawn height (m, s). */
  swoop: number;
  swoopPeriod: number;
}

/** An arm a creature can drag itself along on (CrawlSpec). */
export interface CrawlArm {
  /** Joints from the body outward (shoulder first): any broken = arm lost. */
  joints: string[];
  /** Arm parts (any wrecked or cut off = arm lost). */
  parts: string[];
}

export interface CrawlSpec {
  arms: CrawlArm[];
  /** Crawling speed (m/s, before the game's CREATURE_SPEED, like gait.speed) and reach per pull (m). */
  speed: number;
  stride: number;
  /** The arm muscles' cycle while crawling (drives them instead of the walking gait). */
  muscles: Record<string, MuscleGait>;
  /** Body angle it holds itself at, leaning on its arms (deg, + = toward the turret). */
  lean: number;
  /** Shown when it starts crawling. */
  hint?: string;
}

export interface RollSpec {
  /** Rim part ids in order around the wheel (each joined to the next, the last to the first). */
  rim: string[];
  /** Speed (m/s) the rim parts fly apart with when it is stopped (default 3). */
  burst?: number;
  /**
   * A polygon, not a round wheel: on a flat face it must be tipped over its
   * leading corner, so the drive adds the torque that takes (gravity's pull
   * about that corner) to its spin control.
   */
  tip?: boolean;
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
  /**
   * A sprinter can't stand still on what it has left: once it can't walk (a
   * leg group lost), its legs stop holding it up and balancing it, and it
   * goes down at whatever speed it was running.
   */
  sprinter?: boolean;
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
  /** Where a gunner should aim, best first (parts that are gone are skipped). The top turret uses it. */
  weakPoints?: string[];
  /**
   * Parts a gun firing from above (the top turret on its mast) should try
   * before weakPoints: ones shielded from the side but open from above.
   */
  weakPointsFromAbove?: string[];
  /**
   * Floating creatures don't walk: every part is moved kinematically. The core
   * drifts toward the turret (gait.speed) with a gentle bob, spinning; each ring
   * of parts rotates rigidly around it. A destroyed ring part drops away; the
   * creature is stopped only by destroying a vital part, after which everything
   * drops.
   */
  float?: FloatSpec;
  /**
   * Flying creatures hold their spawn altitude on flapping wings. Lift follows
   * the wings still working (and their damage): lose one and it can't stay
   * up; it is stopped when it comes down.
   */
  fly?: FlySpec;
  /**
   * Cut in two, a piece with at least `min` parts tagged `tag` (and legs) walks
   * on as a creature of its own, led by its front-most tagged part.
   */
  split?: { tag: string; min: number };
  /**
   * Rolling creatures are a wheel: a closed ring of rim parts that spins
   * itself along the ground toward the turret. The drive is a torque inside
   * the ring (no push), so it only gets anywhere by rolling (gait.speed is its
   * rolling speed; spec.drive scales the torque). A broken ring (a rim part
   * wrecked or cut out, a seam torn) downs it; a vital destroyed kills it;
   * either way the ring bursts apart.
   */
  roll?: RollSpec;
  /**
   * Crawlers don't give up when their legs do: legs lost (or knocked down),
   * it drops and drags itself on toward the turret on its arms (a slow pull
   * driven at the body, the arms cycling), until the arms go too or a vital
   * is destroyed. Its body loses its grip on the ground, and it holds itself
   * up at `lean` on the arms.
   */
  crawl?: CrawlSpec;
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
