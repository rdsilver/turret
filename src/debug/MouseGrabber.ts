/**
 * Physics-testbed style mouse dragging: grab a dynamic body at a point with a
 * spring joint to a kinematic "hand" body that follows the cursor; release to
 * throw (the body keeps its velocity). OWNER: debug agent.
 *
 *  - The hand is a kinematic, collider-less Rapier body created on grab and
 *    removed on release (it never collides or shows up as an entity).
 *  - The joint is a zero-rest-length Rapier spring from the grab point (in the
 *    body's local space) to the hand: stiffness = mass * 400 (≈3 Hz), damping
 *    ≈ 0.9 critical, force capped so a grabbed column can still tear its welds
 *    without launching the structure into orbit.
 *  - A permanent pre-step hook moves the hand toward the cursor with
 *    setNextKinematicTranslation (speed-limited, so fast flicks throw instead
 *    of teleporting) and keeps the body awake; it is a no-op when idle.
 *  - Angular damping is raised while held (no helicopter spin) and restored on
 *    release. If the held entity disappears (shatter, debris cleanup, level
 *    reload) the grab ends automatically.
 */
import type { Simulation } from '../sim/Simulation';
import type { Entity } from '../sim/Entity';
import { R, type RapierNS } from '../sim/RapierModule';

/** Spring stiffness per kg (N/m/kg): omega = sqrt(400) = 20 rad/s. */
const STIFFNESS_PER_KG = 400;
const DAMPING_RATIO = 0.9;
/** Max spring force per kg (m/s^2): ~40 g. */
const MAX_ACCEL = 400;
/** Max hand speed (m/s). */
const HAND_SPEED = 70;
const HELD_ANGULAR_DAMPING = 2.5;

export class MouseGrabber {
  active = false;
  /** Grabbed entity (null when idle). */
  entity: Entity | null = null;
  /** Cursor target (sim meters). */
  targetX = 0;
  targetY = 0;
  /** Grab point in the body's local frame. */
  localX = 0;
  localY = 0;

  private hand: RapierNS.RigidBody | null = null;
  private joint: RapierNS.ImpulseJoint | null = null;
  private handX = 0;
  private handY = 0;
  private savedAngularDamping = 0;
  private readonly next = { x: 0, y: 0 };
  private readonly offs: Array<() => void> = [];
  private destroyed = false;

  constructor(readonly sim: Simulation) {
    this.offs.push(
      sim.physics.addPreStepHook((dt) => this.preStep(dt)),
      sim.events.on('entityRemoved', (e) => {
        if (e.entity === this.entity) this.release();
      }),
    );
  }

  /** Try to grab whatever dynamic entity is under (x, y) sim meters. */
  grab(x: number, y: number): boolean {
    if (this.destroyed) return false;
    this.release();
    const e = this.sim.physics.entityAt(x, y);
    if (!e || e.removed) return false;
    const body = e.body;
    if (!body.isDynamic() || !body.isEnabled()) return false;
    const RAP = R();
    const world = this.sim.physics.world;

    // Grab point in the body's local frame (use the live transform, not the cache).
    const t = body.translation();
    const a = body.rotation();
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dx = x - t.x;
    const dy = y - t.y;
    this.localX = c * dx + s * dy;
    this.localY = -s * dx + c * dy;

    const hand = world.createRigidBody(RAP.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y));
    const mass = Math.max(0.1, body.mass() || e.mass);
    const k = mass * STIFFNESS_PER_KG;
    const damping = 2 * DAMPING_RATIO * Math.sqrt(k * mass);
    const joint = world.createImpulseJoint(RAP.JointData.spring(0, k, damping, { x: this.localX, y: this.localY }, { x: 0, y: 0 }), body, hand, true);
    // Same raw motor API the structural joints use: cap the spring force.
    world.impulseJoints.raw.jointSetMotorMaxForce(joint.handle, RAP.JointAxis.LinX as number, mass * MAX_ACCEL);
    joint.setContactsEnabled(false);

    this.savedAngularDamping = body.angularDamping();
    body.setAngularDamping(Math.max(this.savedAngularDamping, HELD_ANGULAR_DAMPING));
    body.wakeUp();

    this.hand = hand;
    this.joint = joint;
    this.entity = e;
    this.handX = this.targetX = x;
    this.handY = this.targetY = y;
    this.active = true;
    return true;
  }

  move(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  release(): void {
    if (!this.active) return;
    const world = this.sim.physics.world;
    const e = this.entity;
    if (this.joint) {
      // The joint is already gone if Rapier removed the body it was attached to.
      if (world.getImpulseJoint(this.joint.handle)) world.removeImpulseJoint(this.joint, true);
      this.joint = null;
    }
    if (this.hand) {
      world.removeRigidBody(this.hand);
      this.hand = null;
    }
    // Restore damping even on retired (pooled) bodies; skip bodies Rapier already freed.
    if (e && e.body.isValid()) {
      e.body.setAngularDamping(this.savedAngularDamping);
      if (!e.removed) e.body.wakeUp(); // keep its velocity: that's the throw
    }
    this.entity = null;
    this.active = false;
  }

  /** World position of the grab point on the held body (from the cached transform). */
  anchorWorld(out: { x: number; y: number }): { x: number; y: number } {
    const e = this.entity;
    if (!e) {
      out.x = this.targetX;
      out.y = this.targetY;
      return out;
    }
    const c = Math.cos(e.angle);
    const s = Math.sin(e.angle);
    out.x = e.x + c * this.localX - s * this.localY;
    out.y = e.y + s * this.localX + c * this.localY;
    return out;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.release();
    this.destroyed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  private preStep(dt: number): void {
    if (!this.active || !this.hand) return;
    const e = this.entity;
    if (!e || e.removed || !e.body.isEnabled()) {
      // Safe inside the hook loop: release() only touches Rapier objects; the
      // hook itself stays registered for the next grab.
      this.release();
      return;
    }
    // Speed-limited follow: quick flicks accelerate the body instead of teleporting the anchor.
    const dx = this.targetX - this.handX;
    const dy = this.targetY - this.handY;
    const d = Math.hypot(dx, dy);
    const maxStep = HAND_SPEED * dt;
    if (d > maxStep) {
      this.handX += (dx / d) * maxStep;
      this.handY += (dy / d) * maxStep;
    } else {
      this.handX = this.targetX;
      this.handY = this.targetY;
    }
    this.next.x = this.handX;
    this.next.y = this.handY;
    this.hand.setNextKinematicTranslation(this.next);
    e.body.wakeUp();
  }
}
