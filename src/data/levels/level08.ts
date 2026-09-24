/** Level 8 — PLACEHOLDER (level design agent replaces this file). */
import type { LevelDef } from '../../game/LevelDefinition';

export const level08: LevelDef = {
  id: 'level08',
  name: 'Placeholder 8',
  subtitle: 'A simple stack',
  lesson: '',
  hint: '',
  seed: 8,
  originX: 40,
  blueprint: { modules: [{ type: 'stack', count: 11, w: 1.2, h: 1.2 }] },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 420,
};
