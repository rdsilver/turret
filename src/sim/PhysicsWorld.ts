/**
 * PhysicsWorld: owns the Rapier world and runs it at a fixed timestep.
 *
 * Responsibilities
 *  - fixed 60 Hz stepping with an accumulator, time scale (slow-mo / hit-stop),
 *    pause and single-step;
 *  - the entity registry (body handle -> Entity, collider handle -> Entity);
 *  - the per-step "active pass": only bodies Rapier reports as awake are
 *    touched (transform cache, impact detection, structure metrics, joint
 *    load evaluation) so sleeping structures cost nothing;
 *  - breaking joints and removing entities, publishing SimEvents.
 *
 * Knows nothing about Phaser, levels or scoring.
 */
import { R, type RapierNS } from './RapierModule';
import { EventBus } from '../core/EventBus';
import type { SimEvents } from './SimEvents';
import { Entity } from './Entity';
import { StructurePart } from './StructurePart';
import { BreakableJoint, type BreakCause, type JointSpec } from './BreakableJoint';
import {
  ARENA,
  DEFAULT_GRAVITY,
  GROUP,
  INTERNAL_PGS_ITERATIONS,
  MAX_STEPS_PER_FRAME,
  PHYSICS_DT,
  SOLVER_ITERATIONS,
  interactionGroups,
} from '../config/constants';

export type StepHook = (dt: number) => void;
export type CollisionHandler = (a: Entity | null, b: Entity | null, colliderA: number, colliderB: number, started: boolean) => void;

export interface PhysicsStats {
  /** Smoothed wall time of world.step (ms). */
  stepMs: number;
  /** Smoothed wall time of our post-step processing (ms). */
  postMs: number;
  /** Worst step time over the last second (ms). */
  stepMsMax: number;
  bodies: number;
  dynamicBodies: number;
  active: number;
  sleeping: number;
  joints: number;
  colliders: number;
  stepsLastFrame: number;
}

/** Candidate impact collected during the active pass (preallocated). */
interface ImpactCandidate {
  e: Entity | null;
  dv: number;
  energy: number;
}

const IMPACT_MIN_DV = 1.6;
const IMPACT_MIN_ENERGY = 250;
const IMPACT_COOLDOWN_STEPS = 6;
const MAX_IMPACTS_PER_STEP = 10;
/** Loose debris sleeps after this many quiet steps (Rapier's own timer is ~2s). */
const DEBRIS_QUIET_STEPS = 40;
const QUIET_LIN2 = 0.04 * 0.04;
const QUIET_ANG = 0.06;

export class PhysicsWorld {
  readonly world: RapierNS.World;
  readonly eventQueue: RapierNS.EventQueue;
  readonly events: EventBus<SimEvents>;
  readonly ground: RapierNS.RigidBody;
  readonly groundCollider: RapierNS.Collider;

  readonly entities = new Map<number, Entity>();
  readonly colliderOwner = new Map<number, Entity>();
  readonly joints = new Set<BreakableJoint>();
  /** Entities awake after the last step (reused array). */
  readonly active: Entity[] = [];
  /** Entities that experienced a hard velocity change this step (for fracture / detonation). */
  readonly hardImpacts: { entity: Entity; dv: number }[] = [];
  private hardImpactCount = 0;

  stepIndex = 0;
  simTime = 0;
  timeScale = 1;
  paused = false;
  private pendingSteps = 0;
  accumulator = 0;
  /** Render interpolation factor in [0,1]. */
  alpha = 1;
  gravity: number;
  /** Extra bodies we count as dynamic but that are not entities (grab handle...). */
  auxDynamicBodies = 0;

  readonly stats: PhysicsStats = {
    stepMs: 0,
    postMs: 0,
    stepMsMax: 0,
    bodies: 0,
    dynamicBodies: 0,
    active: 0,
    sleeping: 0,
    joints: 0,
    colliders: 0,
    stepsLastFrame: 0,
  };
  private maxWindow = 0;
  private maxWindowTimer = 0;

  private preHooks: StepHook[] = [];
  private postHooks: StepHook[] = [];
  private collisionHandlers: CollisionHandler[] = [];
  private breakQueue: BreakableJoint[] = [];
  private breakCauses: BreakCause[] = [];
  private impacts: ImpactCandidate[] = [];
  private impactCount = 0;
  private readonly scratch = { x: 0, y: 0 };
  private readonly scratchV = { x: 0, y: 0 };
  private readonly onCollisionEvent: (h1: number, h2: number, started: boolean) => void;
  private destroyed = false;

