/**
 * Timed physics modifiers ("weapons that change the physics"): brittle
 * joints, altered gravity on bodies, etc. Each effect restores itself when it
 * expires. Evaluated once per step; cost is O(active effects).
 */
import type { SimContext } from './SimContext';
import type { BreakableJoint } from './BreakableJoint';
import type { Entity } from './Entity';

interface JointEffect {
  kind: 'jointStrength';
  joint: BreakableJoint;
  until: number;
}

interface GravityEffect {
  kind: 'gravityScale';
  entity: Entity;
  until: number;
  previous: number;
}

type Effect = JointEffect | GravityEffect;

export class StatusEffects {
  private effects: Effect[] = [];

  constructor(private readonly ctx: SimContext) {
    ctx.physics.addStepHook(() => this.step());
  }

  get count(): number {
    return this.effects.length;
  }

  /** Temporarily scale a joint's strength (and ductility). */
  weakenJoint(joint: BreakableJoint, scale: number, seconds: number, ductilityScale = scale): void {
    if (joint.broken) return;
    const until = this.ctx.physics.simTime + seconds;
    const existing = this.effects.find((e) => e.kind === 'jointStrength' && e.joint === joint) as JointEffect | undefined;
    joint.setStrengthScale(this.ctx.physics.world, Math.min(scale, joint.strengthScale), ductilityScale);
    if (existing) existing.until = Math.max(existing.until, until);
    else this.effects.push({ kind: 'jointStrength', joint, until });
  }

  /** Temporarily change gravity for one body (e.g. reverse-gravity rounds). */
  setGravityScale(entity: Entity, scale: number, seconds: number): void {
    if (entity.removed) return;
    const previous = entity.body.gravityScale();
    entity.body.setGravityScale(scale, true);
    this.effects.push({ kind: 'gravityScale', entity, until: this.ctx.physics.simTime + seconds, previous });
  }

  clear(): void {
    this.effects.length = 0;
  }

  private step(): void {
    if (this.effects.length === 0) return;
    const now = this.ctx.physics.simTime;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      if (e.until > now) continue;
      this.effects.splice(i, 1);
      if (e.kind === 'jointStrength') {
        if (!e.joint.broken) e.joint.setStrengthScale(this.ctx.physics.world, 1, 1);
      } else if (!e.entity.removed) {
        e.entity.body.setGravityScale(e.previous, true);
      }
    }
  }
}
