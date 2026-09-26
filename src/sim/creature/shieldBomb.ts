/**
 * Shield bombs: a creature ability and the bombs and walls it leaves on the
 * field.
 *
 *  throwShieldBomb – lobs a big glowing canister ten-odd metres ahead of the
 *                    creature. Once it lands its fuse ticks: a red light
 *                    blinking and beeping faster and faster. Hit it `hits`
 *                    times (4; any round counts, whatever its damage) before
 *                    the fuse runs out and it pops harmlessly. If the fuse runs
 *                    out it springs up into a tall armour wall standing on
 *                    the ground: bullets (the main gun's and the top
 *                    turret's) stop on it, so it shields every creature
 *                    behind it, while creatures walk straight through it. A
 *                    wall stands for `wallLife` seconds, then keels over and
 *                    fades; very sustained fire knocks it down sooner (it is
 *                    armour: armour-piercing rounds help a lot).
 *
 * Params: interval, delay (first throw), ahead (landing distance in front of
 * the core, scaled with the creature), size (canister height, scaled by √s),
 * flight (s in the air), fuse (s after landing), maxLive (bombs + standing
 * walls of this creature at once), minX / maxX (sim x range bombs land in:
 * never so near the turret that a wall would hide the last stretch before
 * the line, never so far out that they can't be hit), hits (rounds that pop a
 * bomb), wallH, wallW,
 * wallLife, wallHp (world metres / hp multipliers, not scaled), muscle /
 * windup / release / carry (the throwing arm's shoulder and its angles), hand
 * (part the bomb leaves from while it is attached; else the organ), ammo
 * (comma-separated pack parts: each throw takes one as it lets go, none left
 * = no more bombs; one shot or knocked off the pack pops on the spot, so the
 * only glowing canister ever lying on the field is a live bomb).
 *
 * Bombs and walls block bullets but never touch creatures (or anything else
 * but the ground): a creature can lob a bomb over its own wall.
 *
 * The top turret doesn't hunt bombs: they are the player's job (it keeps
 * working on the creatures, the throwing arm first). Tools can find live
 * bombs with liveShieldBombs().
 */
import type { SimContext } from '../SimContext';
import type { PhysicsWorld } from '../PhysicsWorld';
import type { StructurePart } from '../StructurePart';
import type { Creature } from './Creature';
import type { AbilitySpec } from './CreatureTypes';
import { registerAbility } from './abilities';
import { spawnPart } from '../StructureBuilder';
import { R } from '../RapierModule';
import { GROUP, interactionGroups } from '../../config/constants';

/** A thrown bomb, from the throw until it pops or deploys. */
export interface ShieldBomb {
  part: StructurePart;
  owner: Creature;
  /** Canister height (m): the fuse light sits on its top. */
  h: number;
  thrownAt: number;
  /** Sim time it came to rest on the ground (-1 while in the air). */
  landedAt: number;
  /** Fuse (s) once landed. */
  fuse: number;
  /** Rounds it has taken, and how many pop it. */
  hits: number;
  hitsToPop: number;
  nextTick: number;
  wall: WallSpec;
}

interface WallSpec {
  h: number;
  w: number;
  life: number;
  hp: number;
}

interface ShieldWall {
  part: StructurePart;
  owner: Creature;
  spec: WallSpec;
  bornAt: number;
  /** Ground pivot (the wall's foot) it swings up around. */
  px: number;
  /** Sim time it started to crumble (-1 while standing). */
  crumbleAt: number;
}

/** A canister still racked on a creature's pack (it pops if it comes off). */
interface PackCan {
  part: StructurePart;
  owner: Creature;
}

interface BombField {
  bombs: ShieldBomb[];
  walls: ShieldWall[];
  cans: PackCan[];
}

/** Seconds the wall takes to swing up from the ground. */
const RISE_TIME = 0.32;
/** Seconds a crumbling wall takes to fade (shot down: faster). */
const CRUMBLE_TIME = 1.1;
const SHOT_DOWN_TIME = 0.6;
/** The foot sits this far below the surface so no round slips under the wall. */
const FOOT_DEPTH = 0.15;
/** Blinks come every `TICK_MIN + TICK_SPAN * fuse left fraction` seconds. */
const TICK_MIN = 0.08;
const TICK_SPAN = 0.47;

/**
 * Walls stop bullets and nothing else: creatures walk through them, and a wall
 * swinging up doesn't bat rubble or thrown rubber blocks across the field.
 * Bombs also rest on the ground.
 */
const WALL_GROUPS = interactionGroups(GROUP.STRUCTURE, GROUP.PROJECTILE);
const BOMB_GROUPS = interactionGroups(GROUP.STRUCTURE, GROUP.GROUND | GROUP.PROJECTILE);
/** Popped bombs and falling walls: nothing stops on them any more. */
const SPENT_GROUPS = interactionGroups(GROUP.DEBRIS, GROUP.GROUND);

