/**
 * Spawns, pools, updates and retires projectiles; routes collision events to
 * ammo behaviours. Rounds are CCD-enabled (fast + small) and their bodies are
 * pooled (disabled, not destroyed) so sustained fire allocates nothing.
 *
 * Chipped parts (sim/Chips.ts): once a part has lost triangles, rounds no
 * longer meet its collider (a contact filter vetoes the pair); instead each
 * step a flying round's path is swept against the part's intact triangles
 * (moving with the part), so it passes through what is gone and strikes what
 * is left, at its real surface: placed there, bounced off it like a contact,
 * the part pushed, and the same impact path run as for a collision. Anything
 * solid and unchipped in front of it is still Rapier's to meet first.
 */
import { R } from '../RapierModule';
import type { SimContext } from '../SimContext';
import type { Entity } from '../Entity';
import { Projectile } from './Projectile';
import { getBehavior, type AmmoDef, type HitInfo } from './Ammo';
import { GROUP, interactionGroups } from '../../config/constants';
import { StructurePart } from '../StructurePart';
import { sweepChips, type ChipHit } from '../Chips';

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
  /** Weapon damage points delivered by a 'damage' behaviour. */
  damage?: number;
  /** Fraction of armour ignored. */
  pierce?: number;
}

/** Rounds slower than this (m/s) aren't swept against chipped parts (resting on one, they would jitter). */
const MIN_SWEEP_SPEED = 3;
/** Rounds that never hit anything expire after this long. */
const MAX_FLIGHT_TIME = 10;
const FADE_TIME = 0.8;
const POOL_LIMIT = 64;

export class ProjectileSystem {
  readonly live: Projectile[] = [];
  private pool: Projectile[] = [];
  private readonly hit: HitInfo = { target: null, hitGround: false, x: 0, y: 0, speed: 0, impulse: 0 };
  /** Parts with triangles chipped out: rounds meet their intact triangles, not their colliders. */
  private readonly chipped = new Set<StructurePart>();
  private readonly chipHit: ChipHit = { t: 0, nx: 0, ny: 0 };
  private ball: InstanceType<ReturnType<typeof R>['Ball']> | null = null;

