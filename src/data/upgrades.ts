/**
 * Upgrade catalogue (pure data + stat modifiers). OWNER: meta agent.
 * Branches exist for future tech trees; the prototype ships a few "core"
 * upgrades plus a couple of alternate technologies to prove the system.
 */
import type { WeaponStats } from '../sim/weapons/Weapon';

export type UpgradeBranch = 'core' | 'heavy' | 'rapid' | 'demolition' | 'precision' | 'experimental';

export interface UpgradeDef {
  id: string;
  name: string;
  branch: UpgradeBranch;
  description: string;
  maxLevel: number;
  /** Cost to buy level 1..maxLevel. */
  costs: number[];
  /** Apply the effect of owning `level` (>=1) of this upgrade to the stats (mutate). */
  apply?: (stats: WeaponStats, level: number) => void;
  /** Ammo id unlocked at level 1. */
  unlocksAmmo?: string;
  /** Stress-scanner charges granted per level. */
  scanChargesPerLevel?: number;
  /** Prerequisite. */
  requires?: { id: string; level: number };
}

export const UPGRADES: UpgradeDef[] = []; // IMPLEMENT (meta agent)
