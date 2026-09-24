/** Campaign order. Each level lives in its own file (pure data). */
import '../../sim/generator/modules';
import type { LevelDef } from '../../game/LevelDefinition';
import { level01 } from './level01';
import { level02 } from './level02';
import { level03 } from './level03';
import { level04 } from './level04';
import { level05 } from './level05';
import { level06 } from './level06';
import { level07 } from './level07';
import { level08 } from './level08';
import { level09 } from './level09';
import { level10 } from './level10';

export const LEVELS: LevelDef[] = [level01, level02, level03, level04, level05, level06, level07, level08, level09, level10];
