/**
 * Turns owned upgrade levels into weapon stats / unlocks. OWNER: meta agent.
 *
 * Stateless: every query takes the owned levels (usually `gameState().upgrades`).
 * Stats = base weapon stats (machine gun unless given) with each owned def's `apply` run once, in catalogue
 * order. Levels read from a save are clamped to the catalogue's `maxLevel`, and
 * unknown ids are ignored, so old saves survive catalogue changes.
 */
import { UPGRADES, type UpgradeDef } from '../data/upgrades';
import { BASE_MG_STATS, type WeaponStats } from '../sim/weapons/Weapon';
import { AMMO } from '../data/ammo';

export type OwnedUpgrades = Record<string, number>;

export type UpgradeStatus = 'maxed' | 'locked' | 'affordable' | 'expensive';

export interface UpgradePreview {
  label: string;
  /** Current value, e.g. "34.0 m/s". */
  from: string;
  /** Value after buying the next level, e.g. "36.7 m/s" (equals `from` when maxed). */
  to: string;
  /** Ready-made line: "34.0 → 36.7 m/s" (or "43.5 m/s · max"). */
  text: string;
  maxed: boolean;
}

/** Anything with money + owned upgrades (GameState satisfies it). */
export interface Wallet {
  money: number;
  upgrades: OwnedUpgrades;
}

const ARROW = '→';

export class UpgradeSystem {
  private readonly byId = new Map<string, UpgradeDef>();
  /** Creature campaign levels cleared (gates `unlockAfter`); tools leave it open. */
  progress = Infinity;

  constructor(readonly defs: UpgradeDef[] = UPGRADES) {
    for (const d of defs) this.byId.set(d.id, d);
  }

  def(id: string): UpgradeDef | undefined {
    return this.byId.get(id);
  }

  /** Owned level of `id`, clamped to [0, maxLevel]. */
  level(id: string, owned: OwnedUpgrades): number {
    const d = this.byId.get(id);
    if (!d) return 0;
    const raw = owned[id];
    if (typeof raw !== 'number' || !isFinite(raw)) return 0;
    return Math.max(0, Math.min(d.maxLevel, Math.floor(raw)));
  }

  /** Stats for the given base weapon (the machine gun by default; demolition mode passes the cannon). */
  weaponStats(owned: OwnedUpgrades, base: Readonly<WeaponStats> = BASE_MG_STATS): WeaponStats {
    const s: WeaponStats = { ...base };
    for (const d of this.defs) {
      const lvl = this.level(d.id, owned);
      if (lvl > 0 && d.apply) d.apply(s, lvl);
    }
    return s;
  }

  /** Unlocked ammo ids in a stable order: 'standard' first, then catalogue order. */
  unlockedAmmo(owned: OwnedUpgrades): string[] {
    const list = ['standard'];
    for (const d of this.defs) {
      if (d.unlocksAmmo && this.level(d.id, owned) >= 1 && !list.includes(d.unlocksAmmo)) list.push(d.unlocksAmmo);
    }
    return list;
  }

  isMaxed(id: string, owned: OwnedUpgrades): boolean {
    const d = this.byId.get(id);
    return !d || this.level(id, owned) >= d.maxLevel;
  }

  /** Prerequisite satisfied (or none). */
  isUnlocked(id: string, owned: OwnedUpgrades): boolean {
    const d = this.byId.get(id);
    if (!d) return false;
    if (d.unlockAfter !== undefined && this.progress < d.unlockAfter) return false;
    return !d.requires || this.level(d.requires.id, owned) >= d.requires.level;
  }

  /** "Requires HE Shells" (null when available). */
  lockedReason(id: string, owned: OwnedUpgrades): string | null {
    const d = this.byId.get(id);
    if (!d) return 'Unknown upgrade';
    if (this.isUnlocked(id, owned)) return null;
    if (d.unlockAfter !== undefined && this.progress < d.unlockAfter) return `Clear level ${d.unlockAfter}`;
    if (!d.requires) return null;
    const req = this.byId.get(d.requires.id);
    const name = req?.name ?? d.requires.id;
    return req && req.maxLevel > 1 ? `Requires ${name} ${roman(d.requires.level)}` : `Requires ${name}`;
  }

