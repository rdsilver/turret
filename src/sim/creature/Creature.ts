/**
 * Creature controller: turns a built Structure into something that walks at
 * the turret.
 *
 * Locomotion is physical with assistance:
 *  - leg muscles follow a gait cycle whose phase advances with distance
 *    walked, so planted feet don't skate;
 *  - a balance assist (a gyroscope-like torque on the body) keeps it upright,
 *    but only while it has legs under it and power;
 *  - propulsion is a horizontal push on the body, scaled by working legs,
 *    power and whether any working foot touches the ground.
 * Everything else — support, stumbling, buckling knees, severed limbs,
 * falling over — is the physics. Shoot a knee and the gait breaks for real.
 */
import type { SimContext } from '../SimContext';
import type { Structure } from '../Structure';
import type { StructurePart } from '../StructurePart';
import type { BreakableJoint } from '../BreakableJoint';
import type { CreatureSpec, LegSpec, MuscleGait } from './CreatureTypes';
import { DEG, clamp, wrapAngle } from '../../core/math';

export type CreatureState = 'spawning' | 'walking' | 'crippled' | 'immobilized' | 'neutralized';
export type NeutralizeCause = 'legs' | 'downed' | 'power' | 'killed' | 'stuck';

interface LegRuntime {
  spec: LegSpec;
  joints: BreakableJoint[];
  parts: StructurePart[];
  foot: StructurePart;
  functional: boolean;
  /** Gait term that marks the swing phase (the leg's 'swing'-shaped muscle), if any. */
  swingGait: MuscleGait | null;
  /** In swing phase this step (foot lifting / moving forward). */
  swinging: boolean;
}

/** Seconds a creature must stay immobile before it counts as stopped for good. */
const NEUTRALIZE_AFTER = 1.8;
const STUCK_WINDOW = 7;
const STUCK_DISTANCE = 0.35;
const SPAWN_SETTLE = 0.7;
/** Joint strength below which a leg joint no longer carries its leg. */
const LEG_FAIL_SCALE = 0.32;

let nextCreatureId = 1;

export class Creature {
  readonly id = nextCreatureId++;
  readonly spec: CreatureSpec;
  readonly structure: Structure;
  readonly core: StructurePart;
  readonly muscles = new Map<string, BreakableJoint>();
  readonly legs: LegRuntime[] = [];
  readonly vitals: StructurePart[] = [];
  readonly engines: StructurePart[] = [];
  private readonly gait: { joint: BreakableJoint; g: MuscleGait }[] = [];

  state: CreatureState = 'spawning';
  cause: NeutralizeCause | null = null;
  /** Gait phase in cycles. */
  phase = 0;
  /** 0..1 power from engines / heart. */
  power = 1;
  /** 0..1 locomotion capacity from working legs. */
  capacity = 1;
  functionalLegs = 0;
  grounded = false;
  overheated = false;
  age = 0;
  mass = 0;
  /** Mass the legs carry (everything that isn't leg). */
  upperMass = 0;
  /** Spawn height of the body center (m). */
  readonly bodyHeight0: number;
  /** Seconds continuously immobile. */
  private immobileTime = 0;
  private downedTime = 0;
  private stuckRefX = 0;
  private stuckTimer = 0;
  private legsDirty = true;
  /** Parts still connected to the core through intact joints (abilities need their organ attached). */
  private connected = new Set<StructurePart>();
  private connectedDirty = true;
  /** Hip anchor on the body (local, sim space): propulsion is applied here. */
  private hipLocal = { x: 0, y: 0 };
  /** Strongest hip muscle torque (caps the body-trim torque). */
  private hipTorque = 0;

