/** Level 5 — PLACEHOLDER (level design agent replaces this file). */
import type { LevelDef } from '../../game/LevelDefinition';

export const level05: LevelDef = {
  id: 'level05',
  name: 'Placeholder 5',
  subtitle: 'A simple stack',
  lesson: '',
  hint: '',
  seed: 5,
  originX: 40,
  blueprint: { modules: [{ type: 'stack', count: 8, w: 1.2, h: 1.2 }] },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 300,
};