const fields = new WeakMap<PhysicsWorld, BombField>();

function fieldOf(ctx: SimContext): BombField {
  let f = fields.get(ctx.physics);
  if (!f) {
    const field: BombField = { bombs: [], walls: [], cans: [] };
    fields.set(ctx.physics, field);
    ctx.physics.addPreStepHook(() => animateWalls(ctx, field));
    ctx.physics.addStepHook(() => stepField(ctx, field));
    // Bombs count rounds, not damage: the Nth hit pops one, whatever the gun.
    ctx.events.on('partDamaged', ({ part, x, y }) => {
      const b = field.bombs.find((k) => k.part === part);
      if (!b || part.wrecked) return;
      b.hits++;
      // (Integrity shows how close it is to popping: tint and craters follow it.)
      part.integrity = Math.max(0, 1 - b.hits / b.hitsToPop);
      if (b.hits >= b.hitsToPop) ctx.damage.wreck(part, x, y);
    });
    f = field;
  }
  return f;
}

/** Live bombs on the field (in the air or ticking): what a gunner should shoot. */
export function liveShieldBombs(ctx: { physics: PhysicsWorld }): readonly ShieldBomb[] {
  return fields.get(ctx.physics)?.bombs ?? [];
}

/** x of every wall still standing (bullets stop on them). */
export function standingShieldWalls(ctx: { physics: PhysicsWorld }): number[] {
  const f = fields.get(ctx.physics);
  return f ? f.walls.filter((w) => w.crumbleAt < 0 && !w.part.removed).map((w) => w.px) : [];
}

/** Seconds of fuse a bomb has left (Infinity while it is still in the air). */
export function bombFuseLeft(b: ShieldBomb, now: number): number {
  return b.landedAt < 0 ? Infinity : b.fuse - (now - b.landedAt);
}

function num(spec: AbilitySpec, k: string, d: number): number {
  const v = spec[k];
  return typeof v === 'number' ? v : d;
}

function str(spec: AbilitySpec, k: string): string | null {
  const v = spec[k];
  return typeof v === 'string' ? v : null;
}

// ------------------------------------------------------------------ the field

function stepField(ctx: SimContext, f: BombField): void {
  const now = ctx.physics.simTime;
  for (let i = f.cans.length - 1; i >= 0; i--) {
    const { part, owner } = f.cans[i]!;
    if (part.removed) {
      f.cans.splice(i, 1); // thrown (or faded with its creature)
    } else if (part.wrecked || !owner.owns(part)) {
      // Shot (or knocked) off the pack: it pops on the spot, so the only
      // glowing canister ever lying on the field is a live bomb.
      f.cans.splice(i, 1);
      pop(ctx, part);
    }
  }
  for (let i = f.bombs.length - 1; i >= 0; i--) {
    const b = f.bombs[i]!;
    const p = b.part;
    if (p.removed) {
      f.bombs.splice(i, 1);
      continue;
    }
    if (p.wrecked) {
      f.bombs.splice(i, 1);
      pop(ctx, p);
      continue;
    }
    if (b.landedAt < 0) {
      // Down when its lowest point is at the ground and it isn't rising (or it
      // has been in the air far too long: caught on something).
      const bottom = p.y + p.halfHeightNow;
      if ((bottom > -0.2 && p.vy > -1) || now - b.thrownAt > 5) {
        b.landedAt = now;
        b.nextTick = now + 0.1;
        // A heavy canister thuds into the dirt where it lands: no skidding on
        // toward the line, no tumbling away.
        p.body.setLinvel({ x: p.vx * 0.1, y: Math.min(3, Math.max(0, p.vy)) }, true);
        p.body.setAngvel(0, true);
        ctx.events.emit('shieldBomb', { phase: 'landed', part: p, x: p.x, y: p.y + p.halfHeightNow, urgency: 0 });
      }
      continue;
    }
    const left = b.fuse - (now - b.landedAt);
    if (left <= 0) {
      f.bombs.splice(i, 1);
      deploy(ctx, f, b);
      continue;
    }
    if (now >= b.nextTick) {
      const k = left / b.fuse;
      b.nextTick = now + TICK_MIN + TICK_SPAN * k;
      // The light sits on the canister's lid, wherever it points.
      const r = b.h * 0.5;
      ctx.events.emit('shieldBomb', { phase: 'tick', part: p, x: p.x + r * Math.sin(p.angle), y: p.y - r * Math.cos(p.angle), urgency: 1 - k });
    }
  }
  for (let i = f.walls.length - 1; i >= 0; i--) {
    const w = f.walls[i]!;
    const p = w.part;
    if (p.removed) {
      f.walls.splice(i, 1);
      continue;
    }
    if (w.crumbleAt >= 0) continue;
    const shotDown = p.wrecked;
    if (shotDown || now - w.bornAt > w.spec.life) crumble(ctx, w, shotDown);
  }
}

