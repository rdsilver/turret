/**
 * Spawns, pools, updates and retires projectiles; routes collision events to
 * ammo behaviours. Rounds are CCD-enabled (fast + small) and their bodies are
 * pooled (disabled, not destroyed) so sustained fire allocates nothing.
 */
import { R } from '../RapierModule';
import type { SimContext } from '../SimContext';
import type { Entity } from '../Entity';
import { Projectile } from './Projectile';
import { getBehavior, type AmmoDef, type HitInfo } from './Ammo';
import { GROUP, interactionGroups } from '../../config/constants';

export interface SpawnProjectileOptions {
  ammo: AmmoDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
  shot: number;
  impactMultiplier?: number;
}

/** Rounds that never hit anything expire after this long. */
const MAX_FLIGHT_TIME = 10;
const FADE_TIME = 0.8;
const POOL_LIMIT = 64;

export class ProjectileSystem {
  readonly live: Projectile[] = [];
  private pool: Projectile[] = [];
  private readonly hit: HitInfo = { target: null, hitGround: false, x: 0, y: 0, speed: 0, impulse: 0 };

  constructor(private readonly ctx: SimContext) {
    ctx.physics.addStepHook((dt) => this.step(dt));
    ctx.physics.addCollisionHandler((a, b, ha, hb, started) => {
      if (!started) return;
      if (a instanceof Projectile) this.onContact(a, b, hb);
      if (b instanceof Projectile) this.onContact(b, a, ha);
    });
  }

  get count(): number {
    return this.live.length;
  }

  spawn(o: SpawnProjectileOptions): Projectile {
    const RAP = R();
    const physics = this.ctx.physics;
    const radius = o.radius * o.ammo.radiusScale;
    const mass = o.mass * o.ammo.massScale;
    let p = this.pool.pop();
    if (p) {
      p.resetState();
      p.body.setTranslation({ x: o.x, y: o.y }, false);
      p.body.setRotation(0, false);
      p.body.setLinvel({ x: o.vx, y: o.vy }, false);
      p.body.setAngvel(0, false);
      p.collider.setRadius(radius);
      p.collider.setMass(mass);
      p.collider.setRestitution(o.ammo.restitution);
      p.collider.setFriction(o.ammo.friction);
      p.ammo = o.ammo;
      p.radius = radius;
      physics.revive(p);
    } else {
      p = new Projectile();
      p.ammo = o.ammo;
      p.radius = radius;
      const body = physics.world.createRigidBody(
        RAP.RigidBodyDesc.dynamic()
          .setTranslation(o.x, o.y)
          .setLinvel(o.vx, o.vy)
          .setCcdEnabled(true)
          .setAngularDamping(0.4)
          .setLinearDamping(0),
      );
      const collider = physics.world.createCollider(
        RAP.ColliderDesc.ball(radius)
          .setMass(mass)
          .setRestitution(o.ammo.restitution)
          .setFriction(o.ammo.friction)
          .setActiveEvents(RAP.ActiveEvents.COLLISION_EVENTS)
          .setCollisionGroups(interactionGroups(GROUP.PROJECTILE, 0xffff & ~GROUP.PROJECTILE)),
        body,
      );
      physics.register(p, body, collider);
    }
    p.bornAt = physics.simTime;
    p.shot = o.shot;
    p.impactMultiplier = o.impactMultiplier ?? 1;
    p.preVx = o.vx;
    p.preVy = o.vy;
    p.vx = o.vx;
    p.vy = o.vy;
    this.live.push(p);
    for (const spec of p.ammo.behaviors) getBehavior(spec.id)?.onSpawn?.(p, spec, this.ctx);
    return p;
  }

  /** Remove a projectile now (pooled). */
  despawn(p: Projectile): void {
    const i = this.live.indexOf(p);
    if (i >= 0) this.live.splice(i, 1);
    if (p.removed) return;
    p.state = 'spent';
    if (this.pool.length < POOL_LIMIT) {
      this.ctx.physics.retire(p);
      this.pool.push(p);
    } else {
      this.ctx.physics.removeEntity(p);
    }
  }

  /** Begin a fade; the projectile is despawned when it completes. */
  expire(p: Projectile, fade = FADE_TIME): void {
    if (p.state === 'spent' || p.fading > 0) return;
    for (const spec of p.ammo.behaviors) getBehavior(spec.id)?.onExpire?.(p, spec, this.ctx);
    this.ctx.events.emit('projectileExpired', { projectile: p });
    if (fade <= 0) {
      this.despawn(p);
      return;
    }
    p.fading = fade;
    p.fadeDuration = fade;
    this.ctx.events.emit('entityFading', { entity: p, duration: fade });
  }

  clear(): void {
    for (let i = this.live.length - 1; i >= 0; i--) this.despawn(this.live[i]!);
  }

  private onContact(p: Projectile, other: Entity | null, otherCollider: number): void {
    if (p.state === 'spent' || p.removed || p.fading > 0) return;
    const physics = this.ctx.physics;
    const hitGround = other === null && otherCollider === physics.groundCollider.handle;
    const speed = Math.sqrt(p.preVx * p.preVx + p.preVy * p.preVy);
    const dvx = p.vx - p.preVx;
    const dvy = p.vy - p.preVy;
    const impulse = p.mass * Math.sqrt(dvx * dvx + dvy * dvy);
    const first = p.state === 'flying';
    p.hits++;
    if (!first && speed < 4) return;
    const h = this.hit;
    h.target = other;
    h.hitGround = hitGround;
    h.x = p.x;
    h.y = p.y;
    h.speed = speed;
    h.impulse = impulse;
    if (first) {
      p.state = 'impacted';
      p.impactAt = physics.simTime;
      p.firstTarget = other;
      // Optional non-physical boost (weapon stat); 1 = pure physics.
      if (p.impactMultiplier > 1 && other && !other.removed && other.body.isDynamic()) {
        const k = (p.impactMultiplier - 1) * p.mass;
        other.body.applyImpulseAtPoint({ x: p.preVx * k * 0.5, y: p.preVy * k * 0.5 }, { x: p.x, y: p.y }, true);
      }
    }
    this.ctx.events.emit('projectileImpact', {
      projectile: p,
      target: other,
      hitGround,
      x: p.x,
      y: p.y,
      speed,
      impulse,
      first,
    });
    if (first) for (const spec of p.ammo.behaviors) getBehavior(spec.id)?.onImpact?.(p, spec, this.ctx, h);
  }

  private step(dt: number): void {
    const now = this.ctx.physics.simTime;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      if (p.removed) {
        // Removed by someone else (out of bounds, behaviour despawn).
        this.live.splice(i, 1);
        if (p.state !== 'spent') {
          p.state = 'spent';
        }
        continue;
      }
      if (p.fading > 0) {
        p.fading -= dt;
        if (p.fading <= 0) this.despawn(p);
        continue;
      }
      for (const spec of p.ammo.behaviors) getBehavior(spec.id)?.onStep?.(p, spec, this.ctx, dt);
      if (p.removed || p.state === 'spent') continue;
      if (p.state === 'impacted' && now - p.impactAt > p.ammo.lifetime) this.expire(p);
      else if (p.state === 'flying' && now - p.bornAt > MAX_FLIGHT_TIME) this.expire(p);
      p.preVx = p.vx;
      p.preVy = p.vy;
    }
  }
}
