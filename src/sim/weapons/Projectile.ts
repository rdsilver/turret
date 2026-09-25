import { Entity } from '../Entity';
import type { AmmoDef } from './Ammo';

export type ProjectileState = 'flying' | 'impacted' | 'spent';

export class Projectile extends Entity {
  readonly kind = 'projectile' as const;

  ammo!: AmmoDef;
  radius = 0.3;
  state: ProjectileState = 'flying';
  /** Sim time at spawn / first impact. */
  bornAt = 0;
  impactAt = -1;
  hits = 0;
  /** Which player shot produced this projectile (sub-munitions share it). */
  shot = 0;
  /** Velocity at the end of the previous step (pre-impact speed). */
  preVx = 0;
  preVy = 0;
  firstTarget: Entity | null = null;
  /** Scratch state for behaviours (timers, flags). Cleared on reuse. */
  readonly data: Record<string, number> = {};
  /** Extra impulse multiplier applied on the first hit (weapon stat). */
  impactMultiplier = 1;
  /** Damage points (small arms); read by the 'damage' behaviour. */
  damage = 1;

  get speed(): number {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  }

  resetState(): void {
    this.state = 'flying';
    this.impactAt = -1;
    this.hits = 0;
    this.firstTarget = null;
    this.removed = false;
    this.fading = 0;
    this.fadeDuration = 0;
    this.lastImpactStep = -1000;
    this.activeStamp = -1;
    for (const k of Object.keys(this.data)) delete this.data[k];
  }
}
