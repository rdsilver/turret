/**
 * Base for every simulated object the view needs to draw: structure parts,
 * debris fragments and projectiles.
 *
 * Holds a cached transform written once per physics step (only while the body
 * is awake), plus the previous step's transform for render interpolation.
 * Views never talk to Rapier directly; they read these fields.
 */
import type { RapierNS } from './RapierModule';

export type EntityKind = 'part' | 'projectile';

let nextEntityId = 1;

export abstract class Entity {
  readonly id: number = nextEntityId++;
  abstract readonly kind: EntityKind;

  body!: RapierNS.RigidBody;
  collider!: RapierNS.Collider;
  /** Rapier rigid-body handle (stable while the body exists). */
  handle = -1;

  /** Current transform (sim space). */
  x = 0;
  y = 0;
  angle = 0;
  /** Transform at the previous physics step (for interpolation). */
  px = 0;
  py = 0;
  pangle = 0;
  /** Linear/angular velocity at the end of the last step. */
  vx = 0;
  vy = 0;
  av = 0;

  mass = 0;

  /** Physics step index when this entity was last seen awake. */
  activeStamp = -1;
  /** Physics step index of the last reported impact (rate limiting). */
  lastImpactStep = -1000;

  /** Removed from the world (view should destroy its sprite). */
  removed = false;
  /** Being faded out by the debris manager; seconds remaining. */
  fading = 0;
  fadeDuration = 0;

  /** Opaque slot for the view layer (sprite reference etc.). Sim never reads it. */
  view: unknown = null;

  /** Copy the body's live transform into the cache (prev = current). */
  syncFromBody(): void {
    const t = this.body.translation();
    this.x = this.px = t.x;
    this.y = this.py = t.y;
    this.angle = this.pangle = this.body.rotation();
    const v = this.body.linvel();
    this.vx = v.x;
    this.vy = v.y;
    this.av = this.body.angvel();
  }
}

export function resetEntityIds(): void {
  nextEntityId = 1;
}
