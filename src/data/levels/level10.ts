/** Level 10 — PLACEHOLDER (level design agent replaces this file). */
import type { LevelDef } from '../../game/LevelDefinition';

export const level10: LevelDef = {
  id: 'level10',
  name: 'Placeholder 10',
  subtitle: 'A simple stack',
  lesson: '',
  hint: '',
  seed: 10,
  originX: 40,
  blueprint: { modules: [{ type: 'stack', count: 13, w: 1.2, h: 1.2 }] },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 500,
};
