/**
 * Brood (ability 'brood'): a creature that hatches small, fast walkers in
 * front of itself. Every `interval` seconds (the first after `delay`) a
 * hatchling of blueprint `kind` (a stick walker by default), built at `sizeMul`
 * times its usual size with `hpMul` times its hit points and walking at
 * `speed`, springs up `ahead` metres in
 * front of the creature's front (never nearer the turret than `minX`), and
 * runs at the line on its own (creatureHatched: the game counts it as one
 * more creature to stop). At most `maxLive` of its hatchlings are about at a
 * time, and `count` in all. The organ is the brood sac: burst it (or cut it
 * off) and no more hatch.
 *
 * Params: kind, sizeMul, hpMul, speed, interval, delay, ahead, minX, maxLive, count,
 * bounty (each hatchling's).
 */
import { registerAbility } from './abilities';
import type { Creature } from './Creature';
import type { AbilitySpec } from './CreatureTypes';

interface BroodState {
  timer: number;
  live: Creature[];
  hatched: number;
}

const brood = new WeakMap<Creature, BroodState>();

function num(spec: AbilitySpec, k: string, d: number): number {
  const v = spec[k];
  return typeof v === 'number' ? v : d;
}

registerAbility('brood', {
  init(c, spec) {
    brood.set(c, { timer: num(spec, 'delay', 3), live: [], hatched: 0 });
  },
  step(c, spec, ctx, dt) {
    const st = brood.get(c);
    if (!st || c.state === 'spawning') return;
    st.timer -= dt;
    if (st.timer > 0) return;
    st.timer = num(spec, 'interval', 4.5);
    st.live = st.live.filter((k) => k.active);
    if (st.live.length >= num(spec, 'maxLive', 3) || st.hatched >= num(spec, 'count', 8)) return;
    const x = Math.max(num(spec, 'minX', 22), c.frontX - num(spec, 'ahead', 3.5));
    // (Too near the line to hatch in front of itself: it holds on to this one.)
    if (x >= c.frontX) return;
    const kid = ctx.creatures.spawn(
      typeof spec.kind === 'string' ? spec.kind : 'stickman',
      x,
      { sizeMul: num(spec, 'sizeMul', 0.4), speed: num(spec, 'speed', 1.6), hpMul: num(spec, 'hpMul', 1), name: 'Hatchling', bounty: num(spec, 'bounty', 15) },
      Math.floor(ctx.rng.next() * 0x7fffffff),
    );
    st.live.push(kid);
    st.hatched++;
    ctx.events.emit('creatureHatched', { creature: kid, parent: c, x, y: kid.core.y });
  },
});