/** A canister bursts harmlessly (a bomb shot apart before its fuse ran out, or one knocked off a pack): a hop, a flash, gone. */
function pop(ctx: SimContext, p: StructurePart): void {
  p.collider.setCollisionGroups(SPENT_GROUPS);
  // A little hop as it bursts, then gone.
  p.body.applyImpulse({ x: (ctx.rng.next() - 0.5) * p.mass * 2, y: -p.mass * 3 }, true);
  p.body.applyTorqueImpulse((ctx.rng.next() - 0.5) * p.mass * 4, true);
  ctx.debris.fade(p, 0.35);
  ctx.events.emit('shieldBomb', { phase: 'defused', part: p, x: p.x, y: p.y, urgency: 0 });
}

/** The fuse ran out: the canister springs up into a wall where it lies. */
function deploy(ctx: SimContext, f: BombField, b: ShieldBomb): void {
  const x = b.part.x;
  ctx.physics.removeEntity(b.part);
  const s = b.wall;
  const part = spawnPart(
    ctx.physics,
    { id: 'shieldWall', shape: { kind: 'box', w: s.w, h: s.h }, x: 0, y: 0, material: 'armor', tags: ['shieldWall'], hpScale: s.hp },
    // Lying flat on the ground (pointing away from the turret), foot at x.
    wallPose(x, s.h, Math.PI / 2),
  );
  part.body.setBodyType(R().RigidBodyType.KinematicPositionBased, true);
  part.collider.setCollisionGroups(WALL_GROUPS);
  f.walls.push({ part, owner: b.owner, spec: s, bornAt: ctx.physics.simTime, px: x, crumbleAt: -1 });
  ctx.events.emit('shieldBomb', { phase: 'deployed', part, x, y: 0, urgency: 1 });
}

/** Its time is up (or it was shot down): it keels over and fades, letting rounds through. */
function crumble(ctx: SimContext, w: ShieldWall, shotDown: boolean): void {
  const p = w.part;
  w.crumbleAt = ctx.physics.simTime;
  p.collider.setCollisionGroups(SPENT_GROUPS);
  ctx.debris.fade(p, shotDown ? SHOT_DOWN_TIME : CRUMBLE_TIME);
  ctx.events.emit('shieldBomb', { phase: 'crumbled', part: p, x: p.x, y: p.y, urgency: shotDown ? 1 : 0 });
}

/** Wall centre and angle for a foot at (x, ground) tilted `a` rad (0 = upright, +π/2 = lying toward +x). */
function wallPose(x: number, h: number, a: number): { x: number; y: number; angle: number } {
  const r = h / 2;
  return { x: x + r * Math.sin(a), y: FOOT_DEPTH - r * Math.cos(a), angle: a };
}

/** Swing new walls up (springy, a touch past upright and back), tip crumbling ones over. */
function animateWalls(ctx: SimContext, f: BombField): void {
  if (!f.walls.length) return;
  const now = ctx.physics.simTime;
  for (const w of f.walls) {
    const p = w.part;
    if (p.removed) continue;
    let a: number;
    if (w.crumbleAt >= 0) {
      const u = Math.min(1, (now - w.crumbleAt) / CRUMBLE_TIME);
      a = 0.35 * u * u;
    } else {
      const u = (now - w.bornAt) / RISE_TIME;
      if (u > 1.2) continue;
      a = (Math.PI / 2) * (1 - easeOutBack(Math.min(1, u)));
    }
    const pose = wallPose(w.px, w.spec.h, a);
    p.body.setNextKinematicTranslation({ x: pose.x, y: pose.y });
    p.body.setNextKinematicRotation(pose.angle);
  }
}

function easeOutBack(u: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
}

// ------------------------------------------------------------------ the ability

interface ThrowState {
  timer: number;
  /** Winding up for a throw (a canister is in hand). */
  winding: boolean;
  /** Seconds until the arm returns to its carry pose after a throw. */
  carry: number;
}

const throwState = new WeakMap<Creature, Map<string, ThrowState>>();

/** The next pack canister still on the creature, if it carries a pack at all (null = unlimited). */
function nextAmmo(c: Creature, spec: AbilitySpec): StructurePart | null | undefined {
  const list = str(spec, 'ammo');
  if (!list) return null;
  for (const n of list.split(',')) {
    const p = c.structure.part(n);
    if (p && c.organAttached(p)) return p;
  }
  return undefined;
}

/** Bombs in the air or ticking plus walls standing, thrown by this creature. */
function liveCount(f: BombField, c: Creature): number {
  let n = 0;
  for (const b of f.bombs) if (b.owner === c) n++;
  for (const w of f.walls) if (w.owner === c && w.crumbleAt < 0) n++;
  return n;
}

