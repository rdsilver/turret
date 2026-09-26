/**
 * Roaming weak spot (ability 'roamingWeakSpot'): a creature that can only be
 * hurt in one place at a time.
 *
 * Exactly one part it carries is open to fire — its weak spot
 * (Creature.weakSpot) — and every other part is invulnerable
 * (StructurePart.invulnerable: rounds deflect and nothing wears down). Every
 * `period` seconds (± `jitter`) the spot moves on to another of `parts`: in a
 * shuffled order that visits each of them once before any comes round again,
 * never the same part twice in a row. `warn` seconds before a timed move the
 * next part is already chosen (weakSpotTelegraph), so the view can announce it.
 *
 * A visit can only take so much: once the spot has lost `burnout` of its
 * integrity it is spent and the spot moves on at once. So a part breaks over
 * several visits whatever the gun, and a gunner who keeps up with the spot
 * (burning each visit out quickly) brings every part round again sooner than
 * one who waits for a single part to come back.
 *
 * Damage stays where it landed: a leg worn down over three visits buckles, and a
 * body worn through dies. A part that is wrecked or cut off drops out of the
 * rotation (if the spot was on it, it moves on at once). Once the creature is
 * stopped every part is vulnerable again, so its wreck behaves like any other.
 *
 * Params: parts (comma-separated part ids), period, jitter, warn, delay (s
 * before the first move), burnout (integrity per visit, 0 = no limit). The
 * organ should be the core: the ability then lasts as long as the creature.
 */
import { registerAbility } from './abilities';
import type { Creature } from './Creature';
import type { AbilitySpec } from './CreatureTypes';
import type { StructurePart } from '../StructurePart';
import { Random } from '../../core/Random';

interface RoamState {
  /** Every part the spot can visit. */
  pool: StructurePart[];
  /** What is left of the current round of visits (drawn from the end). */
  bag: StructurePart[];
  current: StructurePart | null;
  next: StructurePart | null;
  /** Integrity of the current spot when its visit began. */
  startIntegrity: number;
  /** Seconds until the spot moves. */
  timer: number;
  period: number;
  jitter: number;
  warn: number;
  burnout: number;
  rng: Random;
  off: () => void;
}

const roam = new WeakMap<Creature, RoamState>();

function num(spec: AbilitySpec, k: string, d: number): number {
  const v = spec[k];
  return typeof v === 'number' ? v : d;
}

/** Still in play: intact and carried by the creature. */
function inPlay(c: Creature, p: StructurePart): boolean {
  return !p.removed && !p.wrecked && c.owns(p);
}

/** Next part from the shuffled round (a fresh round when it runs dry), never `not`; null if nothing else is left. */
function draw(c: Creature, st: RoamState, not: StructurePart | null): StructurePart | null {
  for (let round = 0; round < 2; round++) {
    for (let i = st.bag.length - 1; i >= 0; i--) {
      const p = st.bag[i]!;
      if (!inPlay(c, p)) {
        st.bag.splice(i, 1);
        continue;
      }
      if (p === not) continue;
      st.bag.splice(i, 1);
      return p;
    }
    const bag = st.pool.filter((p) => inPlay(c, p));
    for (let i = bag.length - 1; i > 0; i--) {
      const k = Math.floor(st.rng.next() * (i + 1));
      [bag[i], bag[k]] = [bag[k]!, bag[i]!];
    }
    st.bag = bag;
  }
  return null;
}

/** Move the spot to `p` (null: stay put) and start a new visit. */
function moveTo(st: RoamState, p: StructurePart | null): void {
  if (p) st.current = p;
  st.next = null;
  st.startIntegrity = st.current?.integrity ?? 1;
  st.timer = st.period + (st.rng.next() * 2 - 1) * st.jitter;
}

/** Open the current spot, close everything else the creature carries (loose pieces are ordinary debris). */
function apply(c: Creature, st: RoamState): void {
  c.weakSpot = st.current;
  for (const p of c.structure.parts) if (!p.removed) p.invulnerable = p !== st.current && c.owns(p);
}

function release(c: Creature, st: RoamState): void {
  st.off();
  roam.delete(c);
  st.current = st.next = null;
  c.weakSpot = null;
  for (const p of c.structure.parts) p.invulnerable = false;
}

registerAbility('roamingWeakSpot', {
  init(c, spec, ctx) {
    const pool: StructurePart[] = [];
    for (const id of String(spec.parts ?? '').split(',')) {
      const p = c.structure.part(id.trim());
      if (p) pool.push(p);
    }
    if (!pool.includes(c.core)) pool.push(c.core);
    const st: RoamState = {
      pool,
      bag: [],
      current: null,
      next: null,
      startIntegrity: 1,
      timer: 0,
      period: num(spec, 'period', 3),
      jitter: num(spec, 'jitter', 0),
      warn: num(spec, 'warn', 0.8),
      burnout: num(spec, 'burnout', 0),
      // Its own stream (seeded from the sim's), so the route doesn't depend on what else draws numbers.
      rng: new Random(Math.floor(ctx.rng.next() * 0x7fffffff)),
      off: () => {},
    };
    // Stopped (or cleared away with the level): everything is ordinary again.
    const offs = [
      ctx.events.on('creatureNeutralized', ({ creature }) => {
        if (creature === c) release(c, st);
      }),
      ctx.events.on('entityRemoved', ({ entity }) => {
        if (entity === c.core) release(c, st);
      }),
    ];
    st.off = () => {
      for (const off of offs) off();
    };
    moveTo(st, draw(c, st, null));
    st.timer = num(spec, 'delay', st.period);
    roam.set(c, st);
    apply(c, st);
  },
  step(c, _spec, _ctx, dt) {
    const st = roam.get(c);
    if (!st) return;
    st.timer -= dt;
    if (st.next && !inPlay(c, st.next)) st.next = null;
    const cur = st.current;
    if (!cur || !inPlay(c, cur)) {
      // Wrecked or cut off while it was the spot: move on at once (to the core if
      // nothing else is left; never leave the creature with no way to hurt it).
      const to = st.next ?? draw(c, st, cur) ?? (inPlay(c, c.core) ? c.core : null);
      if (!to) return release(c, st);
      moveTo(st, to);
    } else if (st.burnout > 0 && st.startIntegrity - cur.integrity >= st.burnout) {
      // Spent for this visit.
      moveTo(st, st.next ?? draw(c, st, cur));
    } else {
      if (!st.next && st.timer <= st.warn) st.next = draw(c, st, cur);
      // (Nothing else left in play: it stays where it is.)
      if (st.timer <= 0) moveTo(st, st.next);
    }
    apply(c, st);
  },
});

const telegraph = { part: null as StructurePart | null, progress: 0, burn: 0 };

/**
 * A roaming weak spot's state for the view, or null for any other creature
 * (or once it is stopped): `part` = where the spot moves next (null until it
 * is announced), `progress` 0..1 = how close that move is, `burn` 0..1 = how
 * much of this visit's damage allowance the current spot has taken. The
 * returned object is reused.
 */
export function weakSpotTelegraph(c: Creature): Readonly<{ part: StructurePart | null; progress: number; burn: number }> | null {
  const st = roam.get(c);
  if (!st || !st.current || !c.weakSpot) return null;
  telegraph.part = st.next;
  telegraph.progress = st.next ? Math.min(1, Math.max(0, 1 - st.timer / Math.max(0.01, st.warn))) : 0;
  telegraph.burn = st.burnout > 0 ? Math.min(1, Math.max(0, (st.startIntegrity - st.current.integrity) / st.burnout)) : 0;
  return telegraph;
}
