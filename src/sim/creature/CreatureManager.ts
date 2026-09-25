/**
 * Spawns creatures from blueprints and runs their controllers and abilities
 * every physics step (before the solver, so forces act this step).
 *
 * Creatures whose spec allows splitting can come apart: when a cut leaves a
 * big enough piece with legs that no creature controls, that piece becomes a
 * creature of its own (sharing the original structure).
 */
import type { SimContext } from '../SimContext';
import type { Structure } from '../Structure';
import { Random } from '../../core/Random';
import { StructureDraft } from '../generator/StructureDraft';
import { buildStructure } from '../StructureBuilder';
import { Creature } from './Creature';
import { getCreatureBlueprint, type CreatureParams, type CreatureSpec } from './CreatureTypes';
import { getAbility } from './abilities';
import { StructurePart } from '../StructurePart';
import { GROUP, interactionGroups } from '../../config/constants';

export class CreatureManager {
  readonly list: Creature[] = [];
  private byStructure = new Map<Structure, Creature[]>();
  /** Structures that lost a joint and may have split (checked before the next step). */
  private splitCheck = new Set<Structure>();

  constructor(private readonly ctx: SimContext) {
    ctx.physics.addPreStepHook((dt) => this.preStep(dt));
    ctx.events.on('jointBroken', ({ joint }) => {
      const cs = this.byStructure.get(joint.a.structure as Structure);
      if (!cs) return;
      for (const c of cs) c.onJointBroken();
      if (cs[0]!.spec.split) this.splitCheck.add(joint.a.structure as Structure);
    });
    const dirty = ({ part }: { part: StructurePart }) => {
      const cs = this.byStructure.get(part.structure as Structure);
      if (!cs) return;
      for (const c of cs) c.markDirty();
      if (cs[0]!.spec.split) this.splitCheck.add(part.structure as Structure);
    };
    ctx.events.on('partWrecked', dirty);
    ctx.events.on('partShattered', dirty);
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
    return this.adopt(structure, spec, blueprintId);
  }

  private adopt(structure: Structure, spec: CreatureSpec, kind: string, parent?: Creature): Creature {
    const creature = new Creature(this.ctx, structure, spec);
    creature.kind = kind;
    this.list.push(creature);
    let cs = this.byStructure.get(structure);
    if (!cs) this.byStructure.set(structure, (cs = []));
    cs.push(creature);
    for (const a of spec.abilities ?? []) getAbility(a.id)?.init?.(creature, a, this.ctx);
    if (parent) this.ctx.events.emit('creatureSplit', { creature, parent });
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

  /** The creature a part belongs to (the one it is still attached to, if several share its structure). */
  creatureOf(part: StructurePart): Creature | undefined {
    const cs = this.byStructure.get(part.structure as Structure);
    if (!cs) return undefined;
    if (cs.length === 1) return cs[0];
    for (const c of cs) if (c.owns(part)) return c;
    return cs[0];
  }

  /** Remove every creature (and its parts) from the world. */
  clear(): void {
    for (const cs of this.byStructure.values()) {
      for (const p of cs[0]!.structure.parts) if (!p.removed) this.ctx.physics.removeEntity(p);
    }
    this.list.length = 0;
    this.byStructure.clear();
    this.splitCheck.clear();
  }

  private preStep(dt: number): void {
    if (this.splitCheck.size) this.checkSplits();
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

  /** Turn big uncontrolled pieces of split-capable creatures into creatures of their own. */
  private checkSplits(): void {
    for (const structure of this.splitCheck) {
      const cs = this.byStructure.get(structure);
      const base = cs?.[0];
      const rule = base?.spec.split;
      if (!cs || !base || !rule) continue;
      const seen = new Set<StructurePart>();
      for (const start of structure.parts) {
        if (start.removed || start.wrecked || seen.has(start) || !start.hasTag(rule.tag)) continue;
        // Flood-fill this piece.
        const piece: StructurePart[] = [];
        const stack = [start];
        seen.add(start);
        while (stack.length) {
          const p = stack.pop()!;
          piece.push(p);
          for (const j of p.joints) {
            if (j.broken) continue;
            const o = j.other(p);
            if (o && !o.removed && !seen.has(o)) {
              seen.add(o);
              stack.push(o);
            }
          }
        }
        if (cs.some((c) => c.active && piece.includes(c.core))) continue;
        const segments = piece.filter((p) => p.hasTag(rule.tag) && !p.wrecked);
        if (segments.length < rule.min) continue;
        // It needs working legs of its own.
        const inPiece = new Set(piece);
        const legs = base.spec.legs.filter((l) => {
          const foot = structure.part(l.foot);
          return !!foot && inPiece.has(foot) && l.parts.every((n) => {
            const p = structure.part(n);
            return !!p && !p.wrecked && inPiece.has(p);
          });
        });
        if (legs.length < 2) continue;
        // Led by its front-most segment (creatures walk toward -x).
        let lead = segments[0]!;
        for (const s of segments) if (s.x < lead.x) lead = s;
        if (!lead.name) continue;
        const spec: CreatureSpec = {
          ...base.spec,
          name: `${base.spec.name.replace(/ \(half\)$/, '')} (half)`,
          core: lead.name,
          vitals: [lead.name],
          bounty: Math.round((base.spec.bounty ?? 50) * 0.25),
        };
        this.adopt(structure, spec, base.kind, base);
      }
    }
    this.splitCheck.clear();
  }
}
