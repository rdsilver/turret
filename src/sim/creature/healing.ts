/**
 * Support abilities of flying healers (see blueprints/mender.ts).
 *
 *  heal   – the organ (a glowing lamp) shines a cone of light straight down;
 *           damaged parts of other creatures inside it get their hit points
 *           back, and their joints their strength (the inverse of Damage.ts:
 *           a joint is as strong as the weaker of its two parts). A shared
 *           budget of `rate` hit points per second is spread over the parts
 *           in the light by how much each has lost, at most `partRate` of a
 *           part per second. It never brings back a wrecked part or a broken
 *           joint, and never heals a healer (itself included). It works only
 *           while the healer flies whole (a wing short, the light goes out).
 *           (rate, partRate, r0, tan, reach, tick)
 *  escort – instead of flying at the line, the flyer takes station above an
 *           ally: the one closest to the line, unless another is hurt enough
 *           to need it more (menders spread over different allies). It hovers
 *           `above` metres over the ally's highest point, over the ally's
 *           middle drawn toward its damage (never ahead of its front), and
 *           keeps pace; a healer whose lamp is gone tags along behind it.
 *           With no ally left it hangs in the air for `linger` seconds, then
 *           flies at the line like any flyer. A wing short, it stops trying
 *           to hold height and drops at about `drop` m/s (the lamp drags it
 *           down: a short fall, not a bird's long glide).
 *           It also sets the creature's target priority (see priority()):
 *           once it has been seen mending for `notice` seconds, gunners go
 *           for it first while its light shines; until then, and once the
 *           light is out, an escort counts as no closer to the line than the
 *           ally it follows (it is no threat to the line while it has one).
 *           (above, minHeight, maxHeight, speed, retarget, linger, drop, notice)
 *
 * Distances are metres at game scale (after scaleCreature).
 */
import type { SimContext } from '../SimContext';
import type { Creature } from './Creature';
import type { AbilitySpec } from './CreatureTypes';
import type { StructurePart } from '../StructurePart';
import { registerAbility } from './abilities';
import { MIN_JOINT_SCALE } from '../Damage';
import { TURRET } from '../../config/constants';
import { clamp } from '../../core/math';

export const HEAL_ABILITY = 'heal';

function num(spec: AbilitySpec, k: string, d: number): number {
  const v = spec[k];
  return typeof v === 'number' ? v : d;
}

/** Does this creature still carry a working heal organ (its lamp)? */
export function canHeal(c: Creature): boolean {
  const a = healSpec(c);
  const organ = a ? c.structure.part(a.part) : undefined;
  return !!organ && c.organAttached(organ);
}

/** Is this creature's lamp shining (active, flying whole, organ attached)? */
export function healing(c: Creature): boolean {
  return c.state === 'walking' && canHeal(c);
}

/** The heal ability of a creature, if it has one. */
export function healSpec(c: Creature): AbilitySpec | undefined {
  return c.spec.abilities?.find((a) => a.id === HEAL_ABILITY);
}

export interface HealCone {
  /** Half-width at the lamp (m), its growth per metre below it, and how far down it reaches (m). */
  r0: number;
  tan: number;
  reach: number;
}

/** The cone of light a heal ability works in (apex at the organ's centre, opening downward). */
export function healCone(spec: AbilitySpec): HealCone {
  return { r0: num(spec, 'r0', 1.1), tan: num(spec, 'tan', 0.4), reach: num(spec, 'reach', 24) };
}

/** Is sim point (x, y) of a part with this extent inside the cone below (ox, oy)? */
function inCone(cone: HealCone, ox: number, oy: number, x: number, y: number, extent: number): boolean {
  const dy = y - oy; // sim y points down
  if (dy <= 0 || dy > cone.reach) return false;
  return Math.abs(x - ox) - extent * 0.5 <= cone.r0 + dy * cone.tan;
}

/** Joints regain the strength weapon damage took (the weaker of each joint's two parts decides). */
function restoreJoints(ctx: SimContext, part: StructurePart): void {
  const world = ctx.physics.world;
  for (const j of part.joints) {
    if (j.broken) continue;
    const o = j.other(part);
    const integrity = Math.min(part.integrity, o && !o.removed ? o.integrity : 1);
    const scale = MIN_JOINT_SCALE + (1 - MIN_JOINT_SCALE) * integrity;
    if (j.strengthScale < scale - 0.002) j.setStrengthScale(world, scale, 0.5 + 0.5 * scale);
  }
}

interface HealState {
  acc: number;
  /** Seconds spent mending something so far. */
  time: number;
}
const healState = new WeakMap<Creature, HealState>();

/** Seconds this healer has spent mending something so far. */
export function mendedFor(c: Creature): number {
  return healState.get(c)?.time ?? 0;
}

interface Wounded {
  part: StructurePart;
  lost: number;
}
const wounded: Wounded[] = [];

