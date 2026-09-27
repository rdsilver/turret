/**
 * Telekinetic haste: the support ability of the hastener (see
 * blueprints/hastener.ts), a flyer that escorts walkers (the escort ability
 * in healing.ts) and speeds them up for good.
 *
 *  haste – the organ (a glowing crystal) holds a telekinetic beam on the ally
 *          its creature escorts. While the beam holds, the ally's lasting
 *          speed multiplier (Creature.speedMul) climbs by `rate` a second, up
 *          to `cap` — or the ally's own spec.maxSpeedMul, if lower. The gain
 *          belongs to that one creature for good: it stays when the beam
 *          stops, when the hastener moves on and after it dies (no other
 *          creature of its kind is any faster). The beam reaches `reach`
 *          metres from the crystal to the ally's body, works only while the
 *          hastener flies whole (a wing short, it lets go) and never hastens
 *          a flyer. (rate, cap, reach, tick)
 *
 * Its escort role: once an ally is as fast as the beam makes anything, the
 * hastener moves on to the next ally that isn't (the one closest to the line,
 * as ever), so the longer it lives the more of the field it speeds up — that
 * is what makes it worth shooting first. With every ally maxed it just keeps
 * station over the one closest to the line. Hasteners spread over different
 * allies (as healers do); a healer and a hastener may share one. It hovers a
 * little behind its ally's middle (`behind` m, on the escort spec), so the
 * beam slants down onto it. It counts as at work (for the top turret, see the
 * escort's priority) only while its beam is actually raising an ally's speed.
 *
 * Distances are metres at game scale (after scaleCreature).
 */
import type { Creature } from './Creature';
import type { AbilitySpec } from './CreatureTypes';
import { registerAbility } from './abilities';
import { escortOf, registerEscortRole } from './healing';

export const HASTE_ABILITY = 'haste';

function num(spec: AbilitySpec | undefined, k: string, d: number): number {
  const v = spec?.[k];
  return typeof v === 'number' ? v : d;
}

/** The haste ability of a creature, if it has one. */
export function hasteSpec(c: Creature): AbilitySpec | undefined {
  return c.spec.abilities?.find((a) => a.id === HASTE_ABILITY);
}

/** Does this creature still carry its crystal? */
export function canHaste(c: Creature): boolean {
  const a = hasteSpec(c);
  const organ = a ? c.structure.part(a.part) : undefined;
  return !!organ && c.organAttached(organ);
}

/** The most a beam that goes up to `cap` can hasten creature `k` (its spec may hold it lower). */
export function hasteCapOf(k: Creature, cap: number): number {
  return Math.max(1, Math.min(cap, k.spec.maxSpeedMul ?? cap));
}

interface HasteState {
  /** The ally the beam is on right now (null = no beam). */
  target: Creature | null;
  /** Seconds spent hastening something so far. */
  time: number;
  acc: number;
}
const hasteState = new WeakMap<Creature, HasteState>();

/** The creature this hastener's beam is on right now (views, tools), or null. */
export function hasteTarget(c: Creature): Creature | null {
  const t = hasteState.get(c)?.target ?? null;
  return t && c.active && t.active && canHaste(c) ? t : null;
}

/** Is ally `k` as fast as this hastener's beam can make it? */
function maxed(c: Creature, k: Creature): boolean {
  return k.speedMul >= hasteCapOf(k, num(hasteSpec(c), 'cap', 1.6)) - 1e-3;
}

registerAbility(HASTE_ABILITY, {
  init(c) {
    hasteState.set(c, { target: null, time: 0, acc: 0 });
  },
  step(c, spec, ctx, dt, organ) {
    const st = hasteState.get(c);
    if (!st) return;
    st.target = null;
    // Only while it flies whole: a wing short, it is too busy staying up.
    if (c.state !== 'walking') return;
    const k = escortOf(c);
    if (!k || !k.active || k.core.removed || k.spec.fly) return;
    const reach = num(spec, 'reach', 16);
    if (Math.hypot(k.core.x - organ.x, k.core.y - organ.y) > reach) return;
    const cap = hasteCapOf(k, num(spec, 'cap', 1.6));
    if (k.speedMul >= cap - 1e-3) return;
    k.speedMul = Math.min(cap, k.speedMul + num(spec, 'rate', 0.1) * dt);
    st.target = k;
    st.time += dt;
    st.acc += dt;
    const done = k.speedMul >= cap - 1e-3;
    if (st.acc < num(spec, 'tick', 0.25) && !done) return;
    st.acc = 0;
    ctx.events.emit('creatureHasted', { creature: k, hastener: c, organ, speedMul: k.speedMul, maxed: done, x: k.core.x, y: k.core.y });
  },
});

registerEscortRole(HASTE_ABILITY, {
  working: canHaste,
  atWork: (c) => hasteTarget(c) !== null,
  workedFor: (c) => hasteState.get(c)?.time ?? 0,
  // An ally already as fast as it gets isn't worth the trip: on to the next.
  want: (c, k) => (maxed(c, k) ? -100 : 0),
  station: (c, _k, mx) => mx + num(c.spec.abilities?.find((a) => a.id === 'escort'), 'behind', 1.5),
});