  constructor(events: EventBus<SimEvents>, gravity = DEFAULT_GRAVITY) {
    const RAP = R();
    this.events = events;
    this.gravity = gravity;
    this.world = new RAP.World({ x: 0, y: gravity });
    this.world.timestep = PHYSICS_DT;
    this.world.numSolverIterations = SOLVER_ITERATIONS;
    this.world.integrationParameters.numInternalPgsIterations = INTERNAL_PGS_ITERATIONS;
    this.eventQueue = new RAP.EventQueue(true);

    const width = ARENA.right - ARENA.left + 200;
    this.ground = this.world.createRigidBody(RAP.RigidBodyDesc.fixed().setTranslation((ARENA.left + ARENA.right) / 2, 0));
    this.groundCollider = this.world.createCollider(
      RAP.ColliderDesc.cuboid(width / 2, 10)
        .setTranslation(0, 10)
        .setFriction(0.9)
        .setRestitution(0.02)
        .setCollisionGroups(interactionGroups(GROUP.GROUND, 0xffff)),
      this.ground,
    );

    for (let i = 0; i < MAX_IMPACTS_PER_STEP; i++) this.impacts.push({ e: null, dv: 0, energy: 0 });
    for (let i = 0; i < 32; i++) this.hardImpacts.push({ entity: null as unknown as Entity, dv: 0 });

    this.onCollisionEvent = (h1, h2, started) => {
      const a = this.colliderOwner.get(h1) ?? null;
      const b = this.colliderOwner.get(h2) ?? null;
      for (let i = 0; i < this.collisionHandlers.length; i++) this.collisionHandlers[i]!(a, b, h1, h2, started);
    };
  }

  // ------------------------------------------------------------------ hooks

  addPreStepHook(fn: StepHook): () => void {
    this.preHooks.push(fn);
    return () => removeFrom(this.preHooks, fn);
  }

  addStepHook(fn: StepHook): () => void {
    this.postHooks.push(fn);
    return () => removeFrom(this.postHooks, fn);
  }

  addCollisionHandler(fn: CollisionHandler): () => void {
    this.collisionHandlers.push(fn);
    return () => removeFrom(this.collisionHandlers, fn);
  }

  // --------------------------------------------------------------- stepping

  /** Advance by real elapsed seconds; returns the number of fixed steps executed. */
  update(realDt: number): number {
    let steps = 0;
    if (this.paused) {
      while (this.pendingSteps > 0) {
        this.pendingSteps--;
        this.step();
        steps++;
      }
      this.alpha = 1;
    } else {
      this.accumulator += Math.min(realDt, 0.1) * this.timeScale;
      while (this.accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
        this.step();
        this.accumulator -= PHYSICS_DT;
        steps++;
      }
      if (steps >= MAX_STEPS_PER_FRAME && this.accumulator > PHYSICS_DT) this.accumulator = PHYSICS_DT * 0.5;
      this.alpha = Math.min(1, this.accumulator / PHYSICS_DT);
    }
    this.stats.stepsLastFrame = steps;
    this.maxWindowTimer += realDt;
    if (this.maxWindowTimer >= 1) {
      this.stats.stepMsMax = this.maxWindow;
      this.maxWindow = 0;
      this.maxWindowTimer = 0;
    }
    return steps;
  }

  /** Queue single steps while paused (debug "advance one frame"). */
  requestStep(n = 1): void {
    this.pendingSteps += n;
  }

  /** Run exactly one fixed step plus all post-step processing. */
  step(): void {
    if (this.destroyed) return;
    for (let i = 0; i < this.preHooks.length; i++) this.preHooks[i]!(PHYSICS_DT);

    const t0 = now();
    this.world.step(this.eventQueue);
    const t1 = now();

    this.stepIndex++;
    this.simTime += PHYSICS_DT;
    this.activePass();
    this.evaluateJoints();
    this.eventQueue.drainCollisionEvents(this.onCollisionEvent);
    this.eventQueue.drainContactForceEvents(noop);
    this.emitImpacts();
    for (let i = 0; i < this.postHooks.length; i++) this.postHooks[i]!(PHYSICS_DT);
    const t2 = now();

    const stepMs = t1 - t0;
    this.stats.stepMs += (stepMs - this.stats.stepMs) * 0.1;
    this.stats.postMs += (t2 - t1 - this.stats.postMs) * 0.1;
    if (stepMs > this.maxWindow) this.maxWindow = stepMs;
    this.stats.bodies = this.world.bodies.len();
    this.stats.colliders = this.world.colliders.len();
    this.stats.dynamicBodies = this.entities.size + this.auxDynamicBodies;
    this.stats.joints = this.joints.size;
    this.stats.sleeping = Math.max(0, this.stats.dynamicBodies - this.stats.active);
  }