registerAbility(HEAL_ABILITY, {
  init(c) {
    healState.set(c, { acc: 0, time: 0 });
  },
  step(c, spec, ctx, dt, organ) {
    const st = healState.get(c);
    // Only while it flies whole: a wing short, it is too busy staying up.
    if (!st || c.state !== 'walking') return;
    st.acc += dt;
    const tick = num(spec, 'tick', 0.1);
    if (st.acc < tick) return;
    const T = st.acc;
    st.acc = 0;
    const cone = healCone(spec);
    const ox = organ.x;
    const oy = organ.y;
    const span = cone.r0 + cone.reach * cone.tan + 20;
    wounded.length = 0;
    let lostSum = 0;
    for (const k of ctx.creatures.list) {
      if (k === c || !k.active || k.core.removed || healSpec(k)) continue;
      if (Math.abs(k.core.x - ox) > span) continue;
      for (const p of k.structure.parts) {
        if (p.removed || p.wrecked || p.fixed || p.integrity >= 0.999 || p.integrity <= 0) continue;
        if (!inCone(cone, ox, oy, p.x, p.y, p.extent) || !k.owns(p)) continue;
        const lost = (1 - p.integrity) * p.maxHp;
        wounded.push({ part: p, lost });
        lostSum += lost;
      }
    }
    if (lostSum <= 0) return;
    // The budget goes where the damage is: shares by hit points lost.
    const budget = num(spec, 'rate', 2.5) * T;
    const partRate = num(spec, 'partRate', 0.3) * T;
    let mended = false;
    for (const w of wounded) {
      const p = w.part;
      const amount = Math.min(w.lost, (budget * w.lost) / lostSum, partRate * p.maxHp);
      if (amount <= 0) continue;
      p.integrity = Math.min(1, p.integrity + amount / p.maxHp);
      restoreJoints(ctx, p);
      ctx.events.emit('partHealed', { part: p, amount, integrity: p.integrity, healer: c, organ, x: p.x, y: p.y });
      mended = true;
    }
    wounded.length = 0;
    if (mended) st.time += T;
  },
});

// ---------------------------------------------------------------- escort

interface EscortState {
  ally: Creature | null;
  retarget: number;
  /** Smoothed hover point relative to the ally's middle (m), ally top (height), ally velocity. */
  hx: number;
  top: number;
  vAlly: number;
  /** Commanded altitude and climb rate (a critically damped follower of the station height). */
  h: number;
  vh: number;
  /** Commanded horizontal velocity (acceleration-limited). */
  vx: number;
  fresh: boolean;
  /** Seconds without an ally to escort. */
  lonely: number;
}
const escortState = new WeakMap<Creature, EscortState>();

/** Hit points an ally has lost on parts still attached to it (capped). */
function need(k: Creature): number {
  let lost = 0;
  for (const p of k.structure.parts) {
    if (p.removed || p.wrecked || p.integrity >= 0.999 || !k.owns(p)) continue;
    lost += (1 - p.integrity) * p.maxHp;
  }
  return Math.min(lost, 20);
}

