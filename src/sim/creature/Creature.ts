/**
 * Creature controller: turns a built Structure into something that walks at
 * the turret.
 *
 * Locomotion is physical with assistance:
 *  - leg muscles follow a gait cycle whose phase advances with distance
 *    walked, so planted feet don't skate;
 *  - planted legs hold their body segment up like springs (pushing the body
 *    up at the hip and the foot down, so nothing is lifted from thin air),
 *    each leg only as much as its health allows;
 *  - a balance assist (a gyroscope-like torque on the core) keeps it upright,
 *    but only while it has legs under it and power;
 *  - propulsion is a horizontal push on the body segments, scaled by working
 *    legs, power and whether any working foot touches the ground.
 * Everything else — stumbling, buckling knees, severed limbs, falling over —
 * is the physics. Shoot a knee and the gait breaks for real.
 *
 * A creature only controls the parts still connected to its core: a severed
 * limb or a cut-off tail stops obeying it (CreatureManager may turn a big
 * enough cut-off piece into a creature of its own).
 */
import type { SimContext } from '../SimContext';
import type { Structure } from '../Structure';
import type { StructurePart } from '../StructurePart';
import type { BreakableJoint } from '../BreakableJoint';
import type { CreatureSpec, LegSpec, MuscleGait } from './CreatureTypes';
import { DEG, clamp, wrapAngle } from '../../core/math';
import { R } from '../RapierModule';
import { GROUP, interactionGroups } from '../../config/constants';

export type CreatureState = 'spawning' | 'walking' | 'crippled' | 'immobilized' | 'neutralized';
export type NeutralizeCause = 'legs' | 'downed' | 'power' | 'killed' | 'stuck';

interface LegRuntime {
  spec: LegSpec;
  joints: BreakableJoint[];
  parts: StructurePart[];
  foot: StructurePart;
  /** Body part the hip hangs from. */
  parent: StructurePart;
  functional: boolean;
  /** Gait term that marks the swing phase (the leg's 'swing'-shaped muscle), if any. */
  swingGait: MuscleGait | null;
  /** In swing phase this step (foot lifting / moving forward). */
  swinging: boolean;
  /** Parent-local hip anchor: support acts at x (along the body axis), propulsion at (x, y). */
  hipX: number;
  hipY: number;
}

/** The legs under one body part, and the share of the body weight they carry. */
interface SupportGroup {
  parent: StructurePart;
  legs: LegRuntime[];
  /** Carried mass (kg) while connected. */
  carried: number;
  active: boolean;
  hipX: number;
  hipY: number;
}

/** A floating creature's part and its pose relative to the core at spawn. */
interface FloatPart {
  part: StructurePart;
  dx: number;
  dy: number;
  angle: number;
  /** Index into spec.float.rings; -1 = spins with the core. */
  ring: number;
}

/** Seconds a creature must stay immobile before it counts as stopped for good. */
const NEUTRALIZE_AFTER = 1.8;
const STUCK_WINDOW = 7;
const STUCK_DISTANCE = 0.35;
const SPAWN_SETTLE = 0.7;
/** Seconds over which the gait eases in after spawning. */
const GAIT_RAMP = 0.8;
/** Joint strength below which a leg joint no longer carries its leg. */
const LEG_FAIL_SCALE = 0.32;

let nextCreatureId = 1;

export class Creature {
  readonly id = nextCreatureId++;
  /** Blueprint id it was spawned from (split pieces keep their parent's). */
  kind = '';
  readonly spec: CreatureSpec;
  readonly structure: Structure;
  readonly core: StructurePart;
  readonly muscles = new Map<string, BreakableJoint>();
  readonly legs: LegRuntime[] = [];
  readonly vitals: StructurePart[] = [];
  readonly engines: StructurePart[] = [];
  private readonly gait: { joint: BreakableJoint; g: MuscleGait }[] = [];
  private readonly supports: SupportGroup[] = [];

