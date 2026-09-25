/**
 * Automatic gunner for a secondary gun (the top turret): picks the creature
 * closest to the line, aims at its first remaining weak point (leading it by
 * the flight time) and holds the trigger, easing off when the barrel runs hot.
 */
import type { SimContext } from '../SimContext';
import type { Weapon } from './Weapon';
import type { Creature } from '../creature/Creature';
import type { StructurePart } from '../StructurePart';
import { solveAim } from '../ballistics';

/** Seconds between target re-evaluations. */
const RETARGET = 0.35;

export class AutoGunner {
  enabled = true;
  private cooling = false;
  private retarget = 0;
  private creature: Creature | null = null;
  private part: StructurePart | null = null;
  private readonly off: () => void;

  constructor(
    private readonly ctx: SimContext,
    readonly weapon: Weapon,
  ) {
    this.off = ctx.physics.addPreStepHook((dt) => this.step(dt));
  }

  dispose(): void {
    this.off();
    this.weapon.triggerHeld = false;
  }

  private step(dt: number): void {
    const w = this.weapon;
    if (!this.enabled) {
      w.triggerHeld = false;
      return;
    }
    this.retarget -= dt;
    const p0 = this.part;
    if (this.retarget <= 0 || !this.creature?.active || !p0 || p0.removed || p0.wrecked) {
      this.pick();
      this.retarget = RETARGET;
    }
    const p = this.part;
    if (!p) {
      w.triggerHeld = false;
      return;
    }
    const m = w.muzzle();
    const tof = Math.hypot(p.x - m.x, p.y - m.y) / Math.max(1, w.speed);
    const sol = solveAim(m.x, m.y, p.x + p.vx * tof, p.y + p.vy * tof, w.speed, this.ctx.physics.gravity);
    if (!sol.length) {
      w.triggerHeld = false;
      return;
    }
    w.setAngle(sol[0]!);
    if (w.heat > 0.9) this.cooling = true;
    if (this.cooling && w.heat < 0.45) this.cooling = false;
    w.triggerHeld = !this.cooling && !w.overheated;
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
    let part: StructurePart = best.core;
    for (const n of best.spec.weakPoints ?? []) {
      const q = best.structure.part(n);
      if (q && !q.removed && !q.wrecked && best.owns(q)) {
        part = q;
        break;
      }
    }
    this.part = part;
  }
}
