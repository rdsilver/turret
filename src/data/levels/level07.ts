/** Level 7 — PLACEHOLDER (level design agent replaces this file). */
import type { LevelDef } from '../../game/LevelDefinition';

export const level07: LevelDef = {
  id: 'level07',
  name: 'Placeholder 7',
  subtitle: 'A simple stack',
  lesson: '',
  hint: '',
  seed: 7,
  originX: 40,
  blueprint: { modules: [{ type: 'stack', count: 10, w: 1.2, h: 1.2 }] },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 380,
};