  state: CreatureState = 'spawning';
  cause: NeutralizeCause | null = null;
  /** Age (s) when it was stopped, -1 while active. */
  neutralizedAt = -1;
  /** Gait phase in cycles. */
  phase = 0;
  /** 0..1 power from engines / heart. */
  power = 1;
  /** 0..1 locomotion capacity from working legs. */
  capacity = 1;
  functionalLegs = 0;
  /** Legs still attached to this creature's body (working or not). */
  ownedLegs = 0;
  grounded = false;
  overheated = false;
  age = 0;
  /** Mass of everything still attached to the core. */
  mass = 0;
  /** Mass the legs carry (everything attached that isn't leg). */
  upperMass = 0;
  /** Spawn height of the body center (m). */
  readonly bodyHeight0: number;
  /** Seconds continuously immobile. */
  private immobileTime = 0;
  private downedTime = 0;
  private stuckRefX = 0;
  private stuckTimer = 0;
  /** Parts still connected to the core through intact joints (abilities need their organ attached). */
  private connected = new Set<StructurePart>();
  private connectedDirty = true;
  /** Strongest attached hip muscle torque (caps the body-trim torque). */
  private hipTorque = 0;
  private groups: LegRuntime[][] = [];
  /** Floating creatures: every part, moved kinematically each step. */
  private floatParts: FloatPart[] | null = null;
  private floatT = 0;
  private floatX = 0;
  private floatY = 0;

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
      const joints = leg.joints.map((n) => this.muscles.get(n)).filter((j): j is BreakableJoint => !!j);
      const parts = leg.parts.map((n) => structure.part(n)).filter((p): p is StructurePart => !!p);
      // Muscle convention: a = parent (body side), b = child (limb side).
      const hip = joints[0];
      const parent = hip && !parts.includes(hip.a) ? hip.a : core;
      const onA = hip ? hip.a === parent : false;
      this.legs.push({
        spec: leg,
        joints,
        parts,
        foot,
        parent,
        functional: true,
        swingGait: leg.joints.map((n) => spec.gait.muscles[n]).find((g) => g?.shape === 'swing') ?? null,
        swinging: false,
        hipX: hip ? (onA ? hip.lax : hip.lbx) : 0,
        hipY: hip ? (onA ? hip.lay : hip.lby) : 0,
      });
    }
    for (const leg of this.legs) {
      let g = this.supports.find((s) => s.parent === leg.parent);
      if (!g) this.supports.push((g = { parent: leg.parent, legs: [], carried: 0, active: true, hipX: 0, hipY: 0 }));
      g.legs.push(leg);
    }
    for (const g of this.supports) {
      for (const l of g.legs) {
        g.hipX += l.hipX / g.legs.length;
        g.hipY += l.hipY / g.legs.length;
      }
    }
    this.groups = (spec.legGroups ?? []).map((names) => this.legs.filter((l) => names.includes(l.spec.name)));
    for (const id of spec.vitals ?? [spec.core]) {
      const p = structure.part(id);
      if (p) this.vitals.push(p);
    }
    for (const id of spec.engines ?? []) {
      const p = structure.part(id);
      if (p) this.engines.push(p);
    }
    this.bodyHeight0 = core.h0;
    this.stuckRefX = core.x;
    if (spec.float) this.initFloat(spec);
    this.refreshBody();
  }

  /** Floating: all parts become kinematic and remember their pose around the core. */
  private initFloat(spec: CreatureSpec): void {
    const f = spec.float!;
    const core = this.core;
    this.floatX = core.x;
    this.floatY = core.y;
    const kinematic = R().RigidBodyType.KinematicPositionBased;
    this.floatParts = [];
    for (const p of this.structure.parts) {
      if (p.removed) continue;
      p.body.setBodyType(kinematic, true);
      const ring = f.rings.findIndex((r) => !!p.name && r.parts.includes(p.name));
      this.floatParts.push({ part: p, dx: p.x - core.x, dy: p.y - core.y, angle: p.angle, ring });
    }
  }

  get x(): number {
    return this.core.x;
  }

  /** Front-most point (smallest x, m) of the body still attached to it: what reaches the line first. */
  get frontX(): number {
    if (this.connectedDirty) this.refreshBody();
    let x = Infinity;
    for (const p of this.connected) {
      if (p.removed || p.wrecked) continue;
      const e = p.x - p.halfWidthNow;
      if (e < x) x = e;
    }
    return x === Infinity ? this.core.x : x;
  }

  get active(): boolean {
    return this.state !== 'neutralized';
  }

  /** A joint of this creature's structure broke (called by the manager). */
  onJointBroken(): void {
    this.connectedDirty = true;
  }

  markDirty(): void {
    this.connectedDirty = true;
  }

  /** Is this part still attached to this creature's body (and not wrecked)? */
  organAttached(p: StructurePart): boolean {
    if (p.removed || p.wrecked) return false;
    return this.owns(p);
  }

  /** Is this part connected to this creature's core? */
  owns(p: StructurePart): boolean {
    if (this.connectedDirty) this.refreshBody();
    return this.connected.has(p);
  }

  /** Recompute what is attached to the core, and the masses the legs carry. */
  private refreshBody(): void {
    this.connectedDirty = false;
    const seen = this.connected;
    seen.clear();
    if (this.floatParts) {
      // Nothing holds a floater together but its own motion: every part is its body.
      for (const fp of this.floatParts) if (!fp.part.removed) seen.add(fp.part);
    } else if (!this.core.removed) {
      const stack: StructurePart[] = [this.core];
      seen.add(this.core);
      while (stack.length) {
        const p = stack.pop()!;
        for (const j of p.joints) {
          if (j.broken) continue;
          const o = j.other(p);
          if (o && !o.removed && !seen.has(o)) {
            seen.add(o);
            stack.push(o);
          }
        }
      }
    }
    let mass = 0;
    for (const p of seen) mass += p.mass;
    let legMass = 0;
    this.hipTorque = 0;
    for (const leg of this.legs) {
      if (!seen.has(leg.parent)) continue;
      for (const p of leg.parts) if (seen.has(p)) legMass += p.mass;
      const hip = leg.joints[0];
      if (hip && !hip.broken) this.hipTorque = Math.max(this.hipTorque, hip.muscle?.torque ?? 0);
    }
    this.mass = mass;
    this.upperMass = Math.max(0, mass - legMass);
    // Each attached body part carries a share of the upper body in proportion to its own mass.
    let parents = 0;
    for (const g of this.supports) {
      g.active = seen.has(g.parent);
      if (g.active) parents += g.parent.mass;
    }
    for (const g of this.supports) g.carried = g.active && parents > 0 ? (this.upperMass * g.parent.mass) / parents : 0;
  }

  private recomputeLegs(): void {
    let n = 0;
    let owned = 0;
    for (const leg of this.legs) {
      const mine = this.connected.has(leg.parent);
      let ok = leg.joints.length > 0 && mine;
      for (const j of leg.joints) if (j.broken || j.strengthScale < LEG_FAIL_SCALE) ok = false;
      for (const p of leg.parts) if (p.removed || p.wrecked) ok = false;
      leg.functional = ok;
      if (ok) n++;
      if (mine) owned++;
    }
    this.functionalLegs = n;
    this.ownedLegs = owned;
    // Speed follows the share of its own legs that still work (a cut-off half has fewer legs, all its own).
    this.capacity = n === 0 ? 0 : Math.pow(n / Math.max(1, owned), 1.5);
    // A leg group with no working leg left (both front legs gone) grounds it.
    for (const g of this.groups) if (!g.some((l) => l.functional)) this.capacity = 0;
    // A split-capable body cut down below its minimum size can't go on.
    const split = this.spec.split;
    if (split) {
      let segs = 0;
      for (const p of this.connected) if (p.hasTag(split.tag) && !p.wrecked) segs++;
      if (segs < split.min) this.capacity = 0;
    }
  }

  /** Controller step: runs BEFORE the physics step. */
  preStep(dt: number): void {
    if (this.core.removed) {
      this.neutralize('killed');
      return;
    }
    if (this.connectedDirty) this.refreshBody();
    if (this.floatParts) {
      this.floatStep(dt);
      return;
    }
    this.age += dt;
    const world = this.ctx.physics.world;
    const g = this.ctx.physics.gravity;

    // --- vitals & power --------------------------------------------------
    for (const v of this.vitals) {
      if (v.removed || v.wrecked || v.integrity <= 0 || !this.connected.has(v)) {
        this.neutralize('killed');
        break;
      }
    }
    let power = this.state === 'neutralized' ? Math.max(0, this.power - dt * 0.7) : 1;
    if (this.state !== 'neutralized') {
      for (const e of this.engines) {
        e.heat = Math.max(0, e.heat - dt * 0.15);
        if (e.removed || e.wrecked || !this.connected.has(e)) power = 0;
        else {
          if (e.heat >= 1 && !this.overheated) {
            this.overheated = true;
            this.ctx.events.emit('creatureOverheated', { creature: this, x: e.x, y: e.y });
          } else if (this.overheated && e.heat < 0.4) this.overheated = false;
          power = Math.min(power, 0.35 + 0.65 * e.integrity);
        }
      }
    }
    this.power = power;
    // An overheated engine stalls the gait but still holds the body up.
    const stalled = this.overheated && this.state !== 'neutralized';

    // Legs: cheap, and damage lowers joint strength every step.
    this.recomputeLegs();

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
    this.downedTime = tilt > (this.spec.downedTilt ?? 60) * DEG || low ? this.downedTime + dt : 0;
    const downed = this.downedTime > 0.6;

    // --- muscles: gait -----------------------------------------------------
    const walking = this.state !== 'neutralized' && this.age > SPAWN_SETTLE && power > 0.05 && this.capacity > 0 && !downed && !stalled;
    // The gait eases in over its first moments (a standing start, not a jolt that snaps hips).
    const ramp = clamp((this.age - SPAWN_SETTLE) / GAIT_RAMP, 0, 1);
    const speed = this.spec.gait.speed * this.capacity * power * ramp;
    if (walking) {
      // The gait runs at the TARGET speed (legs keep cycling if it's blocked: it struggles).
      const rate = speed / Math.max(0.2, this.spec.gait.stride);
      this.phase += rate * dt;
    }
    for (const leg of this.legs) {
      const sg = leg.swingGait;
      const swinging = walking && leg.functional && !!sg && Math.sin((this.phase + sg.phase) * Math.PI * 2) > 0.05;
      if (swinging !== leg.swinging && !leg.foot.removed) {
        // Planted feet grip; swinging feet slide instead of snagging the ground.
        leg.foot.collider.setFriction(swinging ? 0.05 : leg.foot.def.friction ?? leg.foot.material.friction);
      }
      leg.swinging = swinging;
    }
    const musclePower = walking || this.state === 'spawning' ? power : this.state === 'neutralized' ? power : power * 0.8;
    for (let i = 0; i < this.gait.length; i++) {
      const { joint, g: gt } = this.gait[i]!;
      // Muscles cut off from the body are no longer ours to drive.
      if (joint.broken || !this.connected.has(joint.a)) continue;
      joint.setPower(world, musclePower);
      const s = Math.sin((this.phase + gt.phase) * Math.PI * 2);
      const amp = gt.amp * ramp;
      const target = !walking || gt.shape === 'hold' ? gt.bias : gt.shape === 'sin' ? gt.bias + amp * s : gt.bias + amp * Math.max(0, s);
      joint.setDrive(world, target);
    }

    // --- support + balance ("puppet strings") -----------------------------------
    // Healthy planted legs act like springs holding their body part at standing
    // height: the body is pushed up at the hip and the foot pushed down with the
    // same force. Each leg supplies its share scaled by its health, so a damaged
    // leg really does stop carrying weight — the body sags onto the weakened
    // knee, which then buckles; lose the front legs and it pitches onto its nose.
    const body = this.core.body;
    const assist = this.state !== 'neutralized' && power > 0.05 && !downed;
    if (assist) {
      const balance = this.spec.balance ?? 1;
      for (const sg of this.supports) {
        if (!sg.active || sg.carried <= 0 || sg.parent.removed) continue;
        let support = 0;
        let feet = 0;
        for (const leg of sg.legs) {
          if (!leg.functional || leg.swinging || !this.footDown(leg.foot)) continue;
          // A damaged leg keeps at least half its support until it fails outright.
          let health = 1;
          for (const j of leg.joints) health = Math.min(health, j.strengthScale);
          support += 0.5 + 0.5 * health;
          feet++;
        }
        if (feet === 0) continue;
        // In an alternating gait roughly half the legs are in stance at any time.
        support = Math.min(1, support / Math.max(1, sg.legs.length * 0.5));
        const part = sg.parent;
        const m = sg.carried;
        const ks = (m * g) / 0.12;
        const cs = 2 * Math.sqrt(ks * m) * 0.6;
        const dh = part.h0 - part.height;
        let up = ks * dh + cs * part.vy; // vy > 0 = falling (y down)
        up = clamp(up, 0, m * g * 1.15) * support * power * balance;
        const share = (up * dt) / feet;
        const c = Math.cos(part.angle);
        const sn = Math.sin(part.angle);
        for (const leg of sg.legs) {
          if (!leg.functional || leg.swinging || !this.footDown(leg.foot)) continue;
          part.body.applyImpulseAtPoint({ x: 0, y: -share }, { x: part.x + c * leg.hipX, y: part.y + sn * leg.hipX }, true);
          leg.foot.body.applyImpulse({ x: 0, y: share }, true);
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
          leg.parent.body.applyImpulse({ x: 0, y: lift }, true);
        }
      }
      if (this.functionalLegs > 0) {
        // Trim the body angle (capped below what the hips can resist).
        const coreI = this.core.mass * this.core.extent * this.core.extent * 0.5 + 1;
        const kp = coreI * 7 * 7 * 8 * balance;
        const kd = 2 * Math.sqrt(kp * coreI * 8);
        const err = wrapAngle(this.core.angle - lean);
        let tau = -kp * err - kd * this.core.av;
        const cap = this.hipTorque * 0.5 * power;
        tau = clamp(tau, -cap, cap);
        body.applyTorqueImpulse(tau * dt, true);
      }
    }

    // --- propulsion (toward -x), applied at the hips of each body part -------------
    if (walking && grounded && this.upperMass > 0) {
      const drive = this.spec.drive ?? 1;
      let f = this.mass * 3 * (-speed - this.core.vx);
      const cap = this.mass * 2.5 * drive;
      f = clamp(f, -cap, cap);
      for (const sg of this.supports) {
        if (!sg.active || sg.carried <= 0 || sg.parent.removed) continue;
        const part = sg.parent;
        const c = Math.cos(part.angle);
        const sn = Math.sin(part.angle);
        const hx = part.x + c * sg.hipX - sn * sg.hipY;
        const hy = part.y + sn * sg.hipX + c * sg.hipY;
        part.body.applyImpulseAtPoint({ x: ((f * sg.carried) / this.upperMass) * dt, y: 0 }, { x: hx, y: hy }, true);
      }
    }

    // --- state machine -------------------------------------------------------
    if (this.state === 'neutralized') return;
    if (this.state === 'spawning' && this.age > SPAWN_SETTLE) this.state = 'walking';
    if (this.state === 'spawning') return;
    let immobile: NeutralizeCause | null = null;
    if (downed) immobile = 'downed';
    else if (this.capacity <= 0) immobile = 'legs';
    else if (power <= 0.05 || stalled) immobile = 'power';
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
      const threshold = immobile === 'power' && stalled ? Infinity : immobile === 'stuck' ? 0 : NEUTRALIZE_AFTER;
      if (this.immobileTime >= threshold) this.neutralize(immobile);
    } else {
      this.immobileTime = 0;
      this.state = this.functionalLegs < this.ownedLegs ? 'crippled' : 'walking';
    }
  }

  /** A part of this creature was wrecked (called by the manager). A floater's ring part drops away. */
  onPartWrecked(part: StructurePart): void {
    if (!this.floatParts || this.state === 'neutralized') return;
    const i = this.floatParts.findIndex((q) => q.part === part);
    if (i < 0 || this.floatParts[i]!.ring < 0) return;
    this.floatParts.splice(i, 1);
    this.release(part);
    // Falling armour is debris: it no longer stops rounds.
    part.collider.setCollisionGroups(interactionGroups(GROUP.CREATURE, 0xffff & ~(GROUP.CREATURE | GROUP.PROJECTILE)));
    this.connectedDirty = true;
    this.ctx.events.emit('limbPopped', { creature: this, part, x: part.x, y: part.y });
  }

  /** Floating: drift toward the turret, bob, spin the core and turn every ring around it. */
  private floatStep(dt: number): void {
    this.age += dt;
    for (const v of this.vitals) {
      if (v.removed || v.wrecked || v.integrity <= 0) {
        this.neutralize('killed');
        break;
      }
    }
    if (this.state === 'neutralized') return;
    if (this.state === 'spawning' && this.age > SPAWN_SETTLE) this.state = 'walking';
    const f = this.spec.float!;
    if (this.state !== 'spawning') this.floatX -= this.spec.gait.speed * dt;
    this.floatT += dt;
    const t = this.floatT;
    const cx = this.floatX;
    const cy = this.floatY + f.bob * Math.sin((t / f.bobPeriod) * Math.PI * 2);
    for (const fp of this.floatParts!) {
      const p = fp.part;
      if (p.removed) continue;
      const rot = (fp.ring < 0 ? f.spin : f.rings[fp.ring]!.spin) * t;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      p.body.setNextKinematicTranslation({ x: cx + c * fp.dx - s * fp.dy, y: cy + s * fp.dx + c * fp.dy });
      p.body.setNextKinematicRotation(fp.angle + rot);
    }
  }

  /** Hand a kinematic floater part over to physics, keeping its current motion. */
  private release(part: StructurePart): void {
    if (part.removed) return;
    const b = part.body;
    const v = b.linvel();
    const w = b.angvel();
    b.setBodyType(R().RigidBodyType.Dynamic, true);
    b.setLinvel(v, true);
    b.setAngvel(w, true);
  }

  /** A floater's heart is gone: everything drops, blown apart by a small burst. */
  private dropFloat(): void {
    for (const fp of this.floatParts!) this.release(fp.part);
    const c = this.core;
    this.ctx.explosions.schedule(c.x, c.y, 2.2 * c.extent + 2, 0.3, 0, 'material');
  }

  /** Foot touching (or within a few cm of) the ground. */
  footDown(foot: StructurePart): boolean {
    return !foot.removed && foot.height - foot.halfHeightNow < 0.1;
  }

  neutralize(cause: NeutralizeCause): void {
    if (this.state === 'neutralized') return;
    this.state = 'neutralized';
    this.cause = cause;
    this.neutralizedAt = this.age;
    if (this.floatParts) this.dropFloat();
    this.ctx.events.emit('creatureNeutralized', { creature: this, cause, x: this.core.x, y: this.core.y });
  }
}

export function resetCreatureIds(): void {
  nextCreatureId = 1;
}
