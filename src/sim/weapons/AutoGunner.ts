/**
 * Automatic gunner for a secondary gun (the top turret): picks the creature
 * closest to the line, aims at its first remaining weak point (those open from
 * above first; a roaming weak spot, Creature.weakSpot, before anything),
 * leading it by the flight time, and holds the trigger for as
 * long as it has a target. A weak point it has been firing at without landing
 * a round (something in front of it soaks them up) is skipped for a while.
 */
import type { SimContext } from '../SimContext';
import type { Weapon } from './Weapon';
import type { Creature } from '../creature/Creature';
import type { StructurePart } from '../StructurePart';
import { solveAim } from '../ballistics';

/** Seconds between target re-evaluations. */
const RETARGET = 0.35;
/** Firing this long (plus twice the flight time) at a part without damaging it: it is shielded from here. */
const BLOCKED_AFTER = 1.2;
/** How long a shielded part is skipped. */
const BLOCKED_FOR = 4;

export class AutoGunner {
  enabled = true;
  private retarget = 0;
  private creature: Creature | null = null;
  private part: StructurePart | null = null;
  private time = 0;
  /** Seconds of fire at `part` since it last took damage. */
  private dry = 0;
  /** Flight time to the target at the last aim (s). */
  private tof = 0;
  /** Parts found shielded, skipped until the given time. */
  private readonly blocked = new Map<StructurePart, number>();
  private readonly offs: Array<() => void>;

  constructor(
    private readonly ctx: SimContext,
    readonly weapon: Weapon,
  ) {
    this.offs = [
      ctx.physics.addPreStepHook((dt) => this.step(dt)),
      ctx.events.on('partDamaged', ({ part }) => {
        if (part === this.part) this.dry = 0;
      }),
    ];
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.weapon.triggerHeld = false;
  }

  private step(dt: number): void {
    const w = this.weapon;
    if (!this.enabled) {
      w.triggerHeld = false;
      return;
    }
    this.time += dt;
    this.retarget -= dt;
    const p0 = this.part;
    if (p0 && w.triggerHeld && (this.dry += dt) > BLOCKED_AFTER + 2 * this.tof) {
      this.blocked.set(p0, this.time + BLOCKED_FOR);
      this.retarget = 0;
    }
    if (this.retarget <= 0 || !this.creature?.active || !p0 || p0.removed || p0.wrecked) {
      this.pick();
      this.retarget = RETARGET;
      if (this.part !== p0) this.dry = 0;
    }
    const p = this.part;
    if (!p) {
      w.triggerHeld = false;
      return;
    }
    const m = w.muzzle();
    // Shins: aim low, under armour lips and shells that hang over the knees.
    const ty = p.name?.startsWith('shin') ? p.y + p.halfHeightNow * 0.6 : p.y;
    const tof = Math.hypot(p.x - m.x, ty - m.y) / Math.max(1, w.speed);
    this.tof = tof;
    // A beating wing's own velocity swings with every stroke: lead it by the flight.
    const v = p.hasTag('wing') && this.creature ? this.creature.core : p;
    const sol = solveAim(m.x, m.y, p.x + v.vx * tof, ty + v.vy * tof, w.speed, this.ctx.physics.gravity);
    if (!sol.length) {
      w.triggerHeld = false;
      return;
    }
    w.setAngle(sol[0]!);
    w.triggerHeld = true;
  }

  private pick(): void {
    let best: Creature | null = null;
    let bestX = Infinity;
    for (const c of this.ctx.creatures.list) {
      if (!c.active || c.core.removed || c.age < 0.5) continue;
      const x = c.frontX;
      if (x < bestX) {
        bestX = x;
        best = c;
      }
    }
    this.creature = best;
    this.part = null;
    if (!best) return;
    for (const [q, until] of this.blocked) if (until <= this.time || q.removed) this.blocked.delete(q);
    // Only one part can be hurt right now (a roaming weak spot): that one, shielded or not.
    const spot = best.weakSpot;
    if (spot && !spot.removed && !spot.wrecked && best.owns(spot)) {
      this.part = spot;
      return;
    }
    let part: StructurePart = best.core;
    for (const n of [...(best.spec.weakPointsFromAbove ?? []), ...(best.spec.weakPoints ?? [])]) {
      const q = best.structure.part(n);
      if (q && !q.removed && !q.wrecked && best.owns(q) && !this.blocked.has(q)) {
        part = q;
        break;
      }
    }
    this.part = part;
  }
}
