/**
 * Assault levels (the creature campaign): waves of creatures walk at the
 * turret; stop every one before any crosses the defense line.
 */
import type { CreatureParams } from '../sim/creature/CreatureTypes';

/** Sim x (m) of the defense line in front of the turret. */
export const DEFENSE_LINE_X = 9;
/** Default sim x where creatures enter (just off the right edge of the view). */
export const SPAWN_X = 58;

export interface WaveEntry {
  /** Creature blueprint id. */
  creature: string;
  /** Seconds after the level starts. */
  at: number;
  /** Spawn x (sim m); default SPAWN_X. */
  x?: number;
  params?: CreatureParams;
  /** Hint shown when this creature arrives (where a new kind of creature first appears). */
  hint?: string;
}

export interface AssaultLevelDef {
  id: string;
  name: string;
  subtitle: string;
  /** Shown after the level: what this creature teaches. */
  lesson: string;
  /** Shown if the player struggles. */
  hint: string;
  seed: number;
  waves: WaveEntry[];
  /** Base payout for clearing the level. */
  reward: number;
}