registerAbility('throwShieldBomb', {
  init(c, spec, ctx) {
    let m = throwState.get(c);
    if (!m) throwState.set(c, (m = new Map()));
    m.set(spec.part, { timer: num(spec, 'delay', 3), winding: false, carry: 0 });
    const arm = typeof spec.muscle === 'string' ? c.muscles.get(spec.muscle) : undefined;
    arm?.setDrive(ctx.physics.world, num(spec, 'carry', 0.5));
    const field = fieldOf(ctx);
    for (const n of (str(spec, 'ammo') ?? '').split(',')) {
      const p = n ? c.structure.part(n) : undefined;
      if (p) field.cans.push({ part: p, owner: c });
    }
  },
  step(c, spec, ctx, dt, organ) {
    const st = throwState.get(c)?.get(spec.part);
    if (!st || c.state === 'spawning' || c.power < 0.2) return;
    const world = ctx.physics.world;
    const arm = typeof spec.muscle === 'string' ? c.muscles.get(spec.muscle) : undefined;
    const armOk = !!arm && !arm.broken;
    const field = fieldOf(ctx);
    st.timer -= dt;
    if (st.carry > 0 && (st.carry -= dt) <= 0 && armOk) arm!.setDrive(world, num(spec, 'carry', 0.5));
    const windupTime = 0.5;
    const ahead = num(spec, 'ahead', 16);
    const minX = num(spec, 'minX', 22);
    if (!st.winding && st.timer <= windupTime) {
      // Throw now? Only with a canister left, room for another wall, and ground to aim at.
      const ammo = nextAmmo(c, spec);
      const room = liveCount(field, c) < num(spec, 'maxLive', 2);
      const ground = c.core.x - minX > ahead * 0.5;
      if (ammo === undefined || !room || !ground) {
        st.timer = windupTime + 1;
        return;
      }
      // Reaching back over the shoulder for a canister.
      st.winding = true;
      if (armOk) arm!.setDrive(world, num(spec, 'windup', -2.3));
    }
    if (st.timer > 0) return;
    st.winding = false;
    st.timer = num(spec, 'interval', 5);
    // The canister leaves the pack as the bomb leaves the hand (one shot off
    // during the wind-up: it takes the next; none left: no throw).
    const ammo = nextAmmo(c, spec);
    if (ammo === undefined) {
      if (armOk) arm!.setDrive(world, num(spec, 'carry', 0.5));
      return;
    }
    if (ammo) {
      ctx.physics.removeEntity(ammo);
      c.markDirty();
    }
    // Thrown from the claw while it has one, else from the bare arm.
    const h = typeof spec.hand === 'string' ? c.structure.part(spec.hand) : undefined;
    const hand = h && c.organAttached(h) ? h : organ;
    const size = num(spec, 'size', 0.95);
    const w = size * 0.7;
    // Lob it from the hand so it comes down `ahead` metres in front (never nearer the turret than minX).
    const T = num(spec, 'flight', 1.5);
    const x0 = hand.x - 0.3;
    const y0 = hand.y - 0.3;
    const tx = Math.min(num(spec, 'maxX', 42), Math.max(minX, c.core.x - ahead * (0.85 + ctx.rng.next() * 0.3)));
    const ty = -size / 2;
    const g = ctx.physics.gravity;
    const vx = (tx - x0) / T;
    const vy = (ty - y0 - 0.5 * g * T * T) / T;
    const part = spawnPart(
      ctx.physics,
      // (Hit points only as a backstop: it pops on its Nth hit, see fieldOf.)
      { id: 'shieldBomb', shape: { kind: 'box', w, h: size }, x: 0, y: 0, material: 'core', tags: ['shieldBomb'], hpScale: 1000, friction: 1.4, restitution: 0.05, densityScale: 0.5 },
      { x: x0, y: y0, angle: (ctx.rng.next() - 0.5) * 0.3, vx, vy, av: (ctx.rng.next() - 0.5) * 0.8 },
    );
    part.collider.setCollisionGroups(BOMB_GROUPS);
    field.bombs.push({
      part,
      owner: c,
      h: size,
      thrownAt: ctx.physics.simTime,
      landedAt: -1,
      fuse: num(spec, 'fuse', 3.5),
      hits: 0,
      hitsToPop: Math.max(1, Math.round(num(spec, 'hits', 4))),
      nextTick: 0,
      wall: { h: num(spec, 'wallH', 9), w: num(spec, 'wallW', 1), life: num(spec, 'wallLife', 14), hp: num(spec, 'wallHp', 0.3) },
    });
    if (armOk) {
      arm!.setDrive(world, num(spec, 'release', 1.3));
      st.carry = 0.7;
    }
    ctx.events.emit('creatureAbility', { creature: c, ability: spec.id, x: x0, y: y0 });
  },
});
