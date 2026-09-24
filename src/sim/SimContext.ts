/**
 * The narrow interface sub-systems (projectile behaviours, explosions,
 * fracture...) use to reach the rest of the simulation without importing the
 * Simulation facade (avoids import cycles, keeps behaviours testable).
 */
import type { EventBus } from '../core/EventBus';
import type { Random } from '../core/Random';
import type { PhysicsWorld } from './PhysicsWorld';
import type { SimEvents } from './SimEvents';
import type { ExplosionSystem } from './Explosions';
import type { ProjectileSystem } from './weapons/ProjectileSystem';
import type { FractureSystem } from './Fracture';
import type { StatusEffects } from './StatusEffects';

export interface SimContext {
  readonly physics: PhysicsWorld;
  readonly events: EventBus<SimEvents>;
  readonly explosions: ExplosionSystem;
  readonly projectiles: ProjectileSystem;
  readonly fracture: FractureSystem;
  readonly status: StatusEffects;
  /** Deterministic randomness for gameplay (spread, fracture patterns...). */
  readonly rng: Random;
}
