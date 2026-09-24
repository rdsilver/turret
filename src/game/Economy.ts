/**
 * Scoring & payouts. REWARD EFFICIENT DEMOLITION: fewer shots, bigger chain
 * reactions and cleaner collapses pay much more than brute force. OWNER: meta agent.
 */
import type { LevelDef } from './LevelDefinition';

export interface LevelOutcome {
  level: LevelDef;
  /** Shots fired (player shots, not sub-munitions). */
  shots: number;
  /** Money spent on ammunition. */
  ammoCost: number;
  /** Sim seconds from level start to objective met. */
  time: number;
  /** 0..1 of structure mass that fell. */
  destroyedFraction: number;
  /** Largest chain reaction. */
  chainJoints: number;
  chainParts: number;
  chainMass: number;
  jointsBroken: number;
  partsFallen: number;
  /** Shot number that completed the objective. */
  winningShot: number;
  /** Salvage value of fallen material (kg * material.salvage). */
  salvage: number;
  /** Structure total mass (kg). */
  totalMass: number;
}

export type ScoreLineKind = 'base' | 'bonus' | 'cost';

export interface ScoreLine {
  label: string;
  detail?: string;
  amount: number;
  kind: ScoreLineKind;
}

export interface LevelResult {
  lines: ScoreLine[];
  total: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  /** Named style achievements, e.g. "ONE SHOT", "DOMINO EFFECT". */
  titles: string[];
}

export function scoreLevel(o: LevelOutcome): LevelResult {
  void o;
  return { lines: [], total: 0, grade: 'C', titles: [] }; // IMPLEMENT
}