  /** Iterate awake bodies only: cache transforms, detect impacts, update metrics. */
  private activePass(): void {
    const active = this.active;
    active.length = 0;
    this.impactCount = 0;
    this.hardImpactCount = 0;
    for (let i = 0; i < this.impacts.length; i++) this.impacts[i]!.e = null;
    this.passActiveCount = 0;
    this.passGdt = this.gravity * PHYSICS_DT;

    this.fallenBuf.length = 0;
    this.world.forEachActiveRigidBody(this.activeVisitor);

    this.stats.active = this.passActiveCount;
    for (let i = 0; i < this.fallenBuf.length; i++) this.events.emit('partFallen', { part: this.fallenBuf[i]! });
    // Remove escaped entities (outside of the Rapier iteration).
    for (let i = active.length - 1; i >= 0; i--) {
      const e = active[i]!;
      if (e.fading === -1) {
        e.fading = 0;
        if (e instanceof StructurePart && e.structure && !e.isFragment) e.structure.onPartDestroyed(e);
        this.removeEntity(e);
        active.splice(i, 1);
      }
    }
  }


  private passActiveCount = 0;
  private readonly fallenBuf: StructurePart[] = [];
  private passGdt = 0;
  private readonly activeVisitor = (body: RapierNS.RigidBody): void => {
    this.passActiveCount++;
    const e = this.entities.get(body.handle);
    if (!e || e.removed) return;
    e.activeStamp = this.stepIndex;
    this.active.push(e);
    const prevH = -e.y;
    e.px = e.x;
    e.py = e.y;
    e.pangle = e.angle;
    body.translation(this.scratch);
    e.x = this.scratch.x;
    e.y = this.scratch.y;
    e.angle = body.rotation();
    const pvx = e.vx;
    const pvy = e.vy;
    body.linvel(this.scratchV);
    e.vx = this.scratchV.x;
    e.vy = this.scratchV.y;
    e.av = body.angvel();

    // Impact detection: velocity change not explained by gravity.
    const dvx = e.vx - pvx;
    const dvy = e.vy - pvy - this.passGdt;
    const dv2 = dvx * dvx + dvy * dvy;
    if (dv2 > IMPACT_MIN_DV * IMPACT_MIN_DV) {
      const dv = Math.sqrt(dv2);
      if (e instanceof StructurePart && (e.material.shatter || e.material.explosive)) this.noteHardImpact(e, dv);
      if (this.stepIndex - e.lastImpactStep > IMPACT_COOLDOWN_STEPS) {
        const energy = 0.5 * e.mass * dv2;
        if (energy > IMPACT_MIN_ENERGY) this.considerImpact(e, dv, energy);
      }
    }

    if (e instanceof StructurePart) {
      // Out of the arena -> delete silently.
      if (e.y > ARENA.killY || e.x < ARENA.left - 20 || e.x > ARENA.right + 20 || e.y < ARENA.ceilingY) {
        e.fading = -1; // flag for removal after the pass
      }
      // Emitted after the Rapier iteration (listeners may mutate the world).
      if (e.structure && !e.isFragment && e.structure.onPartMoved(e, prevH)) this.fallenBuf.push(e);
      // Aggressive sleeping for loose rubble.
      if (e.joints.length === 0) this.quietCheck(e, body);
    } else {
      if (e.y > ARENA.killY || e.x < ARENA.left - 20 || e.x > ARENA.right + 20) e.fading = -1;
      this.quietCheck(e, body);
    }
  
  };

  private quietSteps = new Map<number, number>();
  private quietCheck(e: Entity, body: RapierNS.RigidBody): void {
    const lin2 = e.vx * e.vx + e.vy * e.vy;
    if (lin2 < QUIET_LIN2 && Math.abs(e.av) < QUIET_ANG) {
      const n = (this.quietSteps.get(e.id) ?? 0) + 1;
      if (n >= DEBRIS_QUIET_STEPS) {
        body.sleep();
        this.quietSteps.delete(e.id);
      } else this.quietSteps.set(e.id, n);
    } else if (this.quietSteps.size && this.quietSteps.has(e.id)) {
      this.quietSteps.delete(e.id);
    }
  }

  private noteHardImpact(e: Entity, dv: number): void {
    if (this.hardImpactCount >= this.hardImpacts.length) this.hardImpacts.push({ entity: e, dv: 0 });
    const slot = this.hardImpacts[this.hardImpactCount++]!;
    slot.entity = e;
    slot.dv = dv;
  }

