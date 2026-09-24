/**
 * Persistent run state (money, upgrades, campaign progress, records).
 * Saved to localStorage (guarded; works without it). OWNER: meta agent.
 */
import type { OwnedUpgrades } from './UpgradeSystem';

export interface LevelRecord {
  completed: boolean;
  bestGrade: string;
  bestShots: number;
  bestPayout: number;
}

export class GameState {
  money = 0;
  /** Index of the next campaign level to play. */
  levelIndex = 0;
  upgrades: OwnedUpgrades = {};
  selectedAmmo = 'standard';
  records: Record<string, LevelRecord> = {};
  totalShots = 0;
  totalJointsBroken = 0;
  totalEarned = 0;

  save(): void {} // IMPLEMENT

  reset(): void {} // IMPLEMENT

  static load(): GameState {
    return new GameState(); // IMPLEMENT
  }
}

let instance: GameState | null = null;

/** Shared state across scenes. */
export function gameState(): GameState {
  if (!instance) instance = GameState.load();
  return instance;
}

export function resetGameState(): GameState {
  instance = new GameState();
  instance.save();
  return instance;
}
