/**
 * Where the player is in the creature campaign, and the endless waves after
 * it. Progress is saved as an index (GameState.assaultIndex); levels added in
 * the middle of the campaign after a save was made would be skipped by it, so
 * the next level is the first one before that index that was never cleared.
 */
import type { AssaultLevelDef } from './AssaultLevel';
import type { GameState } from './GameState';
import { ASSAULT_LEVELS } from '../data/assault/levels';
import { hashString } from '../core/Random';

/** Base walking speed (m/s) of each creature in endless waves. */
const ENDLESS_ROSTER: Array<[string, number]> = [
  ['stickman', 1.0],
  ['hound', 1.5],
  ['thrower', 0.8],
  ['engine', 0.8],
  ['beetle', 0.55],
  ['shield', 0.75],
  ['hound', 1.5],
  ['centipede', 0.9],
  ['bird', 3.0],
  ['bomber', 0.75],
];

/**
 * Endless waves after the campaign: more, faster, mixed creatures (a boss every
 * fifth wave: the strider and the tyrant take turns; the triceratops every
 * fifth from the eighth; a shifter every third from the second, tougher as
 * the waves go on; and from the fourth, every other wave, a mender arriving
 * behind the second creature so it always has someone to heal).
 */
export function endlessAssault(k: number): AssaultLevelDef {
  const n = 3 + Math.floor(k * 0.8);
  const faster = 1 + Math.min(0.5, k * 0.05);
  const waves: AssaultLevelDef['waves'] = [];
  for (let i = 0; i < n; i++) {
    const [creature, speed] = ENDLESS_ROSTER[(i * 3 + k) % ENDLESS_ROSTER.length]!;
    waves.push({ creature, at: 1 + i * Math.max(4, 9 - k * 0.3), params: { speed: speed * faster } });
  }
  if (k % 5 === 4) {
    const rex = Math.floor(k / 5) % 2 === 1;
    waves.push(rex ? { creature: 'trex', at: 2, params: { speed: 0.5 * faster } } : { creature: 'strider', at: 2, params: { speed: 0.45 * faster } });
  }
  if (k >= 7 && k % 5 === 2) waves.push({ creature: 'triceratops', at: 2, params: { speed: 0.6 * faster } });
  if (k >= 1 && k % 3 === 1) waves.push({ creature: 'shifter', at: 6, params: { speed: 0.65 * faster, hp: Math.min(1.4, 1 + k * 0.03) } });
  if (k >= 3 && k % 2 === 1) waves.push({ creature: 'mender', at: 1 + Math.max(4, 9 - k * 0.3) + 6, params: { heal: Math.min(3, 1.5 + k * 0.1) } });
  return {
    id: `assault-endless-${k}`,
    name: `Endless Wave ${String(k + 1).padStart(2, '0')}`,
    subtitle: `${waves.length} creatures. They keep coming.`,
    lesson: 'Prioritise: the fastest threat first, then whatever is closest to the line.',
    hint: 'Short bursts. Cool the barrel between targets.',
    seed: hashString(`assault-endless-${k}`),
    reward: 300 + k * 60,
    waves,
  };
}

/** Level definition at an assault index: a campaign level, or an endless wave past the end. */
export function assaultLevelAt(index: number): AssaultLevelDef {
  return index < ASSAULT_LEVELS.length ? ASSAULT_LEVELS[index]! : endlessAssault(index - ASSAULT_LEVELS.length);
}

/** Index of the level to play next (>= ASSAULT_LEVELS.length means an endless wave). */
export function nextAssaultIndex(gs: GameState): number {
  const n = Math.max(0, Math.floor(gs.assaultIndex));
  for (let i = 0; i < Math.min(n, ASSAULT_LEVELS.length); i++) {
    if (!gs.records[ASSAULT_LEVELS[i]!.id]?.completed) return i;
  }
  return n;
}

/** Campaign levels cleared. */
export function assaultCleared(gs: GameState): number {
  return ASSAULT_LEVELS.filter((l) => gs.records[l.id]?.completed).length;
}
