/** Level 6 — PLACEHOLDER (level design agent replaces this file). */
import type { LevelDef } from '../../game/LevelDefinition';

export const level06: LevelDef = {
  id: 'level06',
  name: 'Placeholder 6',
  subtitle: 'A simple stack',
  lesson: '',
  hint: '',
  seed: 6,
  originX: 40,
  blueprint: { modules: [{ type: 'stack', count: 9, w: 1.2, h: 1.2 }] },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 340,
};
