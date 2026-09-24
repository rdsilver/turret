/** Level 9 — PLACEHOLDER (level design agent replaces this file). */
import type { LevelDef } from '../../game/LevelDefinition';

export const level09: LevelDef = {
  id: 'level09',
  name: 'Placeholder 9',
  subtitle: 'A simple stack',
  lesson: '',
  hint: '',
  seed: 9,
  originX: 40,
  blueprint: { modules: [{ type: 'stack', count: 12, w: 1.2, h: 1.2 }] },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 460,
};
