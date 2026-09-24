/**
 * Campaign levels + procedural levels -> StructureDefs.
 */
import { LEVELS } from '../data/levels';
import type { LevelDef } from './LevelDefinition';
import { generateStructure } from '../sim/generator/StructureGenerator';
import { randomBlueprint } from '../sim/generator/ProceduralGenerator';
import type { StructureDef } from '../sim/StructureDefinition';
import '../sim/generator/modules';

export class LevelManager {
  readonly levels: LevelDef[] = LEVELS;

  get count(): number {
    return this.levels.length;
  }

  get(index: number): LevelDef {
    return this.levels[Math.max(0, Math.min(this.levels.length - 1, index))]!;
  }

  build(level: LevelDef, seedOverride?: number): StructureDef {
    return generateStructure(level.blueprint, seedOverride ?? level.seed, level.originX);
  }

  /** A procedural level for sandbox / seeds / post-campaign play. */
  procedural(seed: number, difficulty: number): LevelDef {
    const p = randomBlueprint(seed, difficulty);
    return {
      id: `proc-${seed}`,
      name: p.name,
      subtitle: `Seed ${seed.toString(36).toUpperCase()}`,
      lesson: '',
      hint: '',
      seed,
      originX: 42,
      blueprint: p.blueprint,
      objective: p.objective,
      par: p.par,
      reward: Math.round(150 + difficulty * 500),
    };
  }
}

export const levelManager = new LevelManager();
