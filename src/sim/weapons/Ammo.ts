/**
 * Ammunition = data (AmmoDef) + a list of composable behaviours.
 *
 * New ammo is added by writing an AmmoDef in src/data/ammo.ts and, if it
 * needs new logic, registering a ProjectileBehavior here. The projectile
 * system never needs to change.
 *
 * Behaviours can DESTROY (explode, cluster) or CHANGE THE PHYSICS (freeze
 * joints, reverse gravity, tether objects) — both use the same hooks.
 */
import type { Entity } from '../Entity';
import type { SimContext } from '../SimContext';
import type { Projectile } from './Projectile';

export type AmmoId = string;

export interface BehaviorSpec {
  id: string;
  [param: string]: number | string | boolean;
}

export interface AmmoDef {
  id: AmmoId;
  name: string;
  description: string;
  /** Multipliers applied on top of the weapon stats. */
  radiusScale: number;
  massScale: number;
  speedScale: number;
  restitution: number;
  friction: number;
  /** Visuals (view layer reads these). */
  color: number;
  trailColor: number;
  /** Money deducted per shot (economy). */
  cost: number;
  /** Seconds after the first impact before the spent round fades out. */
  lifetime: number;
  behaviors: BehaviorSpec[];
}

export interface HitInfo {
  target: Entity | null;
  hitGround: boolean;
  x: number;
  y: number;
  /** Speed just before the hit (m/s). */
  speed: number;
  /** Momentum change magnitude (N*s). */
  impulse: number;
}

export interface ProjectileBehavior {
  onSpawn?(p: Projectile, spec: BehaviorSpec, ctx: SimContext): void;
  /** Every physics step while alive. */
  onStep?(p: Projectile, spec: BehaviorSpec, ctx: SimContext, dt: number): void;
  /** First contact only (subsequent bounces do not re-trigger). */
  onImpact?(p: Projectile, spec: BehaviorSpec, ctx: SimContext, hit: HitInfo): void;
  onExpire?(p: Projectile, spec: BehaviorSpec, ctx: SimContext): void;
}

const registry = new Map<string, ProjectileBehavior>();

export function registerBehavior(id: string, behavior: ProjectileBehavior): void {
  registry.set(id, behavior);
}

export function getBehavior(id: string): ProjectileBehavior | undefined {
  return registry.get(id);
}

export function num(spec: BehaviorSpec, key: string, fallback: number): number {
  const v = spec[key];
  return typeof v === 'number' ? v : fallback;
}
