/**
 * Upgrade catalogue (pure data + stat modifiers). OWNER: meta agent.
 *
 * Every upgrade is a data record: costs per level, an optional stat modifier
 * (`apply`, called once with the owned level, in catalogue order), an optional
 * ammo unlock and a prerequisite. `UpgradeSystem` turns owned
 * levels into WeaponStats; the workshop UI renders this list grouped by
 * `branch` (see UPGRADE_BRANCHES for display order / names).
 *
 * Tuning targets (see tools/economy-check.ts): a par-ish clear pays ~150 at
 * level 1 and ~700 at level 10, i.e. one or two purchases per level. First
 * velocity / mass levels cost ~80–120; the top levels need clean one-shots.
 */
import type { WeaponStats } from '../sim/weapons/Weapon';

export type UpgradeBranch = 'core' | 'heavy' | 'rapid' | 'demolition' | 'precision' | 'experimental' | 'support';

/** How the workshop shows an upgrade's effect ("Muzzle velocity 34.0 → 36.7 m/s"). */
export interface UpgradeStatView {
  label: string;
  stat: keyof WeaponStats;
  unit: string;
  /** Multiply the raw stat before display (e.g. radians -> degrees). */
  scale?: number;
  digits: number;
}

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
  /** Prerequisite. */
  requires?: { id: string; level: number };
  /** Workshop text in creature (assault) mode, when the cannon wording doesn't fit. */
  assaultDescription?: string;
  /** Creature campaign levels that must be cleared before it can be bought. */
  unlockAfter?: number;
  /** Game modes whose workshop lists it (default: both). */
  modes?: Array<'assault' | 'campaign'>;
  /** Primary stat shown in the "from → to" preview (stat upgrades only). */
  view?: UpgradeStatView;
  /** Short per-level effect summary for cards, e.g. "+8% muzzle velocity / level". */
  perLevel?: string;
}

export interface UpgradeBranchInfo {
  id: UpgradeBranch;
  name: string;
  description: string;
}

/** Display order + names for the workshop. Branches without defs are skipped by the UI. */
export const UPGRADE_BRANCHES: UpgradeBranchInfo[] = [
  { id: 'core', name: 'Cannon', description: 'Muzzle, shell and loader. More energy per shot, faster follow-ups.' },
  { id: 'precision', name: 'Precision', description: 'See further, hit exactly where the structure is weakest.' },
  { id: 'demolition', name: 'Demolition', description: 'Chemical energy: shells that break joints on their own.' },
  { id: 'heavy', name: 'Heavy', description: 'Mass and momentum.' },
  { id: 'rapid', name: 'Rapid', description: 'Rate of fire.' },
  { id: 'experimental', name: 'Experimental', description: 'Rounds that change the physics instead of adding force.' },
  { id: 'support', name: 'Support', description: 'Extra guns that fight on their own.' },
];

const DEG = Math.PI / 180;

