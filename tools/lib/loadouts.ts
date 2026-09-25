/**
 * Typical machine-gun builds by campaign level (what a player has bought by
 * then, from the level payouts), for balancing creatures and levels:
 *   --tier 1 (fresh), 4, 5, 6, 7, 8, 10
 */
import { UpgradeSystem, type OwnedUpgrades } from '../../src/game/UpgradeSystem';
import { BASE_MG_STATS, type WeaponStats } from '../../src/sim/weapons/Weapon';

export const TIERS: Record<string, OwnedUpgrades> = {
  '1': {},
  '2': { stabilizer: 1 },
  '3': { stabilizer: 1, caliber: 1, autoloader: 1 },
  '4': { stabilizer: 2, caliber: 2, autoloader: 1, cooling: 1 },
  '5': { stabilizer: 2, caliber: 2, autoloader: 2, cooling: 1, piercing: 1 },
  '6': { stabilizer: 3, caliber: 2, autoloader: 2, cooling: 1, piercing: 1, topTurret: 1 },
  '7': { stabilizer: 3, caliber: 3, autoloader: 2, cooling: 1, piercing: 2, topTurret: 1 },
  '8': { stabilizer: 3, caliber: 3, autoloader: 3, cooling: 2, piercing: 2, topTurret: 2 },
  '9': { stabilizer: 4, caliber: 4, autoloader: 3, cooling: 2, piercing: 2, topTurret: 2 },
  '10': { stabilizer: 4, caliber: 4, autoloader: 3, cooling: 3, piercing: 3, topTurret: 3 },
  '11': { stabilizer: 4, caliber: 5, autoloader: 4, cooling: 3, piercing: 3, topTurret: 3 },
  '12': { stabilizer: 4, caliber: 5, autoloader: 4, cooling: 4, piercing: 3, topTurret: 3 },
};

/** Owned top turret level at a tier (0 = none). */
export function topTurretLevel(tier: string): number {
  return TIERS[tier]?.topTurret ?? 0;
}

export function loadout(tier: string): WeaponStats {
  const owned = TIERS[tier];
  if (!owned) throw new Error(`unknown tier ${tier} (${Object.keys(TIERS).join(', ')})`);
  return new UpgradeSystem().weaponStats(owned, BASE_MG_STATS);
}

/** Workshop spend needed for a tier ($). */
export function tierCost(tier: string): number {
  const sys = new UpgradeSystem();
  let n = 0;
  for (const [id, lvl] of Object.entries(TIERS[tier] ?? {})) {
    const d = sys.defs.find((x) => x.id === id);
    if (d) for (let i = 0; i < lvl; i++) n += d.costs[i] ?? 0;
  }
  return n;
}
