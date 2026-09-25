/**
 * Built-in projectile behaviours. Importing this module registers them.
 *
 *  explode   – detonate on first impact (radius, power)
 *  cluster   – split into sub-munitions after a delay / at the apex (count, spread, delay)
 *  embrittle – "freeze shot": joints near the impact become brittle for a while
 *              (radius, scale, seconds). Changes the physics instead of adding force.
 *  gravity   – reverse/alter gravity for bodies near the impact (radius, scale, seconds)
 */
import { registerBehavior, num } from './Ammo';
import { StructurePart } from '../StructurePart';
import type { Projectile } from './Projectile';

registerBehavior('explode', {
  onImpact(p, spec, ctx, hit) {
    const radius = num(spec, 'radius', 4);
    const power = num(spec, 'power', 1);
    ctx.explosions.explode(hit.x, hit.y, radius, power, 'projectile');
    ctx.projectiles.expire(p, 0);
  },
});

registerBehavior('cluster', {
  onStep(p, spec, ctx) {
    if (p.state !== 'flying' || p.data.split) return;
    const delay = num(spec, 'delay', 0.55);
    const age = ctx.physics.simTime - p.bornAt;
    // Split at the apex (vy turns downward) or after the delay, whichever is later.
    if (age < delay || p.vy < 0) return;
    p.data.split = 1;
    const count = Math.round(num(spec, 'count', 5));
    const spread = num(spec, 'spread', 0.35);
    const speed = Math.hypot(p.vx, p.vy);
    const base = Math.atan2(p.vy, p.vx);
    for (let i = 0; i < count; i++) {
      const a = base + (i / Math.max(1, count - 1) - 0.5) * spread;
      const s = speed * (0.9 + ctx.rng.next() * 0.2);
      ctx.projectiles.spawn({
        ammo: SUBMUNITION,
        x: p.x + Math.cos(a) * p.radius * 2,
        y: p.y + Math.sin(a) * p.radius * 2,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        radius: p.radius * 0.55,
        mass: p.mass / count,
        shot: p.shot,
      });
    }
    ctx.projectiles.expire(p, 0);
  },
});

registerBehavior('embrittle', {
  onImpact(p, spec, ctx, hit) {
    const radius = num(spec, 'radius', 4);
    const scale = num(spec, 'scale', 0.35);
    const seconds = num(spec, 'seconds', 6);
    for (const j of ctx.physics.joints) {
      const d = Math.hypot(j.wx - hit.x, j.wy - hit.y);
      if (d < radius) ctx.status.weakenJoint(j, scale + (1 - scale) * (d / radius) * 0.5, seconds, 0.25);
    }
    freezeTag(p);
  },
});

registerBehavior('gravity', {
  onImpact(p, spec, ctx, hit) {
    const radius = num(spec, 'radius', 5);
    const scale = num(spec, 'scale', -0.6);
    const seconds = num(spec, 'seconds', 3);
    for (const e of ctx.physics.entities.values()) {
      if (e === p || !(e instanceof StructurePart) || e.fixed) continue;
      if (Math.hypot(e.x - hit.x, e.y - hit.y) < radius) {
        e.body.wakeUp();
        ctx.status.setGravityScale(e, scale, seconds);
      }
    }
  },
});

function freezeTag(p: Projectile): void {
  p.data.frozeAt = 1;
}

/** Sub-munition used by the cluster behaviour (not purchasable on its own). */
export const SUBMUNITION = {
  id: 'submunition',
  name: 'Bomblet',
  description: '',
  radiusScale: 1,
  massScale: 1,
  speedScale: 1,
  restitution: 0.2,
  friction: 0.5,
  color: 0xffb347,
  trailColor: 0xffb347,
  cost: 0,
  lifetime: 1.5,
  behaviors: [{ id: 'explode', radius: 2.2, power: 0.45 }],
};

/** Small-arms damage: wears down the part it hits (see Damage.ts). amount = multiplier on the round's damage. */
registerBehavior('damage', {
  onImpact(p, spec, ctx, hit) {
    const t = hit.target;
    if (t instanceof StructurePart) ctx.damage.apply(t, p.damage * num(spec, 'amount', 1), hit.x, hit.y, p.pierce);
  },
});
