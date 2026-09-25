/**
 * The cannon's gameplay model: aim, power, reload, accuracy spread, recoil
 * and trajectory prediction. Visuals live in the view layer (TurretView).
 */
import { R, type RapierNS } from '../RapierModule';
import type { SimContext } from '../SimContext';
import type { Projectile } from './Projectile';
import type { AmmoDef } from './Ammo';
import { GROUP, interactionGroups, TURRET } from '../../config/constants';
import { clamp, DEG } from '../../core/math';

export interface WeaponStats {
  /** Muzzle speed at 100% power (m/s). */
  muzzleVelocity: number;
  /** Shell mass (kg). */
  projectileMass: number;
  /** Shell radius (m). */
  projectileRadius: number;
  /** Seconds between shots. */
  reloadTime: number;
  /** 1-sigma angular spread (radians). */
  spread: number;
  /** Recoil strength (0..1+) for camera/barrel kick. */
  recoil: number;
  /** Extra first-hit impulse multiplier (1 = pure physics). */
  impactMultiplier: number;
  /** Seconds of flight shown by the trajectory preview. */
  previewTime: number;
  /** Hold-to-fire (machine gun). */
  automatic?: boolean;
  /** Barrel heat added per shot (0..1 scale; 1 = overheated). */
  heatPerShot?: number;
  /** Heat shed per second. */
  coolRate?: number;
  /** Damage points per round (small arms; see Damage.ts). */
  damage?: number;
  /** Fraction (0..1) of a target's armour the rounds ignore. */
  armorPierce?: number;
}

export const BASE_WEAPON_STATS: Readonly<WeaponStats> = {
  muzzleVelocity: 34,
  projectileMass: 110,
  projectileRadius: 0.28,
  reloadTime: 1.6,
  spread: 1.6 * DEG,
  recoil: 1,
  impactMultiplier: 1,
  previewTime: 1.25,
};

/**
 * Starting machine gun: slow, weak, inaccurate. Hold to fire; the barrel heats
 * up and locks when overheated until it cools to 35%.
 */
export const BASE_MG_STATS: Readonly<WeaponStats> = {
  muzzleVelocity: 60,
  projectileMass: 0.7,
  projectileRadius: 0.07,
  reloadTime: 1 / 3.5,
  spread: 3 * DEG,
  recoil: 0.2,
  impactMultiplier: 1,
  previewTime: 0.45,
  automatic: true,
  heatPerShot: 0.08,
  coolRate: 0.24,
  damage: 0.6,
};

export interface TrajectoryPrediction {
  /** Flat [x0,y0,x1,y1,...] sim-space points (preallocated). */
  points: Float32Array;
  count: number;
  hit: boolean;
  hitX: number;
  hitY: number;
  /** Sim time along the path at the last point. */
  time: number;
}

export function createPrediction(maxPoints = 160): TrajectoryPrediction {
  return { points: new Float32Array(maxPoints * 2), count: 0, hit: false, hitX: 0, hitY: 0, time: 0 };
}

export class Weapon {
  stats: WeaponStats;
  ammo: AmmoDef;
  readonly pivotX = TURRET.x;
  readonly pivotY = -TURRET.pivotHeight;
  readonly barrelLength = TURRET.barrelLength;
  /** Sim-space angle: 0 = right, negative = up. */
  angle = -30 * DEG;
  /** 0.35..1 fraction of muzzle velocity. */
  power = 1;
  /** Seconds until the next shot is allowed. */
  reload = 0;
  shotsFired = 0;
  /** 0..1 barrel kick, decays over time (visual). */
  kick = 0;
  /** Infinite ammo, no reload (debug). */
  unlimited = false;
  /** 0..1 barrel heat (automatic weapons). */
  heat = 0;
  /** Locked out until heat drops below 0.35. */
  overheated = false;
  /** Trigger held (automatic weapons fire continuously while true). */
  triggerHeld = false;

  private ray: RapierNS.Ray | null = null;
  private readonly m = { x: 0, y: 0 };

  constructor(
    private readonly ctx: SimContext,
    stats: WeaponStats,
    ammo: AmmoDef,
  ) {
    this.stats = { ...stats };
    this.ammo = ammo;
    ctx.physics.addStepHook((dt) => this.update(dt));
  }

  get ready(): boolean {
    return (this.reload <= 0 || this.unlimited) && !this.overheated;
  }

  /** 0 = just fired, 1 = loaded. */
  get reloadProgress(): number {
    const t = this.stats.reloadTime;
    return t <= 0 ? 1 : clamp(1 - this.reload / t, 0, 1);
  }

  get speed(): number {
    return this.stats.muzzleVelocity * this.ammo.speedScale * this.power;
  }

  aimAt(wx: number, wy: number): void {
    const a = Math.atan2(wy - this.pivotY, wx - this.pivotX);
    this.angle = clamp(a, TURRET.minAngleDeg * DEG, TURRET.maxAngleDeg * DEG);
  }