  constructor(
    private readonly ctx: SimContext,
    structure: Structure,
    spec: CreatureSpec,
  ) {
    this.structure = structure;
    this.spec = spec;
    const core = structure.part(spec.core);
    if (!core) throw new Error(`Creature ${spec.name}: core part "${spec.core}" missing`);
    this.core = core;
    for (const j of structure.joints) if (j.name) this.muscles.set(j.name, j);
    for (const [name, g] of Object.entries(spec.gait.muscles)) {
      const j = this.muscles.get(name);
      if (j && j.isMuscle) this.gait.push({ joint: j, g });
    }
    for (const leg of spec.legs) {
      const foot = structure.part(leg.foot);
      if (!foot) throw new Error(`Creature ${spec.name}: foot "${leg.foot}" missing`);
      this.legs.push({
        spec: leg,
        joints: leg.joints.map((n) => this.muscles.get(n)).filter((j): j is BreakableJoint => !!j),
        parts: leg.parts.map((n) => structure.part(n)).filter((p): p is StructurePart => !!p),
        foot,
        functional: true,
        swingGait: leg.joints.map((n) => spec.gait.muscles[n]).find((g) => g?.shape === 'swing') ?? null,
        swinging: false,
      });
    }
    for (const id of spec.vitals ?? [spec.core]) {
      const p = structure.part(id);
      if (p) this.vitals.push(p);
    }
    for (const id of spec.engines ?? []) {
      const p = structure.part(id);
      if (p) this.engines.push(p);
    }
    for (const p of structure.parts) this.mass += p.mass;
    const legParts = new Set<StructurePart>();
    for (const leg of this.legs) for (const p of leg.parts) legParts.add(p);
    this.upperMass = 0;
    for (const p of structure.parts) if (!legParts.has(p)) this.upperMass += p.mass;
    const hip = this.legs[0]?.joints[0];
    if (hip) {
      // The leg's first joint connects the leg (a) to the body (b); lbx/lby are body-local.
      this.hipLocal = hip.b === core ? { x: hip.lbx, y: hip.lby } : { x: hip.lax, y: hip.lay };
    }
    for (const leg of this.legs) for (const j of leg.joints.slice(0, 1)) this.hipTorque = Math.max(this.hipTorque, j.muscle?.torque ?? 0);
    this.bodyHeight0 = core.h0;
    this.stuckRefX = core.x;
  }

  get x(): number {
    return this.core.x;
  }

  get active(): boolean {
    return this.state !== 'neutralized';
  }

  /** A joint of this creature broke (called by the manager). */
  onJointBroken(): void {
    this.legsDirty = true;
    this.connectedDirty = true;
  }

  markDirty(): void {
    this.legsDirty = true;
    this.connectedDirty = true;
  }

  /** Is this organ still attached to the body (and not wrecked)? */
  organAttached(p: StructurePart): boolean {
    if (p.removed || p.wrecked) return false;
    if (this.connectedDirty) this.recomputeConnected();
    return this.connected.has(p);
  }

  private recomputeConnected(): void {
    this.connectedDirty = false;
    const seen = this.connected;
    seen.clear();
    if (this.core.removed) return;
    const stack: StructurePart[] = [this.core];
    seen.add(this.core);
    while (stack.length) {
      const p = stack.pop()!;
      for (const j of p.joints) {
        if (j.broken) continue;
        const o = j.other(p);
        if (o && !seen.has(o)) {
          seen.add(o);
          stack.push(o);
        }
      }
    }
  }

  private recomputeLegs(): void {
    this.legsDirty = false;
    let n = 0;
    for (const leg of this.legs) {
      let ok = leg.joints.length > 0;
      for (const j of leg.joints) if (j.broken || j.strengthScale < LEG_FAIL_SCALE) ok = false;
      for (const p of leg.parts) if (p.removed || p.wrecked) ok = false;
      leg.functional = ok;
      if (ok) n++;
    }
    this.functionalLegs = n;
    const total = Math.max(1, this.legs.length);
    this.capacity = n === 0 ? 0 : Math.pow(n / total, 1.5);
  }

