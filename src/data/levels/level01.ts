/** Level 1 — PLACEHOLDER (level design agent replaces this file). */
import type { LevelDef } from '../../game/LevelDefinition';

export const level01: LevelDef = {
  id: 'level01',
  name: 'Placeholder 1',
  subtitle: 'A simple stack',
  lesson: '',
  hint: '',
  seed: 1,
  originX: 40,
  blueprint: { modules: [{ type: 'stack', count: 4, w: 1.2, h: 1.2 }] },
  objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  par: 1,
  reward: 140,
};
