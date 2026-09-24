/** Level 3 — PLACEHOLDER (level design agent replaces this file). */
import type { LevelDef } from '../../game/LevelDefinition';

export const level03: LevelDef = {
  id: 'level03',
  name: 'Placeholder 3',
  subtitle: 'A simple stack',
  lesson: '',
  hint: '',
  seed: 3,
  originX: 40,
  blueprint: { modules: [{ type: 'stack', count: 6, w: 1.2, h: 1.2 }] },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 220,
};