  /** Number of valid entries in `hardImpacts` for the current step. */
  get hardImpactsThisStep(): number {
    return this.hardImpactCount;
  }

  private considerImpact(e: Entity, dv: number, energy: number): void {
    const list = this.impacts;
    // Keep the top-N by energy in a fixed array.
    let slot = -1;
    if (this.impactCount < list.length) slot = this.impactCount++;
    else {
      let minE = energy;
      for (let i = 0; i < list.length; i++) {
        if (list[i]!.energy < minE) {
          minE = list[i]!.energy;
          slot = i;
        }
      }
    }
    if (slot < 0) return;
    const c = list[slot]!;
    c.e = e;
    c.dv = dv;
    c.energy = energy;
  }

  private emitImpacts(): void {
    if (this.impactCount === 0 || !this.events.hasListeners('impact')) return;
    for (let i = 0; i < this.impactCount; i++) {
      const c = this.impacts[i]!;
      const e = c.e;
      if (!e || e.removed) continue;
      e.lastImpactStep = this.stepIndex;
      let other: Entity | null = null;
      let hitGround = false;
      let cx = e.x;
      let cy = e.y;
      let best = -1;
      const col = e.collider;
      this.world.contactPairsWith(col, (oc) => {
        this.world.contactPair(col, oc, (manifold) => {
          const n = manifold.numSolverContacts();
          if (n === 0) return;
          let imp = 0;
          for (let k = 0; k < manifold.numContacts(); k++) imp += manifold.contactImpulse(k);
          if (imp > best) {
            best = imp;
            const p = manifold.solverContactPoint(0);
            if (p) {
              cx = p.x;
              cy = p.y;
            }
            hitGround = oc.handle === this.groundCollider.handle;
            other = hitGround ? null : (this.colliderOwner.get(oc.handle) ?? null);
          }
        });
      });
      const material = e instanceof StructurePart ? e.material.id : 'iron';
      this.events.emit('impact', { entity: e, other, hitGround, x: cx, y: cy, dv: c.dv, energy: c.energy, mass: e.mass, material });
    }
  }

  /** Evaluate joints attached to awake parts once each; break the failed ones. */
  private evaluateJoints(): void {
    const step = this.stepIndex;
    const active = this.active;
    this.breakQueue.length = 0;
    this.breakCauses.length = 0;
    for (let i = 0; i < active.length; i++) {
      const e = active[i]!;
      if (!(e instanceof StructurePart)) continue;
      const joints = e.joints;
      for (let k = 0; k < joints.length; k++) {
        const j = joints[k]!;
        if (j.evalStamp === step) continue;
        j.evalStamp = step;
        if (j.evaluate(this.world)) {
          this.breakQueue.push(j);
          this.breakCauses.push(j.kind === 'weld' && Math.abs(j.plastic) >= j.bendLimit ? 'bend' : 'tension');
        } else if (j.yielding) {
          this.maybeCreak(j);
        }
      }
    }
    for (let i = 0; i < this.breakQueue.length; i++) this.breakJoint(this.breakQueue[i]!, this.breakCauses[i]!);
  }

  private maybeCreak(j: BreakableJoint): void {
    if (this.simTime - j.lastCreak < 0.22) return;
    // Only report real progress toward failure (a creak should foreshadow a snap).
    const progressed = j.damage - j.lastCreakDamage;
    if (progressed < 0.03 || j.damage < 0.05) return;
    j.lastCreak = this.simTime;
    j.lastCreakDamage = j.damage;
    this.events.emit('jointStressed', {
      joint: j,
      x: j.wx,
      y: j.wy,
      damage: Math.min(1, j.damage),
      rate: Math.min(1, progressed * 4),
      material: j.bondMaterial,
    });
  }

  /** Evaluate every joint once (e.g. right after building, to seed stress values). */
  evaluateAllJoints(): void {
    for (const j of this.joints) j.evaluate(this.world);
  }

  // -------------------------------------------------------------- entities

  /** Register a body+collider that belongs to `e`. */
  register(e: Entity, body: RapierNS.RigidBody, collider: RapierNS.Collider): void {
    e.body = body;
    e.collider = collider;
    e.handle = body.handle;
    e.mass = body.mass() || collider.mass();
    this.entities.set(body.handle, e);
    this.colliderOwner.set(collider.handle, e);
    e.syncFromBody();
    this.events.emit('entityAdded', { entity: e });
  }

