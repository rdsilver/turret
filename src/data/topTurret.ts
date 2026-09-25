/**
 * The top turret: an automatic gun on a mast above the main turret, bought in
 * the workshop (upgrade 'topTurret'). Lighter and less accurate than the
 * player's gun; it shares the ammunition belt (armour-piercing rounds). It has
 * its own cooling: it never overheats and never stops firing while there is a
 * target, whatever the main gun is doing.
 */
import type { WeaponStats } from '../sim/weapons/Weapon';

const DEG = Math.PI / 180;

export const TOP_TURRET_STATS: Readonly<WeaponStats> = {
  muzzleVelocity: 62,
  projectileMass: 0.4,
  projectileRadius: 0.06,
  reloadTime: 1 / 6,
  spread: 2.2 * DEG,
  recoil: 0.06,
  impactMultiplier: 1,
  previewTime: 0,
  automatic: true,
  damage: 0.22,
};

/** Stats at an owned upgrade level (1..3); `main` supplies shared ammo traits. */
export function topTurretStats(level: number, main: Readonly<WeaponStats>): WeaponStats {
  const s: WeaponStats = { ...TOP_TURRET_STATS };
  if (level >= 2) s.reloadTime *= 0.7;
  if (level >= 3) {
    s.damage = (s.damage ?? 1) * 1.5;
    s.spread *= 0.6;
  }
  s.armorPierce = main.armorPierce;
  return s;
}