function pickAlly(c: Creature, ctx: SimContext, st: EscortState): Creature | null {
  let best: Creature | null = null;
  let bestScore = -Infinity;
  for (const k of ctx.creatures.list) {
    if (k === c || !k.active || k.core.removed || k.age < 0.3 || k.spec.fly || healSpec(k)) continue;
    // Closest to the line first, but a badly hurt ally further back can win;
    // an ally another escort already watches over counts for less.
    let score = -k.frontX + 0.8 * need(k);
    if (k === st.ally) score += 4;
    for (const o of ctx.creatures.list) {
      // (A healer that lost its lamp doesn't count: it only tags along.)
      if (o === c || !o.active || !escorting(o) || (healSpec(o) && !canHeal(o))) continue;
      if (escortState.get(o)?.ally === k) {
        score -= 12;
        break;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

/**
 * A creature whose front is this close to the turret (m; the defense line is
 * 6.5 m in front of it) is about to break through: then nothing else is worth
 * shooting first.
 */
const CLOSING = 14.5;

/**
 * How much closer to the line than it is gunners should count an escort right
 * now (Creature.targetPriority):
 *  - a healer seen mending for `notice` seconds, its light still shining:
 *    spec.targetPriority (it is known for what it is: shoot it first) — but
 *    not while another creature is about to break through;
 *  - any other escort with an ally to follow (on its way to station, its
 *    light not yet seen at work, or out): no closer than that ally's front.
 *    It never crosses the line while it has one, so it is no threat yet —
 *    and the light gets to do some visible good before the top turret swings
 *    round to it;
 *  - alone: as close as it is (and a wing short, see the escort step, as it
 *    may still come down across the line).
 */
function priority(c: Creature, ctx: SimContext, ally: Creature | null, notice: number): number {
  if (!ally) return 0;
  const base = c.spec.targetPriority ?? 0;
  if (base > 0 && healing(c) && mendedFor(c) >= notice) {
    let closing = false;
    for (const o of ctx.creatures.list) {
      if (o !== c && o.active && !o.core.removed && o.frontX < TURRET.x + CLOSING) closing = true;
    }
    if (!closing) return base;
  }
  return Math.min(0, c.frontX - ally.frontX - 0.5);
}

registerAbility('escort', {
  init(c) {
    escortState.set(c, { ally: null, retarget: 0, hx: 0, top: 0, vAlly: 0, h: 0, vh: 0, vx: 0, fresh: true, lonely: 0 });
  },
  step(c, spec, ctx, dt) {
    const st = escortState.get(c);
    if (!st || !c.spec.fly) return;
    if (c.state === 'crippled') {
      c.targetPriority = 0;
      // A wing short, it gives up holding height and the lamp takes it down
      // (the controller's glide would carry it 9 m on from station height;
      // a wing short, the controller keeps its own heading).
      c.flyGoal = { height: c.core.height - 1, vUp: -num(spec, 'drop', 6), vx: c.core.vx };
      st.fresh = true;
      return;
    }
    st.retarget -= dt;
    if (st.retarget <= 0 || !st.ally?.active || st.ally.core.removed) {
      st.retarget = num(spec, 'retarget', 1);
      st.ally = pickAlly(c, ctx, st);
    }
    const k = st.ally;
    c.targetPriority = priority(c, ctx, k, num(spec, 'notice', 2));
    const core = c.core;
    if (!k) {
      // Nothing left to escort: it hangs in the air a moment, looking, then
      // flies at the line (the controller's own heading).
      if (st.lonely === 0) {
        st.fresh = true;
        st.h = core.height;
        st.vx = core.vx;
      }
      st.lonely += dt;
      if (st.lonely < num(spec, 'linger', 2.5)) {
        st.vx += clamp(-st.vx, -2.2 * dt, 2.2 * dt);
        c.flyGoal = { height: st.h, vUp: 0, vx: st.vx };
      }
      return;
    }
    st.lonely = 0;
    // Where the ally is: its top, its middle (mass-weighted) and where it is hurt.
    let top = 0;
    let back = -Infinity;
    let mx = 0;
    let m = 0;
    let dx = 0;
    let dw = 0;
    let vx = 0;
    for (const p of k.structure.parts) {
      if (p.removed || p.wrecked || !k.owns(p)) continue;
      top = Math.max(top, p.height + p.halfHeightNow);
      back = Math.max(back, p.x + p.halfWidthNow);
      mx += p.x * p.mass;
      vx += p.vx * p.mass;
      m += p.mass;
      if (p.integrity < 0.999) {
        const lost = (1 - p.integrity) * p.maxHp;
        dx += p.x * lost;
        dw += lost;
      }
    }
    if (m <= 0) return;
    mx /= m;
    vx /= m;
    // Over its middle, drawn toward its wounds; with its lamp gone it just
    // tags along behind. Never ahead of the ally's front.
    const W0 = 4;
    let hx = canHeal(c) ? (mx * W0 + dx) / (W0 + dw) : back + 2;
    const rear = k.frontX + (c.x - c.frontX) + 1.2;
    hx = Math.max(hx, rear);
    if (st.fresh) {
      st.fresh = false;
      st.hx = hx - mx;
      st.top = top;
      st.vAlly = vx;
      st.h = core.height;
      st.vh = -core.vy;
      st.vx = core.vx;
    }
    // (The offset from its middle is smoothed, not the point itself: no lag behind a walking ally.)
    st.hx += (hx - mx - st.hx) * Math.min(1, dt / 0.6);
    st.top += (top - st.top) * Math.min(1, dt / 1.0);
    st.vAlly += (vx - st.vAlly) * Math.min(1, dt / 0.5);
    // Station height, followed smoothly (critically damped, no overshoot).
    const station = clamp(st.top + num(spec, 'above', 5), num(spec, 'minHeight', 8), num(spec, 'maxHeight', 24));
    const w = 1.1;
    st.vh += (w * w * (station - st.h) - 2 * w * st.vh) * dt;
    st.h += st.vh * dt;
    // Keep pace, closing the gap gently; acceleration-limited so it never jerks.
    const vmax = c.spec.gait.speed * num(spec, 'speed', 1.8) * Math.max(1, c.speedBoost);
    const want = clamp(st.vAlly + 0.5 * (Math.max(mx + st.hx, rear) - core.x), -vmax, vmax);
    const aMax = 2.2 * dt;
    st.vx += clamp(want - st.vx, -aMax, aMax);
    c.flyGoal = { height: st.h, vUp: st.vh, vx: st.vx };
  },
});

/** Is this creature escorting (alive, with the organ its escort ability needs)? */
function escorting(c: Creature): boolean {
  const a = c.spec.abilities?.find((s) => s.id === 'escort');
  const organ = a ? c.structure.part(a.part) : undefined;
  return !!organ && c.organAttached(organ);
}

/** The ally an escorting creature is watching over (views, tools). */
export function escortOf(c: Creature): Creature | null {
  return c.active && escorting(c) ? (escortState.get(c)?.ally ?? null) : null;
}