  /** Controller step: runs BEFORE the physics step. */
  preStep(dt: number): void {
    if (this.core.removed) {
      this.neutralize('killed');
      return;
    }
    this.age += dt;
    const world = this.ctx.physics.world;
    const g = this.ctx.physics.gravity;

    // --- vitals & power --------------------------------------------------
    for (const v of this.vitals) {
      if (v.removed || v.wrecked || v.integrity <= 0) {
        this.neutralize('killed');
        break;
      }
    }
    let power = this.state === 'neutralized' ? Math.max(0, this.power - dt * 0.7) : 1;
    if (this.state !== 'neutralized') {
      for (const e of this.engines) {
        e.heat = Math.max(0, e.heat - dt * 0.18);
        if (e.removed || e.wrecked) power = 0;
        else {
          if (e.heat >= 1 && !this.overheated) {
            this.overheated = true;
            this.ctx.events.emit('creatureOverheated', { creature: this, x: e.x, y: e.y });
          } else if (this.overheated && e.heat < 0.4) this.overheated = false;
          power = Math.min(power, 0.35 + 0.65 * e.integrity);
        }
      }
      if (this.overheated) power = 0;
    }
    this.power = power;

    // Legs: re-evaluated when joints break, and cheaply every step (damage lowers strength).
    this.legsDirty = true;
    if (this.legsDirty) this.recomputeLegs();

    // --- grounding ---------------------------------------------------------
    let grounded = false;
    for (const leg of this.legs) {
      if (!leg.functional) continue;
      if (this.footDown(leg.foot)) {
        grounded = true;
        break;
      }
    }
    this.grounded = grounded;

    // --- downed? -----------------------------------------------------------
    const lean = -(this.spec.lean ?? 0) * DEG;
    const tilt = Math.abs(wrapAngle(this.core.angle - lean));
    const low = this.core.height < this.bodyHeight0 * 0.42;
    this.downedTime = tilt > 1.05 || low ? this.downedTime + dt : 0;
    const downed = this.downedTime > 0.6;

    // --- muscles: gait -----------------------------------------------------
    const walking = this.state !== 'neutralized' && this.age > SPAWN_SETTLE && power > 0.05 && this.capacity > 0 && !downed;
    const speed = this.spec.gait.speed * this.capacity * power;
    if (walking) {
      // The gait runs at the TARGET speed (legs keep cycling if it's blocked: it struggles).
      const v = Math.abs(this.core.vx);
      const rate = Math.max(v, speed) / Math.max(0.2, this.spec.gait.stride);
      this.phase += rate * dt;
    }
    for (const leg of this.legs) {
      const sg = leg.swingGait;
      const swinging = walking && !!sg && Math.sin((this.phase + sg.phase) * Math.PI * 2) > 0.05;
      if (swinging !== leg.swinging && !leg.foot.removed) {
        // Planted feet grip; swinging feet slide instead of snagging the ground.
        leg.foot.collider.setFriction(swinging ? 0.05 : leg.foot.def.friction ?? leg.foot.material.friction);
      }
      leg.swinging = swinging;
    }
    const musclePower = walking || this.state === 'spawning' ? power : this.state === 'neutralized' ? power : power * 0.8;
    for (let i = 0; i < this.gait.length; i++) {
      const { joint, g: gt } = this.gait[i]!;
      if (joint.broken) continue;
      joint.setPower(world, musclePower);
      const s = Math.sin((this.phase + gt.phase) * Math.PI * 2);
      const target = !walking || gt.shape === 'hold' ? gt.bias : gt.shape === 'sin' ? gt.bias + gt.amp * s : gt.bias + gt.amp * Math.max(0, s);
      joint.setDrive(world, target);
    }

    // --- support + balance ("puppet strings") -----------------------------------
    // Healthy legs act like a virtual spring holding the body at standing height:
    // the body is pushed up and the planted feet are pushed down with the same
    // force (a couple, so nothing is lifted from thin air). Each leg supplies its
    // share scaled by its health, so a damaged leg really does stop carrying
    // weight — the body sags onto the weakened knee, which then buckles.
    const body = this.core.body;
    const assist = this.state !== 'neutralized' && power > 0.05 && !downed;
    if (assist) {
      let support = 0;
      let feet = 0;
      for (const leg of this.legs) {
        if (!leg.functional || leg.swinging || !this.footDown(leg.foot)) continue;
        // A damaged leg keeps at least half its support until it fails outright.
        let health = 1;
        for (const j of leg.joints) health = Math.min(health, j.strengthScale);
        support += 0.5 + 0.5 * health;
        feet++;
      }
      // In an alternating gait roughly half the legs are in stance at any time.
      support = Math.min(1, support / Math.max(1, this.legs.length * 0.5));
      if (feet > 0 && support > 0) {
        // Carry the upper body only (legs stand on their own feet), so the
        // legs are never stretched by the assist.
        const m = this.upperMass;
        const ks = (m * g) / 0.12;
        const cs = 2 * Math.sqrt(ks * m) * 0.6;
        const dh = this.bodyHeight0 - this.core.height;
        let up = ks * dh + cs * this.core.vy; // vy > 0 = falling (y down)
        up = clamp(up, 0, m * g * 1.15) * support * power * (this.spec.balance ?? 1);
        body.applyImpulse({ x: 0, y: -up * dt }, true);
        const down = (up * dt) / feet;
        for (const leg of this.legs) {
          if (leg.functional && !leg.swinging && this.footDown(leg.foot)) leg.foot.body.applyImpulse({ x: 0, y: down }, true);
        }
      }
      // Swinging feet get a small lift (reaction on the body), so they clear the
      // ground instead of scuffing along under the creature's weight.
      const footLift = this.spec.footLift ?? 0;
      if (grounded && footLift > 0) {
        for (const leg of this.legs) {
          if (!leg.functional || !leg.swinging) continue;
          let m = leg.foot.mass;
          for (const p of leg.parts) m += p.mass * 0.5;
          const lift = m * g * footLift * power * dt;
          leg.foot.body.applyImpulse({ x: 0, y: -lift }, true);
          body.applyImpulse({ x: 0, y: lift }, true);
        }
      }
      if (this.functionalLegs > 0) {
        // Trim the body angle (capped below what the hips can resist).
        const coreI = this.core.mass * this.core.extent * this.core.extent * 0.5 + 1;
        const kp = coreI * 7 * 7 * 8 * (this.spec.balance ?? 1);
        const kd = 2 * Math.sqrt(kp * coreI * 8);
        const err = wrapAngle(this.core.angle - lean);
        let tau = -kp * err - kd * this.core.av;
        const cap = this.hipTorque * 0.5 * power;
        tau = clamp(tau, -cap, cap);
        body.applyTorqueImpulse(tau * dt, true);
      }
    }

    // --- propulsion (toward -x), applied at the hips ---------------------------
    if (walking && grounded) {
      const drive = this.spec.drive ?? 1;
      const vx = this.core.vx;
      let f = this.mass * 3 * (-speed - vx);
      const cap = this.mass * 2.5 * drive;
      f = clamp(f, -cap, cap);
      const c = Math.cos(this.core.angle);
      const sn = Math.sin(this.core.angle);
      const hx = this.core.x + c * this.hipLocal.x - sn * this.hipLocal.y;
      const hy = this.core.y + sn * this.hipLocal.x + c * this.hipLocal.y;
      body.applyImpulseAtPoint({ x: f * dt, y: 0 }, { x: hx, y: hy }, true);
    }

    // --- state machine -------------------------------------------------------
    if (this.state === 'neutralized') return;
    if (this.state === 'spawning' && this.age > SPAWN_SETTLE) this.state = 'walking';
    if (this.state === 'spawning') return;
    let immobile: NeutralizeCause | null = null;
    if (downed) immobile = 'downed';
    else if (this.capacity <= 0) immobile = 'legs';
    else if (power <= 0.05) immobile = 'power';
    // Stuck (blocked, jammed): no progress for a long time.
    this.stuckTimer += dt;
    if (this.stuckTimer >= STUCK_WINDOW) {
      if (!immobile && Math.abs(this.core.x - this.stuckRefX) < STUCK_DISTANCE) immobile = 'stuck';
      this.stuckTimer = 0;
      this.stuckRefX = this.core.x;
    }
    if (immobile) {
      this.immobileTime += dt;
      this.state = 'immobilized';
      // Overheating is temporary: an overheated engine only stops it while hot.
      const threshold = immobile === 'power' && this.overheated ? Infinity : immobile === 'stuck' ? 0 : NEUTRALIZE_AFTER;
      if (this.immobileTime >= threshold) this.neutralize(immobile);
    } else {
      this.immobileTime = 0;
      this.state = this.functionalLegs < this.legs.length ? 'crippled' : 'walking';
    }
  }

  /** Foot touching (or within a few cm of) the ground. */
  footDown(foot: StructurePart): boolean {
    return !foot.removed && foot.height - foot.halfHeightNow < 0.1;
  }

  neutralize(cause: NeutralizeCause): void {
    if (this.state === 'neutralized') return;
    this.state = 'neutralized';
    this.cause = cause;
    this.ctx.events.emit('creatureNeutralized', { creature: this, cause, x: this.core.x, y: this.core.y });
  }
}

export function resetCreatureIds(): void {
  nextCreatureId = 1;
}