  removeEntity(e: Entity): void {
    if (e.removed) return;
    if (e instanceof StructurePart) {
      for (let i = e.joints.length - 1; i >= 0; i--) {
        const j = e.joints[i];
        if (j) this.breakJoint(j, 'removed');
      }
    }
    this.entities.delete(e.handle);
    this.colliderOwner.delete(e.collider.handle);
    this.quietSteps.delete(e.id);
    this.world.removeRigidBody(e.body);
    e.removed = true;
    this.events.emit('entityRemoved', { entity: e });
  }

  /** Unregister an entity but keep its (disabled) body for pooling. */
  retire(e: Entity): void {
    if (e.removed) return;
    this.entities.delete(e.handle);
    this.colliderOwner.delete(e.collider.handle);
    this.quietSteps.delete(e.id);
    e.body.setEnabled(false);
    e.removed = true;
    this.events.emit('entityRemoved', { entity: e });
  }

  /** Re-register a retired (pooled) entity. Caller positions the body first. */
  revive(e: Entity): void {
    e.body.setEnabled(true);
    e.body.wakeUp();
    e.removed = false;
    // body.mass() is stale (0) until the next world.step for re-enabled bodies.
    e.mass = e.collider.mass();
    this.entities.set(e.handle, e);
    this.colliderOwner.set(e.collider.handle, e);
    e.syncFromBody();
    this.events.emit('entityAdded', { entity: e });
  }

  /** Permanently free a retired body (pool trimming / teardown). */
  freeRetired(e: Entity): void {
    if (!e.removed) return;
    this.world.removeRigidBody(e.body);
  }

  createJoint(spec: JointSpec): BreakableJoint {
    const j = new BreakableJoint(spec);
    j.attach(this.world, this.ground);
    this.joints.add(j);
    spec.a.joints.push(j);
    if (spec.b) spec.b.joints.push(j);
    return j;
  }

  breakJoint(j: BreakableJoint, cause: BreakCause): void {
    if (j.broken) return;
    j.broken = true;
    j.brokenCause = cause;
    j.detach(this.world);
    this.joints.delete(j);
    removeFrom(j.a.joints, j);
    if (j.b) removeFrom(j.b.joints, j);
    j.a.wear = Math.max(j.a.wear, Math.min(1, j.damage));
    if (j.b) j.b.wear = Math.max(j.b.wear, Math.min(1, j.damage));
    const s = j.a.structure;
    if (cause !== 'removed') {
      if (s) s.jointsBroken++;
      this.events.emit('jointBroken', {
        joint: j,
        cause,
        x: j.wx,
        y: j.wy,
        stress: j.stress,
        rating: j.yieldForce,
        materialA: j.a.material.id,
        materialB: j.b ? j.b.material.id : 'ground',
      });
    }
    this.checkDetached(j.a);
    if (j.b) this.checkDetached(j.b);
  }

  private checkDetached(p: StructurePart): void {
    if (p.joints.length === 0 && p.detachedAt < 0 && !p.removed) {
      p.detachedAt = this.simTime;
      this.events.emit('partDetached', { part: p });
    }
  }

  // ---------------------------------------------------------------- queries

  /** Topmost dynamic entity whose collider contains the point. */
  entityAt(x: number, y: number, includeFixed = false): Entity | null {
    let found: Entity | null = null;
    this.world.intersectionsWithPoint({ x, y }, (c) => {
      const e = this.colliderOwner.get(c.handle);
      if (e && (includeFixed || !(e instanceof StructurePart && e.fixed))) {
        found = e;
        return false;
      }
      return true;
    });
    return found;
  }

  setGravity(g: number): void {
    this.gravity = g;
    this.world.gravity = { x: 0, y: g };
    // Wake everything so the change is visible immediately.
    for (const e of this.entities.values()) e.body.wakeUp();
  }

  /** Add a static box to the ground body (environment props, turret base). */
  addStaticBox(cx: number, cy: number, hw: number, hh: number, angle = 0): RapierNS.Collider {
    const RAP = R();
    const gx = this.ground.translation().x;
    return this.world.createCollider(
      RAP.ColliderDesc.cuboid(hw, hh)
        .setTranslation(cx - gx, cy)
        .setRotation(angle)
        .setFriction(0.8)
        .setCollisionGroups(interactionGroups(GROUP.GROUND, 0xffff)),
      this.ground,
    );
  }

  wakeAll(): void {
    for (const e of this.entities.values()) e.body.wakeUp();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.preHooks.length = 0;
    this.postHooks.length = 0;
    this.collisionHandlers.length = 0;
    this.entities.clear();
    this.colliderOwner.clear();
    this.joints.clear();
    this.eventQueue.free();
    this.world.free();
  }
}

function removeFrom<T>(arr: T[], item: T): void {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
}

function noop(): void {}

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now();
