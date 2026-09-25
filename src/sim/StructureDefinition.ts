/**
 * Serializable structure descriptions (pure data, JSON friendly).
 *
 * All coordinates here are in DEFINITION SPACE:
 *   x: meters to the right of the structure origin
 *   y: meters ABOVE the ground (up is positive)
 *   angle: degrees, counter-clockwise
 * StructureBuilder converts to simulation space.
 */
import type { MaterialId } from './Materials';

export type PartShapeDef =
  | { kind: 'box'; w: number; h: number }
  | { kind: 'circle'; r: number }
  /** Convex polygon, local points (definition space, y up), counter-clockwise. */
  | { kind: 'poly'; points: ReadonlyArray<readonly [number, number]> };

/** Semantic tags gameplay systems care about. Free-form strings are allowed too. */
export type PartTag =
  | 'core' // protected core: objectives may require it to hit the ground
  | 'required' // must stay connected for the structure to count as standing
  | 'foundation' // excluded from "fallen mass" accounting
  | 'counterweight'
  | 'keystone'
  | 'weakpoint'
  | 'decor'
  | (string & {});

export interface PartDef {
  /** Optional unique name so joints/objectives can reference it. */
  id?: string;
  shape: PartShapeDef;
  x: number;
  y: number;
  angle?: number;
  material: MaterialId;
  /** Static part (does not move). Use sparingly: anchors, bedrock. */
  fixed?: boolean;
  tags?: PartTag[];
  densityScale?: number;
  friction?: number;
  restitution?: number;
  /** Multiplier on weapon-damage hit points (armoured organs, fragile weak spots). */
  hpScale?: number;
}

export type JointKind = 'weld' | 'hinge' | 'cable' | 'muscle';

/**
 * A powered joint (creatures). 'servo' drives the relative angle toward a
 * target set every step by a controller (legs, arms); 'spin' drives angular
 * velocity (wheels, rotors). Torque is capped: an overpowered muscle gives
 * way, and bending far past its anatomical range snaps it.
 */
export interface MuscleDef {
  /** Max torque at full power and health (N*m). */
  torque: number;
  mode?: 'servo' | 'spin';
  /** Servo stiffness as a natural frequency (rad/s); lower = softer, more organic. Default 30. */
  omega?: number;
  /** Anatomical range relative to the rest pose (degrees). Default +-120. */
  min?: number;
  max?: number;
}

/** Reference to a part: its index in `parts`, its `id`, or the ground. */
export type PartRef = number | string;
export const GROUND = 'ground' as const;

export interface JointDef {
  kind: JointKind;
  /** Optional name (creature controllers address muscles by name). */
  id?: string;
  /** Muscle parameters (kind 'muscle' only). */
  muscle?: MuscleDef;
  a: PartRef;
  b: PartRef | typeof GROUND;
  /** Anchor point for weld/hinge (definition space). Defaults to the midpoint of both centers. */
  at?: readonly [number, number];
  /** Cable anchor on A (definition space, world position at build time). */
  anchorA?: readonly [number, number];
  /** Cable anchor on B (definition space). */
  anchorB?: readonly [number, number];
  /** Cable rest length; default is the build-time anchor distance. */
  length?: number;
  /** Seam length in meters (drives weld strength). Defaults to the smaller part dimension. */
  seam?: number;
  /** Multiplier on the computed bond strength (0.3 = conspicuously weak joint). */
  strength?: number;
  /** Use this material's bond instead of the weaker of the two parts. */
  bond?: MaterialId;
  /** Free-form tags (e.g. 'weakpoint' to help level validation / hints). */
  tags?: string[];
}

export interface StructureDef {
  /** World x (simulation meters) where definition-space x = 0 lands. */
  originX: number;
  parts: PartDef[];
  joints: JointDef[];
  /** Designer notes / metadata carried through for debugging. */
  meta?: {
    name?: string;
    seed?: number;
    generator?: string;
    [k: string]: unknown;
  };
}
