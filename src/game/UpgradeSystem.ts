/** Turns owned upgrade levels into weapon stats / unlocks. OWNER: meta agent. */
import { UPGRADES, type UpgradeDef } from '../data/upgrades';
import { BASE_WEAPON_STATS, type WeaponStats } from '../sim/weapons/Weapon';

export type OwnedUpgrades = Record<string, number>;

export class UpgradeSystem {
  constructor(readonly defs: UpgradeDef[] = UPGRADES) {}

  weaponStats(owned: OwnedUpgrades): WeaponStats {
    void owned;
    return { ...BASE_WEAPON_STATS }; // IMPLEMENT
  }

  unlockedAmmo(owned: OwnedUpgrades): string[] {
    void owned;
    return ['standard']; // IMPLEMENT
  }

  scanCharges(owned: OwnedUpgrades): number {
    void owned;
    return 0; // IMPLEMENT
  }

  /** Cost of the next level, or null if maxed / locked. */
  nextCost(id: string, owned: OwnedUpgrades): number | null {
    void id;
    void owned;
    return null; // IMPLEMENT
  }

  /** Human readable "current -> next" effect preview, e.g. {label:'Muzzle velocity', from:'34 m/s', to:'37 m/s'}. */
  preview(id: string, owned: OwnedUpgrades): { label: string; from: string; to: string } | null {
    void id;
    void owned;
    return null; // IMPLEMENT
  }
}
