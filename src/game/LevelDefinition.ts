/**
 * Level definitions are pure data: a blueprint (structure modules + seed),
 * an objective (physical destruction rule), and economy parameters.
 */
import type { BlueprintDef } from '../sim/generator/StructureGenerator';
import type { ObjectiveDef } from '../sim/CollapseDetector';

export interface LevelDef {
  id: string;
  /** Display name, e.g. "The Leaning Tower". */
  name: string;
  /** One-line flavour/subtitle shown on the level intro. */
  subtitle: string;
  /** Structural lesson the level teaches (shown after completion). */
  lesson: string;
  /** Optional hint shown after a few unsuccessful shots. */
  hint: string;
  /** Seed used for any randomness in the blueprint. */
  seed: number;
  /** Sim-space x (m) of the blueprint origin (structure center). */
  originX: number;
  blueprint: BlueprintDef;
  objective: ObjectiveDef;
  /** Shots for the top efficiency grade. */
  par: number;
  /** Base payout for demolishing it. */
  reward: number;
  /** Optional camera framing override (sim meters). */
  camera?: { right?: number; top?: number };
}