  setAngle(a: number): void {
    this.angle = clamp(a, TURRET.minAngleDeg * DEG, TURRET.maxAngleDeg * DEG);
  }

  setPower(p: number): void {
    this.power = clamp(p, 0.35, 1);
  }

  muzzle(out = this.m): { x: number; y: number } {
    out.x = this.pivotX + Math.cos(this.angle) * this.barrelLength;
    out.y = this.pivotY + Math.sin(this.angle) * this.barrelLength;
    return out;
  }

  /** Fire if loaded. Returns the projectile or null. */
  fire(): Projectile | null {
    if (!this.ready) return null;
    const s = this.stats;
    const spreadAngle = this.angle + this.ctx.rng.gaussian() * s.spread;
    // Small muzzle-velocity variance also scales with inaccuracy.
    const speed = this.speed * (1 + this.ctx.rng.gaussian() * s.spread * 0.6);
    const m = this.muzzle();
    const vx = Math.cos(spreadAngle) * speed;
    const vy = Math.sin(spreadAngle) * speed;
    this.shotsFired++;
    const p = this.ctx.projectiles.spawn({
      ammo: this.ammo,
      x: m.x,
      y: m.y,
      vx,
      vy,
      radius: s.projectileRadius,
      mass: s.projectileMass,
      shot: this.shotsFired,
      impactMultiplier: s.impactMultiplier,
      damage: s.damage ?? 1,
      pierce: s.armorPierce ?? 0,
    });
    this.reload = this.unlimited ? 0 : s.reloadTime;
    if (s.heatPerShot && !this.unlimited) {
      this.heat = Math.min(1, this.heat + s.heatPerShot);
      if (this.heat >= 1) this.overheated = true;
    }
    this.kick = 1;
    this.ctx.events.emit('projectileFired', {
      projectile: p,
      x: m.x,
      y: m.y,
      vx,
      vy,
      recoil: s.recoil * (0.5 + 0.5 * (p.mass * speed) / (BASE_WEAPON_STATS.projectileMass * BASE_WEAPON_STATS.muzzleVelocity)),
    });
    return p;
  }

  update(dt: number): void {
    const s = this.stats;
    if (s.heatPerShot) {
      this.heat = Math.max(0, this.heat - (s.coolRate ?? 0.3) * dt);
      if (this.overheated && this.heat < 0.35) this.overheated = false;
    }
    // Automatic fire runs in sim time, so the fire rate is exact at any frame rate.
    if (this.triggerHeld && s.automatic && this.ready) this.fire();
    if (this.reload > 0) this.reload = Math.max(0, this.reload - dt);
    this.kick = Math.max(0, this.kick - dt * 2.5);
  }

  /**
   * Predict the ballistic path from the muzzle (no spread) and stop at the
   * first collider hit. Allocation-free after the first call.
   */
  predict(out: TrajectoryPrediction, maxTime = this.stats.previewTime, sampleDt = 1 / 30): TrajectoryPrediction {
    const RAP = R();
    const world = this.ctx.physics.world;
    const g = this.ctx.physics.gravity;
    const m = this.muzzle();
    const v = this.speed;
    const vx = Math.cos(this.angle) * v;
    const vy = Math.sin(this.angle) * v;
    const maxPts = out.points.length / 2;
    out.count = 0;
    out.hit = false;
    if (!this.ray) this.ray = new RAP.Ray({ x: 0, y: 0 }, { x: 1, y: 0 });
    const ray = this.ray;
    const groups = interactionGroups(0xffff, GROUP.GROUND | GROUP.STRUCTURE);
    let px = m.x;
    let py = m.y;
    out.points[0] = px;
    out.points[1] = py;
    out.count = 1;
    let t = 0;
    // Always trace far enough to find the impact point, but only `maxTime` is
    // exposed as the visible preview (the view fades beyond it).
    const traceTime = Math.max(maxTime, 6);
    while (t < traceTime && out.count < maxPts) {
      t += sampleDt;
      const nx = m.x + vx * t;
      const ny = m.y + vy * t + 0.5 * g * t * t;
      const dx = nx - px;
      const dy = ny - py;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1e-6) {
        ray.origin.x = px;
        ray.origin.y = py;
        ray.dir.x = dx / len;
        ray.dir.y = dy / len;
        const rad = this.stats.projectileRadius * this.ammo.radiusScale;
        const hit = world.castRay(ray, len + rad, true, undefined, groups);
        if (hit) {
          const toi = Math.max(0, hit.timeOfImpact - rad * 0.5);
          out.hitX = px + ray.dir.x * toi;
          out.hitY = py + ray.dir.y * toi;
          out.hit = true;
          out.points[out.count * 2] = out.hitX;
          out.points[out.count * 2 + 1] = out.hitY;
          out.count++;
          out.time = t;
          return out;
        }
      }
      out.points[out.count * 2] = nx;
      out.points[out.count * 2 + 1] = ny;
      out.count++;
      px = nx;
      py = ny;
      if (ny > 2) break;
    }
    out.time = t;
    return out;
  }
}