export const UPGRADES: UpgradeDef[] = [
  // ------------------------------------------------------------------ core
  {
    id: 'velocity',
    name: 'Muzzle Velocity',
    branch: 'core',
    description: 'Longer barrel, hotter charge. Flatter trajectories and more kinetic energy on impact (E ∝ v²).',
    maxLevel: 5,
    costs: [90, 170, 280, 430, 640],
    perLevel: '+8% muzzle velocity',
    apply: (s, lvl) => {
      s.muzzleVelocity *= 1 + 0.08 * lvl;
    },
    view: { label: 'Muzzle velocity', stat: 'muzzleVelocity', unit: 'm/s', digits: 1 },
    assaultDescription: 'Longer barrel, hotter charge. Flatter trajectories: less lead on distant targets, and rounds arrive sooner.',
  },
  {
    id: 'mass',
    name: 'Shell Mass',
    branch: 'core',
    description: 'Denser, slightly larger shells. More momentum per hit: pushes columns instead of chipping them.',
    maxLevel: 5,
    costs: [110, 190, 310, 470, 690],
    perLevel: '+22% shell mass',
    apply: (s, lvl) => {
      const k = 1 + 0.22 * lvl;
      s.projectileMass *= k;
      // Radius grows a little (~+20% at max) so heavier shells read as heavier.
      s.projectileRadius *= Math.pow(k, 0.25);
    },
    view: { label: 'Shell mass', stat: 'projectileMass', unit: 'kg', digits: 0 },
    modes: ['campaign'],
  },
  {
    id: 'autoloader',
    name: 'Autoloader',
    branch: 'core',
    description: 'Mechanical breech loader. Follow-up shots land while the structure is still swaying.',
    maxLevel: 4,
    costs: [80, 150, 260, 420],
    perLevel: '−15% reload time',
    apply: (s, lvl) => {
      s.reloadTime *= Math.pow(0.85, lvl);
    },
    view: { label: 'Reload', stat: 'reloadTime', unit: 's', digits: 2 },
    assaultDescription: 'Belt feed and a faster bolt. More rounds per second (and more heat per second).',
  },
  {
    id: 'stabilizer',
    name: 'Stabilizer',
    branch: 'core',
    description: 'Gyro-damped mount: tighter grouping, less recoil. Makes high lobs land where you aim them.',
    maxLevel: 4,
    costs: [70, 140, 240, 380],
    perLevel: '−35% spread, −12% recoil',
    apply: (s, lvl) => {
      s.spread *= Math.pow(0.65, lvl);
      s.recoil *= Math.pow(0.88, lvl);
    },
    view: { label: 'Spread (1σ)', stat: 'spread', unit: '°', scale: 1 / DEG, digits: 2 },
    assaultDescription: 'Gyro-damped mount: tighter grouping. Hit the knee you aimed at, not the thigh next to it.',
  },

  // ------------------------------------------------------------------ precision
  {
    id: 'ballistics',
    name: 'Ballistics Computer',
    branch: 'precision',
    description: 'Solves the flight path further ahead. The trajectory preview extends toward the impact point.',
    maxLevel: 3,
    costs: [60, 150, 280],
    perLevel: '+0.7 s trajectory preview',
    apply: (s, lvl) => {
      s.previewTime += 0.7 * lvl;
    },
    view: { label: 'Trajectory preview', stat: 'previewTime', unit: 's', digits: 2 },
    assaultDescription: 'Solves the flight path further ahead. The tracer line extends toward the impact point.',
  },

  // ------------------------------------------------------------------ support
  {
    id: 'topTurret',
    name: 'Top Turret',
    branch: 'support',
    description: 'A second, automatic gun on a mast above the turret. It picks the creature closest to the line and goes for its weak points on its own.',
    maxLevel: 3,
    costs: [380, 420, 600],
    perLevel: 'mount it · faster fire · heavier, tighter rounds',
    modes: ['assault'],
    unlockAfter: 5,
  },

  // ------------------------------------------------------------------ machine gun
  {
    id: 'caliber',
    name: 'Heavier Caliber',
    branch: 'rapid',
    description: 'Bigger rounds wear parts down faster: joints give way after fewer hits.',
    maxLevel: 5,
    costs: [80, 150, 250, 400, 600],
    perLevel: '+25% damage per round',
    apply: (s, lvl) => {
      if (s.damage !== undefined) s.damage *= 1 + 0.25 * lvl;
    },
    view: { label: 'Damage per round', stat: 'damage', unit: '', digits: 2 },
    modes: ['assault'],
  },
  {
    id: 'piercing',
    name: 'Armour-Piercing Rounds',
    branch: 'rapid',
    description: 'Hardened penetrator cores. Rounds punch through steel and armour plate instead of sparking off it.',
    maxLevel: 3,
    costs: [180, 320, 520],
    perLevel: 'ignores more armour',
    apply: (s, lvl) => {
      s.armorPierce = 1 - Math.pow(0.6, lvl);
    },
    view: { label: 'Armour ignored', stat: 'armorPierce', unit: '%', scale: 100, digits: 0 },
    modes: ['assault'],
  },
  {
    id: 'cooling',
    name: 'Barrel Cooling',
    branch: 'rapid',
    description: 'Fins and a water jacket: the barrel sheds heat faster and each shot heats it less.',
    maxLevel: 4,
    costs: [70, 140, 240, 380],
    perLevel: '+25% cooling, -8% heat per shot',
    apply: (s, lvl) => {
      if (s.coolRate !== undefined) s.coolRate *= 1 + 0.25 * lvl;
      if (s.heatPerShot !== undefined) s.heatPerShot *= 1 - 0.08 * lvl;
    },
    view: { label: 'Cooling', stat: 'coolRate', unit: '/s', digits: 2 },
    modes: ['assault'],
  },

  // ------------------------------------------------------------------ demolition
  {
    id: 'he',
    name: 'HE Shells',
    branch: 'demolition',
    description: 'High-explosive rounds detonate on contact: the blast snaps nearby joints and sets off explosive crates.',
    maxLevel: 1,
    costs: [340],
    unlocksAmmo: 'explosive',
    modes: ['campaign'],
  },
  {
    id: 'cluster',
    name: 'Cluster Shells',
    branch: 'demolition',
    description: 'Splits into bomblets at the top of the arc. Wide coverage for spread-out structures.',
    maxLevel: 1,
    costs: [620],
    unlocksAmmo: 'cluster',
    requires: { id: 'he', level: 1 },
    modes: ['campaign'],
  },

  // ------------------------------------------------------------------ experimental
  {
    id: 'cryo',
    name: 'Cryo Rounds',
    branch: 'experimental',
    description: 'Flash-freezes the impact zone: nearby joints turn brittle for a few seconds. Weaken first, then push.',
    maxLevel: 1,
    costs: [460],
    unlocksAmmo: 'freeze',
    modes: ['campaign'],
  },
];

/** Lookup by id (undefined for unknown ids, e.g. from an old save). */
export function upgradeDef(id: string): UpgradeDef | undefined {
  return UPGRADES.find((u) => u.id === id);
}