  /** Cost of the next level, or null if maxed / locked. */
  nextCost(id: string, owned: OwnedUpgrades): number | null {
    const d = this.byId.get(id);
    if (!d || !this.isUnlocked(id, owned)) return null;
    const lvl = this.level(id, owned);
    if (lvl >= d.maxLevel) return null;
    return d.costs[lvl] ?? d.costs[d.costs.length - 1] ?? null;
  }

  status(id: string, owned: OwnedUpgrades, money: number): UpgradeStatus {
    if (this.isMaxed(id, owned)) return 'maxed';
    const cost = this.nextCost(id, owned);
    if (cost === null) return 'locked';
    return money >= cost ? 'affordable' : 'expensive';
  }

  canBuy(id: string, wallet: Wallet): boolean {
    return this.status(id, wallet.upgrades, wallet.money) === 'affordable';
  }

  /**
   * Buy the next level: deducts money and bumps the level on `wallet`
   * (mutates; the caller saves). Returns the price paid, or null if not possible.
   */
  purchase(id: string, wallet: Wallet): number | null {
    const cost = this.nextCost(id, wallet.upgrades);
    if (cost === null || wallet.money < cost) return null;
    wallet.money -= cost;
    wallet.upgrades[id] = this.level(id, wallet.upgrades) + 1;
    return cost;
  }

  /** Total money spent on owned upgrades (for stats screens / refunds). */
  invested(owned: OwnedUpgrades): number {
    let sum = 0;
    for (const d of this.defs) {
      const lvl = this.level(d.id, owned);
      for (let i = 0; i < lvl; i++) sum += d.costs[i] ?? 0;
    }
    return sum;
  }

  /** Human readable "current -> next" effect preview, e.g. {label:'Muzzle velocity', from:'34.0 m/s', to:'36.7 m/s'}. */
  preview(id: string, owned: OwnedUpgrades): UpgradePreview | null {
    const d = this.byId.get(id);
    if (!d) return null;
    const lvl = this.level(id, owned);
    const maxed = lvl >= d.maxLevel;
    const next: OwnedUpgrades = { ...owned, [id]: Math.min(d.maxLevel, lvl + 1) };

    if (d.view) {
      const v = d.view;
      const fmt = (o: OwnedUpgrades): string => (Number(this.weaponStats(o)[v.stat] ?? 0) * (v.scale ?? 1)).toFixed(v.digits);
      const a = fmt(owned);
      const b = fmt(next);
      return make(v.label, a, b, v.unit, maxed);
    }
    if (d.unlocksAmmo) {
      const name = AMMO[d.unlocksAmmo]?.name ?? d.unlocksAmmo;
      const from = lvl >= 1 ? name : 'locked';
      return { label: 'Ammunition', from, to: name, text: lvl >= 1 ? `${name} · unlocked` : `Unlocks ${name}`, maxed };
    }
    if (d.id === 'topTurret') {
      const mk = (n: number): string => (n <= 0 ? 'none' : `Mk ${['I', 'II', 'III'][n - 1] ?? n}`);
      return { label: 'Top turret', from: mk(lvl), to: mk(Math.min(d.maxLevel, lvl + 1)), text: maxed ? 'max' : `${mk(lvl)} ${ARROW} ${mk(lvl + 1)}`, maxed };
    }
    return { label: d.name, from: `Lv ${lvl}`, to: `Lv ${Math.min(d.maxLevel, lvl + 1)}`, text: maxed ? 'max' : `Lv ${lvl} ${ARROW} ${lvl + 1}`, maxed };
  }
}

function make(label: string, from: string, to: string, unit: string, maxed: boolean): UpgradePreview {
  const u = unit ? (unit === '°' ? unit : ` ${unit}`) : '';
  return {
    label,
    from: `${from}${u}`,
    to: `${to}${u}`,
    text: maxed ? `${from}${u} · max` : `${from} ${ARROW} ${to}${u}`,
    maxed,
  };
}

function roman(n: number): string {
  return ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'][n] ?? String(n);
}
