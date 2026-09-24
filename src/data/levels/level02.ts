/** Level 2 — PLACEHOLDER (level design agent replaces this file). */
import type { LevelDef } from '../../game/LevelDefinition';

export const level02: LevelDef = {
  id: 'level02',
  name: 'Placeholder 2',
  subtitle: 'A simple stack',
  lesson: '',
  hint: '',
  seed: 2,
  originX: 40,
  blueprint: { modules: [{ type: 'stack', count: 5, w: 1.2, h: 1.2 }] },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 180,
};