  constructor(private readonly ctx: SimContext) {
    ctx.physics.addPreStepHook((dt) => this.sweepChipped(dt));
    ctx.physics.addStepHook((dt) => this.step(dt));
    ctx.physics.addCollisionHandler((a, b, ha, hb, started) => {
      if (!started) return;
      if (a instanceof Projectile) this.onContact(a, b, hb);
      if (b instanceof Projectile) this.onContact(b, a, ha);
    });
    // Only rounds the sweep took care of this step pass chipped parts' colliders (a slow round it
    // skips still lands on the collider rather than falling through the part).
    ctx.physics.addContactFilter((a, b) => {
      const step = this.ctx.physics.stepIndex;
      return !((a instanceof Projectile && a.sweptStep === step && isChipped(b)) || (b instanceof Projectile && b.sweptStep === step && isChipped(a)));
    });
    ctx.events.on('partChipped', ({ part }) => this.chipped.add(part));
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
          // (Asked about every contact: chipped parts let rounds through.)
          .setActiveHooks(RAP.ActiveHooks.FILTER_CONTACT_PAIRS)
          .setCollisionGroups(interactionGroups(GROUP.PROJECTILE, 0xffff & ~GROUP.PROJECTILE)),
        body,
      );
      physics.register(p, body, collider);
    }
    p.bornAt = physics.simTime;
    p.shot = o.shot;
    p.impactMultiplier = o.impactMultiplier ?? 1;
    p.damage = o.damage ?? 1;
    p.pierce = o.pierce ?? 0;
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
    this.chipped.clear();
  }

  private onContact(p: Projectile, other: Entity | null, otherCollider: number): void {
    if (p.state === 'spent' || p.removed || p.fading > 0) return;
    const physics = this.ctx.physics;
    const hitGround = other === null && otherCollider === physics.groundCollider.handle;
    const speed = Math.sqrt(p.preVx * p.preVx + p.preVy * p.preVy);
    const dvx = p.vx - p.preVx;
    const dvy = p.vy - p.preVy;
    this.impact(p, other, hitGround, p.x, p.y, speed, p.mass * Math.sqrt(dvx * dvx + dvy * dvy));
  }

  /** A round met something at (x, y) (a collision, or a chipped part's intact triangle): events and behaviours. */
  private impact(p: Projectile, other: Entity | null, hitGround: boolean, x: number, y: number, speed: number, impulse: number): void {
    const physics = this.ctx.physics;
    const first = p.state === 'flying';
    p.hits++;
    if (!first && speed < 4) return;
    const h = this.hit;
    h.target = other;
    h.hitGround = hitGround;
    h.x = x;
    h.y = y;
    h.speed = speed;
    h.impulse = impulse;
    if (first) {
      p.state = 'impacted';
      p.impactAt = physics.simTime;
      p.firstTarget = other;
      // Optional non-physical boost (weapon stat); 1 = pure physics.
      if (p.impactMultiplier > 1 && other && !other.removed && other.body.isDynamic()) {
        const k = (p.impactMultiplier - 1) * p.mass;
        other.body.applyImpulseAtPoint({ x: p.preVx * k * 0.5, y: p.preVy * k * 0.5 }, { x, y }, true);
      }
    }
    this.ctx.events.emit('projectileImpact', {
      projectile: p,
      target: other,
      hitGround,
      x,
      y,
      speed,
      impulse,
      first,
    });
    if (first) for (const spec of p.ammo.behaviors) getBehavior(spec.id)?.onImpact?.(p, spec, this.ctx, h);
  }

  /**
   * Before the physics step: sweep each flying round's path over the step
   * against the intact triangles of the chipped parts near it (in the part's
   * frame, moving with it), and strike the first one it meets.
   */
  private sweepChipped(dt: number): void {
    if (this.chipped.size === 0) return;
    for (const part of this.chipped) if (part.removed || !part.chips) this.chipped.delete(part);
    const stepIndex = this.ctx.physics.stepIndex;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i]!;
      // (Rounds that have hit something too, down to a crawl: they bounce off what is left as they
      // would off a collider. Slower ones meet the colliders: resting on a part, they would jitter.)
      if (p.state === 'spent' || p.removed || p.fading > 0 || p.vx * p.vx + p.vy * p.vy < MIN_SWEEP_SPEED * MIN_SWEEP_SPEED) continue;
      p.sweptStep = stepIndex;
      let best: StructurePart | null = null;
      let bestT = Infinity;
      let nx = 0;
      let ny = 0;
      for (const part of this.chipped) {
        // (A strike earlier in this loop can shatter or blow a part away: never touch a removed one.)
        if (part.removed || !part.chips) continue;
        // The round's path relative to the part this step.
        const dx = (p.vx - part.vx) * dt;
        const dy = (p.vy - part.vy) * dt;
        const reach = part.extent * 1.5 + p.radius;
        if (segmentDist2(part.x - p.x, part.y - p.y, dx, dy) > reach * reach) continue;
        // Rounds pass wrecks made passable (their collision filter says so).
        if ((part.collider.collisionGroups() & GROUP.PROJECTILE) === 0) continue;
        const c = Math.cos(part.angle);
        const s = Math.sin(part.angle);
        const ax = p.x - part.x;
        const ay = p.y - part.y;
        const lax = c * ax + s * ay;
        const lay = -s * ax + c * ay;
        const hit = sweepChips(part.chips, part.shape, lax, lay, lax + c * dx + s * dy, lay - s * dx + c * dy, p.radius, this.chipHit);
        if (!hit || hit.t >= bestT) continue;
        // Already inside what is left (it moved onto the round): a round that has hit something
        // before just goes on (bouncing it here every step would pin it in place).
        if (hit.t === 0 && hit.nx === 0 && hit.ny === 0 && p.state !== 'flying') continue;
        best = part;
        bestT = hit.t;
        nx = c * hit.nx - s * hit.ny;
        ny = s * hit.nx + c * hit.ny;
      }
      if (best && !this.blocked(p, bestT * dt)) this.strike(p, best, bestT * dt, nx, ny);
    }
  }

  /**
   * Something solid and unchipped that the round (its ball, as Rapier sees
   * it) would meet within `time` s: Rapier's to handle, first.
   */
  private blocked(p: Projectile, time: number): boolean {
    if (p.vx === 0 && p.vy === 0) return false;
    const RAP = R();
    if (!this.ball || this.ball.radius !== p.radius) this.ball = new RAP.Ball(p.radius);
    const owner = this.ctx.physics.colliderOwner;
    const hit = this.ctx.physics.world.castShape({ x: p.x, y: p.y }, 0, { x: p.vx, y: p.vy }, this.ball, 0, time, true, undefined, p.collider.collisionGroups(), p.collider, p.body, (col) => !isChipped(owner.get(col.handle) ?? null));
    return hit !== null;
  }

  /**
   * First chipped part (among those whose collision groups `groups` would
   * meet) that a disc of `radius` moving from (x, y) by (dx, dy) touches, as
   * rounds see it (static poses): `{ t, part }` or null. The aim preview.
   */
  firstChipHit(x: number, y: number, dx: number, dy: number, radius: number, groups: number): { t: number; part: StructurePart } | null {
    let best: StructurePart | null = null;
    let bestT = Infinity;
    for (const part of this.chipped) {
      if (part.removed || !part.chips) continue;
      const reach = part.extent * 1.5 + radius;
      if (segmentDist2(part.x - x, part.y - y, dx, dy) > reach * reach) continue;
      // The two sides' groups must allow the pair (membership against filter, both ways).
      const g = part.collider.collisionGroups();
      if (((g >>> 16) & groups & 0xffff) === 0 || ((groups >>> 16) & g & 0xffff) === 0) continue;
      const c = Math.cos(part.angle);
      const s = Math.sin(part.angle);
      const ax = x - part.x;
      const ay = y - part.y;
      const lax = c * ax + s * ay;
      const lay = -s * ax + c * ay;
      const hit = sweepChips(part.chips, part.shape, lax, lay, lax + c * dx + s * dy, lay - s * dx + c * dy, radius, this.chipHit);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        best = part;
      }
    }
    return best ? { t: bestT, part: best } : null;
  }

  /**
   * The round's ball touches an intact triangle of `part` after `time` s,
   * across a side with outward normal (nx, ny) (0, 0: it starts touching):
   * put it there, bounce it off like a contact would (restitution and
   * friction averaged as Rapier combines them; relative to the part's
   * surface there, spin included), push the part, and run the impact at the
   * point of contact.
   */
  private strike(p: Projectile, part: StructurePart, time: number, nx: number, ny: number): void {
    const vx = p.vx;
    const vy = p.vy;
    const speed = Math.hypot(vx, vy);
    // The ball's centre when it touches, and the point it touches (a radius in along the normal).
    const bx = p.x + vx * time;
    const by = p.y + vy * time;
    if (nx === 0 && ny === 0) {
      nx = -vx / speed;
      ny = -vy / speed;
    }
    const hx = bx - nx * p.radius;
    const hy = by - ny * p.radius;
    // The part's surface velocity at the hit point (v + w x r).
    const svx = part.vx - part.av * (hy - part.y);
    const svy = part.vy + part.av * (hx - part.x);
    const rvx = vx - svx;
    const rvy = vy - svy;
    const vn = rvx * nx + rvy * ny;
    let ovx = vx;
    let ovy = vy;
    if (vn < 0) {
      const e = (p.ammo.restitution + (part.def.restitution ?? part.material.restitution)) / 2;
      const mu = (p.ammo.friction + (part.def.friction ?? part.material.friction)) / 2;
      // Coulomb friction on the tangential part, capped at stopping it.
      const tx = rvx - vn * nx;
      const ty = rvy - vn * ny;
      const tl = Math.hypot(tx, ty);
      const keep = tl > 0 ? Math.max(0, 1 - (mu * (1 + e) * -vn) / tl) : 0;
      ovx = svx + tx * keep - e * vn * nx;
      ovy = svy + ty * keep - e * vn * ny;
    }
    const jx = p.mass * (vx - ovx);
    const jy = p.mass * (vy - ovy);
    part.body.applyImpulseAtPoint({ x: jx, y: jy }, { x: hx, y: hy }, true);
    p.body.setTranslation({ x: bx, y: by }, true);
    p.body.setLinvel({ x: ovx, y: ovy }, true);
    p.x = bx;
    p.y = by;
    p.vx = ovx;
    p.vy = ovy;
    this.impact(p, part, false, hx, hy, speed, Math.hypot(jx, jy));
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

/** A part with triangles chipped out of it. */
function isChipped(e: Entity | null): boolean {
  return e instanceof StructurePart && e.chips !== null && e.chips.chipped > 0;
}

/** Squared distance from point (px, py) to the segment from the origin to (dx, dy). */
function segmentDist2(px: number, py: number, dx: number, dy: number): number {
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l2)) : 0;
  const ex = px - dx * t;
  const ey = py - dy * t;
  return ex * ex + ey * ey;
}
