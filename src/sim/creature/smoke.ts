/**
 * Smoke (ability 'smoke'): a creature that trails a bank of thick smoke.
 * Every `interval` seconds its organ (a smokestack) puffs out a cloud a
 * little behind itself. Each cloud swells to `radius` metres, sinks toward
 * a height a walker's body stands at, drifts gently away from the turret and
 * thins out over `life` seconds; left behind as the creature walks on, the
 * clouds make a wall of smoke that hides whatever walks behind it.
 *
 * Smoke stops no rounds: it only blocks sight. Gunners (the top turret) don't
 * aim at what they can't see (smokeBetween: a dense cloud across the line
 * from the gun); the view draws the clouds over the creatures (SmokeView).
 * Shoot the stack off (or stop the creature) and the puffing stops; the
 * clouds already out linger until they thin away.
 *
 * Params: interval, radius, life, height (m the clouds settle at), behind
 * (m behind the stack a cloud starts).
 */
import { registerAbility } from './abilities';
import type { Creature } from './Creature';
import type { AbilitySpec } from './CreatureTypes';
import type { SimContext } from '../SimContext';

export interface SmokeCloud {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  age: number;
  /** Radius it swells to (m), height (m above the ground) it sinks toward, seconds it lasts. */
  rMax: number;
  settle: number;
  life: number;
  /** Fixed per cloud, for the view (rotation of its art). */
  spin: number;
}

/** Seconds a new cloud takes to thicken; share of its life spent thinning out at the end. */
const THICKEN = 0.8;
const THIN = 0.35;
/** A cloud hides what is behind it where it is at least this dense, within this share of its radius. */
const HIDING_DENSITY = 0.45;
const HIDING_CORE = 0.75;

const fields = new WeakMap<SimContext, SmokeCloud[]>();

function field(ctx: SimContext): SmokeCloud[] {
  let clouds = fields.get(ctx);
  if (!clouds) {
    const list: SmokeCloud[] = [];
    clouds = list;
    fields.set(ctx, list);
    ctx.physics.addStepHook((dt) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i]!;
        c.age += dt;
        if (c.age >= c.life) {
          list.splice(i, 1);
          continue;
        }
        // Swell, sink (or rise) toward its height, drift.
        c.r += (c.rMax - c.r) * Math.min(1, dt * 1.6);
        const vyTarget = (-c.settle - c.y) * 0.8;
        c.vy += (vyTarget - c.vy) * Math.min(1, dt * 2);
        c.vx *= Math.max(0, 1 - dt * 0.25);
        c.x += c.vx * dt;
        c.y += c.vy * dt;
      }
    });
  }
  return clouds;
}

/** The smoke clouds in the air (read-only: for the view and for gunners). */
export function smokeClouds(ctx: SimContext): readonly SmokeCloud[] {
  return fields.get(ctx) ?? [];
}

/** How thick a cloud is right now (0..1): it thickens as it comes out and thins away at the end. */
export function smokeDensity(c: SmokeCloud): number {
  const fadeIn = Math.min(1, c.age / THICKEN);
  const fadeOut = Math.min(1, (c.life - c.age) / (c.life * THIN));
  return Math.max(0, Math.min(fadeIn, fadeOut));
}

/** Does thick smoke block the view from (x0, y0) to (x1, y1)? */
export function smokeBetween(ctx: SimContext, x0: number, y0: number, x1: number, y1: number): boolean {
  const clouds = fields.get(ctx);
  if (!clouds?.length) return false;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (const c of clouds) {
    if (smokeDensity(c) < HIDING_DENSITY) continue;
    const t = Math.max(0, Math.min(1, ((c.x - x0) * dx + (c.y - y0) * dy) / len2));
    const ex = x0 + dx * t - c.x;
    const ey = y0 + dy * t - c.y;
    const rr = c.r * HIDING_CORE;
    if (ex * ex + ey * ey < rr * rr) return true;
  }
  return false;
}

/** Clear the air (the level is being reset). */
export function clearSmoke(ctx: SimContext): void {
  const clouds = fields.get(ctx);
  if (clouds) clouds.length = 0;
}

function num(spec: AbilitySpec, k: string, d: number): number {
  const v = spec[k];
  return typeof v === 'number' ? v : d;
}

const timers = new WeakMap<Creature, number>();

registerAbility('smoke', {
  init(c, spec) {
    timers.set(c, num(spec, 'delay', 1));
  },
  step(c, spec, ctx, dt, organ) {
    if (c.state === 'spawning') return;
    const t = (timers.get(c) ?? 0) - dt;
    if (t > 0) {
      timers.set(c, t);
      return;
    }
    timers.set(c, num(spec, 'interval', 0.4));
    // From the top of the stack, a little behind it (the smoker itself stays in sight).
    const x = organ.x + num(spec, 'behind', 1.2);
    const y = organ.y - organ.halfHeightNow;
    const rng = ctx.rng;
    const rMax = num(spec, 'radius', 4.2) * (0.8 + rng.next() * 0.4);
    // (Settling at heights spread round `height`: a bank as tall as a walker, not a band.)
    const settle = num(spec, 'height', 6) * (0.6 + rng.next() * 0.8);
    field(ctx).push({ x, y, r: 0.6, vx: 0.4 + rng.next() * 0.5, vy: 0, age: 0, rMax, settle, life: num(spec, 'life', 8) * (0.85 + rng.next() * 0.3), spin: rng.next() * Math.PI * 2 });
    ctx.events.emit('creatureAbility', { creature: c, ability: spec.id, x, y });
  },
});
