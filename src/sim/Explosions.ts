/**
 * Explosions: radial impulses, joint damage and chain detonation of
 * explosive materials. Used by explosive parts, explosive ammo and debug.
 */
import { R, type RapierNS } from './RapierModule';
import type { SimContext } from './SimContext';
import { StructurePart } from './StructurePart';
import type { Entity } from './Entity';
import type { ExplosionEvent } from './SimEvents';

/** Impulse (N*s) per sqrt(m^2) of exposed area at the blast center, at power 1. */
const BLAST_IMPULSE = 5200;
/** Cap on velocity change imparted to any single body (m/s). */
const MAX_BLAST_DV = 24;

interface PendingBlast {
  x: number;
  y: number;
  radius: number;
  power: number;
  at: number;
  source: ExplosionEvent['source'];
  /** Explosive part consumed by this blast (follows the part if it moved). */
  part: StructurePart | null;
}

export class ExplosionSystem {
  private pending: PendingBlast[] = [];
  private shape: RapierNS.Ball | null = null;
  private readonly hits: Entity[] = [];
  private readonly rot = 0;

  constructor(private readonly ctx: SimContext) {
    ctx.physics.addStepHook(() => this.step());
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Schedule an explosion `delay` seconds from now (sim time). */
  schedule(x: number, y: number, radius: number, power: number, delay: number, source: ExplosionEvent['source']): void {
    this.pending.push({ x, y, radius, power, at: this.ctx.physics.simTime + delay, source, part: null });
  }

  /** Arm an explosive part: it disappears in the blast after its fuse. */
  detonate(part: StructurePart, extraDelay = 0): void {
    const ex = part.material.explosive;
    if (!ex || part.armed || part.removed) return;
    part.armed = true;
    this.pending.push({
      x: part.x,
      y: part.y,
      radius: ex.radius,
      power: ex.power,
      at: this.ctx.physics.simTime + ex.fuse + extraDelay,
      source: 'material',
      part,
    });
  }

  clear(): void {
    this.pending.length = 0;
  }

  private step(): void {
    const physics = this.ctx.physics;
    // Hard hits on explosive parts arm them.
    const n = physics.hardImpactsThisStep;
    for (let i = 0; i < n; i++) {
      const h = physics.hardImpacts[i]!;
      const e = h.entity;
      if (e instanceof StructurePart && e.material.explosive && !e.armed && h.dv > e.material.explosive.triggerDv) this.detonate(e);
    }
    if (this.pending.length === 0) return;
    const now = physics.simTime;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const b = this.pending[i]!;
      if (b.at > now) continue;
      this.pending.splice(i, 1);
      const p = b.part;
      if (p && !p.removed) {
        b.x = p.x;
        b.y = p.y;
        for (let k = p.joints.length - 1; k >= 0; k--) physics.breakJoint(p.joints[k]!, 'explosion');
        if (p.structure && !p.isFragment) p.structure.onPartDestroyed(p);
        p.destroyed = true;
        physics.removeEntity(p);
      }
      this.explode(b.x, b.y, b.radius, b.power, b.source);
    }
  }

  /** Immediate explosion. */
  explode(x: number, y: number, radius: number, power: number, source: ExplosionEvent['source']): void {
    const RAP = R();
    const physics = this.ctx.physics;
    if (!this.shape) this.shape = new RAP.Ball(radius);
    this.shape.radius = radius;
    this.hits.length = 0;
    physics.world.intersectionsWithShape({ x, y }, this.rot, this.shape, (c) => {
      const e = physics.colliderOwner.get(c.handle);
      if (e && !e.removed) this.hits.push(e);
      return true;
    });

    const jointBreakRadius = radius * 0.55;
    for (const e of this.hits) {
      if (e.removed) continue;
      // Distance from the blast to the nearest point of the body (long beams
      // overlapping the blast must be affected even if their centre is far).
      const pr = e.collider.projectPoint({ x, y }, true);
      const px = pr ? pr.point.x : e.x;
      const py = pr ? pr.point.y : e.y;
      let dx = px - x;
      let dy = py - y;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-4) {
        dx = e.x - x;
        dy = e.y - y;
        d = Math.sqrt(dx * dx + dy * dy);
      }
      const isPart = e instanceof StructurePart;
      if (isPart && !e.fixed && !(e.material.explosive && !e.armed)) {
        // Break nearby joints outright; farther joints only if weak relative to the blast.
        for (let k = e.joints.length - 1; k >= 0; k--) {
          const j = e.joints[k]!;
          const jd = Math.hypot(j.wx - x, j.wy - y);
          if (jd >= radius) continue;
          const blastForce = power * 900_000 * (1 - jd / radius);
          if (jd < jointBreakRadius * power || blastForce > j.yieldForce * 1.5) physics.breakJoint(j, 'explosion');
        }
      }
      const falloff = Math.max(0, 1 - d / radius);
      if (falloff <= 0) continue;
      if (isPart && e.material.explosive && !e.armed) {
        this.detonate(e, 0.05 + (1 - falloff) * 0.15);
        continue;
      }
      if (!e.body.isDynamic()) continue;
      const area = isPart ? e.area : 0.3;
      let J = power * BLAST_IMPULSE * Math.pow(falloff, 1.3) * Math.sqrt(Math.max(0.05, area));
      J = Math.min(J, e.mass * MAX_BLAST_DV);
      const inv = d > 1e-4 ? 1 / d : 0;
      const nx = d > 1e-4 ? dx * inv : 0;
      const ny = d > 1e-4 ? dy * inv : -1;
      // Upward bias makes blasts read better (debris lifts instead of skidding).
      const ix = nx * J;
      const iy = (ny - 0.35) * J;
      e.body.applyImpulse({ x: ix, y: iy }, true);
      e.body.applyTorqueImpulse((this.ctx.rng.next() - 0.5) * J * 0.3 * (isPart ? e.extent : 0.3), true);
    }
    this.ctx.events.emit('explosion', { x, y, radius, power, source });
  }
}
