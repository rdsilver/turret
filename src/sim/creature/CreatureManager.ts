/**
 * Spawns creatures from blueprints and runs their controllers and abilities
 * every physics step (before the solver, so forces act this step).
 */
import type { SimContext } from '../SimContext';
import { Random } from '../../core/Random';
import { StructureDraft } from '../generator/StructureDraft';
import { buildStructure } from '../StructureBuilder';
import { Creature } from './Creature';
import { getCreatureBlueprint, type CreatureParams } from './CreatureTypes';
import { getAbility } from './abilities';
import { StructurePart } from '../StructurePart';
import { GROUP, interactionGroups } from '../../config/constants';

export class CreatureManager {
  readonly list: Creature[] = [];
  private byStructure = new Map<unknown, Creature>();

  constructor(private readonly ctx: SimContext) {
    ctx.physics.addPreStepHook((dt) => this.preStep(dt));
    ctx.events.on('jointBroken', ({ joint }) => {
      const c = this.byStructure.get(joint.a.structure);
      if (c) c.onJointBroken();
    });
    ctx.events.on('partWrecked', ({ part }) => this.byStructure.get(part.structure)?.markDirty());
    ctx.events.on('partShattered', ({ part }) => this.byStructure.get(part.structure)?.markDirty());
  }

  /** Spawn a creature standing on the ground with its body centered at sim x. */
  spawn(blueprintId: string, x: number, params: CreatureParams = {}, seed = 1): Creature {
    const rng = new Random(seed);
    const draft = new StructureDraft(rng);
    const spec = getCreatureBlueprint(blueprintId)(draft, rng, params);
    const def = draft.toDef(x, spec.name);
    const structure = buildStructure(this.ctx.physics, def);
    // Limbs overlap in a 2D side view: creature parts never collide with each other.
    const groups = interactionGroups(GROUP.CREATURE, 0xffff & ~GROUP.CREATURE);
    for (const p of structure.parts) p.collider.setCollisionGroups(groups);
    const creature = new Creature(this.ctx, structure, spec);
    this.list.push(creature);
    this.byStructure.set(structure, creature);
    for (const a of spec.abilities ?? []) getAbility(a.id)?.init?.(creature, a, this.ctx);
    this.ctx.events.emit('creatureSpawned', { creature });
    return creature;
  }

  get activeCount(): number {
    let n = 0;
    for (const c of this.list) if (c.active) n++;
    return n;
  }

  /** Smallest body x among active creatures (closest to the turret), or Infinity. */
  frontX(): number {
    let x = Infinity;
    for (const c of this.list) if (c.active && !c.core.removed) x = Math.min(x, c.core.x);
    return x;
  }

  creatureOf(part: StructurePart): Creature | undefined {
    return this.byStructure.get(part.structure);
  }

  /** Remove every creature (and its parts) from the world. */
  clear(): void {
    for (const c of this.list) {
      for (const p of c.structure.parts) if (!p.removed) this.ctx.physics.removeEntity(p);
    }
    this.list.length = 0;
    this.byStructure.clear();
  }

  private preStep(dt: number): void {
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i]!;
      c.preStep(dt);
      const abilities = c.spec.abilities;
      if (!abilities || !c.active) continue;
      for (const a of abilities) {
        const organ = c.structure.part(a.part);
        if (!organ || !c.organAttached(organ)) continue;
        getAbility(a.id)?.step?.(c, a, this.ctx, dt, organ);
      }
    }
  }
}
