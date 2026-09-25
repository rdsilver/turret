/**
 * Persistent run state (money, upgrades, campaign progress, records).
 * Saved to localStorage (guarded; works without it). OWNER: meta agent.
 *
 * Format: versioned JSON under `turret.save.v1`:
 *   { v: 1, savedAt, money, levelIndex, upgrades, selectedAmmo, records, totals..., settings }
 * Loading validates every field (bad / missing values fall back to defaults),
 * so a corrupted or hand-edited save can never crash the game. When storage is
 * unavailable (private mode, Node tools, quota) the game runs from memory.
 */
import type { OwnedUpgrades } from './UpgradeSystem';

export interface LevelRecord {
  completed: boolean;
  bestGrade: string;
  bestShots: number;
  bestPayout: number;
}

/** Player preferences that should survive reloads. */
export interface GameSettings {
  /** 0..1 master volume. */
  volume: number;
  muted: boolean;
  /** 0..1 camera shake / flash intensity (accessibility). */
  shake: number;
}

export const SAVE_KEY = 'turret.save.v1';
export const SAVE_VERSION = 1;

const GRADES = ['S', 'A', 'B', 'C', 'D'];

function defaultSettings(): GameSettings {
  return { volume: 0.8, muted: false, shake: 1 };
}

export class GameState {
  money = 0;
  /** Index of the next campaign level to play. */
  levelIndex = 0;
  /** Index of the next creature (assault) campaign level. */
  assaultIndex = 0;
  upgrades: OwnedUpgrades = {};
  selectedAmmo = 'standard';
  records: Record<string, LevelRecord> = {};
  totalShots = 0;
  totalJointsBroken = 0;
  totalEarned = 0;
  settings: GameSettings = defaultSettings();
  /** False when the last save/load could not touch storage (UI may show a note). */
  persistent = true;

  /** Write to localStorage. Never throws. Returns true if it was stored. */
  save(): boolean {
    const store = storage();
    if (!store) {
      this.persistent = false;
      return false;
    }
    try {
      store.setItem(SAVE_KEY, JSON.stringify(this.toJSON()));
      this.persistent = true;
      return true;
    } catch {
      this.persistent = false;
      return false;
    }
  }

  /** Back to a fresh game (keeps settings) and save. */
  reset(): void {
    const settings = this.settings;
    Object.assign(this, new GameState());
    this.settings = settings;
    this.save();
  }

  /** Best record for a level (undefined if never completed). */
  record(levelId: string): LevelRecord | undefined {
    return this.records[levelId];
  }

  toJSON(): Record<string, unknown> {
    return {
      v: SAVE_VERSION,
      savedAt: Date.now(),
      money: this.money,
      levelIndex: this.levelIndex,
      assaultIndex: this.assaultIndex,
      upgrades: this.upgrades,
      selectedAmmo: this.selectedAmmo,
      records: this.records,
      totalShots: this.totalShots,
      totalJointsBroken: this.totalJointsBroken,
      totalEarned: this.totalEarned,
      settings: this.settings,
    };
  }

  /** Build a state from parsed save data, validating every field. */
  static fromJSON(data: unknown): GameState {
    const gs = new GameState();
    if (!isObj(data)) return gs;
    const d = migrate(data);
    gs.money = int(d.money, 0, 0);
    gs.levelIndex = int(d.levelIndex, 0, 0);
    gs.assaultIndex = int(d.assaultIndex, 0, 0);
    gs.selectedAmmo = typeof d.selectedAmmo === 'string' && d.selectedAmmo ? d.selectedAmmo : 'standard';
    gs.totalShots = int(d.totalShots, 0, 0);
    gs.totalJointsBroken = int(d.totalJointsBroken, 0, 0);
    gs.totalEarned = int(d.totalEarned, 0, 0);
    if (isObj(d.upgrades)) {
      for (const [id, lvl] of Object.entries(d.upgrades)) {
        const n = int(lvl, 0, 0);
        const refund = RETIRED_UPGRADES[id];
        // Upgrades removed from the game give their money back.
        if (refund) gs.money += refund.slice(0, n).reduce((a, c) => a + c, 0);
        else if (n > 0) gs.upgrades[id] = n;
      }
    }
    if (isObj(d.records)) {
      for (const [id, r] of Object.entries(d.records)) {
        if (!isObj(r)) continue;
        gs.records[id] = {
          completed: r.completed === true,
          bestGrade: typeof r.bestGrade === 'string' && GRADES.includes(r.bestGrade) ? r.bestGrade : 'D',
          bestShots: int(r.bestShots, 0, 0),
          bestPayout: int(r.bestPayout, 0, 0),
        };
      }
    }
    if (isObj(d.settings)) {
      const s = d.settings;
      gs.settings = {
        volume: num(s.volume, 0.8, 0, 1),
        muted: s.muted === true,
        shake: num(s.shake, 1, 0, 1),
      };
    }
    return gs;
  }

  static load(): GameState {
    const store = storage();
    if (!store) {
      const gs = new GameState();
      gs.persistent = false;
      return gs;
    }
    try {
      const raw = store.getItem(SAVE_KEY);
      if (!raw) return new GameState();
      return GameState.fromJSON(JSON.parse(raw));
    } catch {
      // Corrupt JSON or storage access denied: start fresh, don't crash.
      const gs = new GameState();
      gs.persistent = false;
      return gs;
    }
  }
}

/** Level costs of upgrades that no longer exist (refunded on load). */
const RETIRED_UPGRADES: Record<string, readonly number[]> = {
  scanner: [100, 190, 320],
};

/** Upgrade older save layouts to the current version (none yet). */
function migrate(d: Record<string, unknown>): Record<string, unknown> {
  // v1 is the first version; future versions add cases here (d.v < 2 => ...).
  return d;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    return localStorage;
  } catch {
    // Accessing localStorage can itself throw (sandboxed iframes, disabled cookies).
    return null;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function int(v: unknown, fallback: number, min: number): number {
  return typeof v === 'number' && isFinite(v) ? Math.max(min, Math.floor(v)) : fallback;
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}

let instance: GameState | null = null;

/** Shared state across scenes. */
export function gameState(): GameState {
  if (!instance) instance = GameState.load();
  return instance;
}

export function resetGameState(): GameState {
  const settings = instance?.settings;
  instance = new GameState();
  if (settings) instance.settings = settings;
  instance.save();
  return instance;
}
