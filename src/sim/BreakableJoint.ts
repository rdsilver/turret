/**
 * Breakable structural joints with *measurable* load.
 *
 * Rapier's JS bindings do not expose joint reaction forces, so every joint is
 * built so that its load can be read back from body transforms:
 *
 *   WELD  = zero-rest-length spring joint (isotropic linear spring between the
 *           two anchor points, implicit & force-based) + a stiff force-based
 *           position motor on the relative angle (bending spring).
 *           force  = kLin * |anchor separation|
 *           moment = kAng * |relative rotation error|
 *   HINGE = the linear spring only (free rotation).
 *   CABLE = spring with rest length L that is switched off while slack
 *           (tension only).
 *
 * Both motors are clamped to their yield load (Rapier motor max force), so an
 * overloaded joint does not hold: it *yields*. Yielding rotation is made
 * permanent (plastic set: the motor target follows the deformation) and
 * accumulates toward `bendLimit`; linear separation beyond yield accumulates
 * toward `stretchLimit`. This gives the feel we want:
 *
 *   overload -> visible sag / lean + creak -> SNAP -> load moves elsewhere.
 */
import { R, type RapierNS } from './RapierModule';
import type { StructurePart } from './StructurePart';
import type { JointKind } from './StructureDefinition';
import type { BondProps, MaterialId } from './Materials';
import { wrapAngle } from '../core/math';

export type BreakCause = 'tension' | 'bend' | 'explosion' | 'shatter' | 'debug' | 'removed';

/** Global joint stiffness: natural angular frequency (rad/s) of a joint about its reduced mass. */
export const JOINT_OMEGA = 95;
/** Damping ratio used for joint springs (implicit, so > 1 is fine and quiet). */
export const JOINT_ZETA = 1.0;

export interface JointSpec {
  kind: JointKind;
  a: StructurePart;
  /** null = anchored to the world/ground. */
  b: StructurePart | null;
  /** Anchor local to A (sim space). */
  lax: number;
  lay: number;
  /** Anchor local to B, or WORLD anchor when b is null. */
  lbx: number;
  lby: number;
  /** Cable rest length (m). */
  restLength: number;
  bond: BondProps;
  bondMaterial: MaterialId;
  seam: number;
  strength: number;
  tags: readonly string[];
}

let nextJointId = 1;

export class BreakableJoint {
  readonly id = nextJointId++;
  readonly kind: JointKind;
  readonly a: StructurePart;
  readonly b: StructurePart | null;
  readonly tags: readonly string[];
  readonly bondMaterial: MaterialId;

  joint: RapierNS.ImpulseJoint | null = null;
  handle = -1;

  readonly lax: number;
  readonly lay: number;
  readonly lbx: number;
  readonly lby: number;
  readonly restLength: number;
  restAngle = 0;

  kLin = 0;
  cLin = 0;
  kAng = 0;
  cAng = 0;
  yieldForce: number;
  yieldMoment: number;
  stretchLimit: number;
  bendLimit: number;
  /** Values at strength scale 1 (status effects scale from these). */
  private readonly base: { yieldForce: number; yieldMoment: number; stretchLimit: number; bendLimit: number };
  /** Current strength multiplier from status effects (1 = normal). */
  strengthScale = 1;
  /** Elastic displacement at yield (m). */
  yieldDisp = 0;
  /** Elastic rotation at yield (rad). */
  yieldRot = 0;

  // ---- live state -------------------------------------------------------
  /** Accumulated plastic rotation (signed, rad). */
  plastic = 0;
  /** Current linear load estimate (N). */
  force = 0;
  /** Current bending load estimate (N*m). */
  moment = 0;
  /** Utilisation: max(force/yieldForce, moment/yieldMoment); >= 1 means yielding. */
  stress = 0;
  /** Smoothed stress for visualisation (decays slowly, rises instantly). */
  stressVis = 0;
  /** Progress to failure 0..1. */
  damage = 0;
  yielding = false;
  slack = false;
  broken = false;
  brokenCause: BreakCause | null = null;
  evalStamp = -1;
  /** Last sim time a jointStressed event was emitted. */
  lastCreak = -10;
  /** Plastic progress at last creak report. */
  lastCreakDamage = 0;
  /** Current world-space anchor midpoint (sim space). */
  wx = 0;
  wy = 0;
  /** Anchor points on each side (sim space) for rendering cables/welds. */
  ax = 0;
  ay = 0;
  bx = 0;
  by = 0;

  constructor(spec: JointSpec) {
    this.kind = spec.kind;
    this.a = spec.a;
    this.b = spec.b;
    this.tags = spec.tags;
    this.bondMaterial = spec.bondMaterial;
    this.lax = spec.lax;
    this.lay = spec.lay;
    this.lbx = spec.lbx;
    this.lby = spec.lby;
    this.restLength = spec.restLength;
    const s = spec.strength;
    if (spec.kind === 'cable') {
      this.yieldForce = Math.max(1, spec.bond.tension * s);
      this.yieldMoment = 0;
    } else {
      this.yieldForce = Math.max(1, spec.bond.tension * spec.seam * s);
      this.yieldMoment = Math.max(1, spec.bond.bend * spec.seam * spec.seam * s);
    }
    this.stretchLimit = spec.bond.stretchLimit;
    this.bendLimit = spec.bond.bendLimit;
    this.base = { yieldForce: this.yieldForce, yieldMoment: this.yieldMoment, stretchLimit: this.stretchLimit, bendLimit: this.bendLimit };
    this.computeStiffness(spec.bond.stiffness);
  }

  /**
   * Scale strength and ductility (e.g. a freeze round makes joints brittle:
   * scale 0.35 also shrinks the plastic limits so they snap instead of bend).
   */
  setStrengthScale(world: RapierNS.World, scale: number, ductilityScale = scale): void {
    if (this.broken) return;
    this.strengthScale = scale;
    this.yieldForce = Math.max(1, this.base.yieldForce * scale);
    this.yieldMoment = this.base.yieldMoment > 0 ? Math.max(1, this.base.yieldMoment * scale) : 0;
    this.stretchLimit = this.base.stretchLimit * ductilityScale;
    this.bendLimit = this.base.bendLimit * ductilityScale;
    this.yieldDisp = this.yieldForce / this.kLin;
    this.yieldRot = this.yieldMoment > 0 ? this.yieldMoment / this.kAng : 0;
    const RAP = R();
    const raw = world.impulseJoints.raw;
    if (this.kind !== 'cable' || !this.slack) raw.jointSetMotorMaxForce(this.handle, RAP.JointAxis.LinX as number, this.yieldForce);
    if (this.kind === 'weld') raw.jointSetMotorMaxForce(this.handle, RAP.JointAxis.AngX as number, this.yieldMoment);
    this.a.body.wakeUp();
  }

  get rating(): number {
    return this.yieldForce;
  }

  get isGround(): boolean {
    return this.b === null;
  }

  other(p: StructurePart): StructurePart | null {
    return p === this.a ? this.b : this.a;
  }

  /** Stiffness from reduced mass/inertia so every joint rings at ~JOINT_OMEGA. */
  private computeStiffness(stiffnessMul: number): void {
    const a = this.a;
    const b = this.b;
    const ma = a.mass;
    const ia = inertiaAbout(a, this.lax, this.lay);
    let mu = ma;
    let iu = ia;
    if (b && !b.fixed) {
      const mb = b.mass;
      const ib = inertiaAbout(b, this.lbx, this.lby);
      mu = (ma * mb) / (ma + mb);
      iu = (ia * ib) / (ia + ib);
    }
    const w = JOINT_OMEGA * Math.sqrt(stiffnessMul);
    this.kLin = mu * w * w;
    this.cLin = 2 * JOINT_ZETA * Math.sqrt(this.kLin * mu);
    this.kAng = iu * w * w;
    this.cAng = 2 * JOINT_ZETA * Math.sqrt(this.kAng * iu);
    this.yieldDisp = this.yieldForce / this.kLin;
    this.yieldRot = this.yieldMoment > 0 ? this.yieldMoment / this.kAng : 0;
  }

  /** Create the Rapier joint. `groundBody` is used when b is null. */
  attach(world: RapierNS.World, groundBody: RapierNS.RigidBody): void {
    const RAP = R();
    const bodyB = this.b ? this.b.body : groundBody;
    const angleB = this.b ? this.b.angle : 0;
    this.restAngle = wrapAngle(angleB - this.a.angle);
    const rest = this.kind === 'cable' ? this.restLength : 0;
    // Ground anchors are stored in world space; Rapier wants them local to the ground body.
    let lbx = this.lbx;
    let lby = this.lby;
    if (!this.b) {
      const g = groundBody.translation();
      lbx -= g.x;
      lby -= g.y;
    }
    const data = RAP.JointData.spring(rest, this.kLin, this.cLin, { x: this.lax, y: this.lay }, { x: lbx, y: lby });
    const j = world.createImpulseJoint(data, this.a.body, bodyB, false);
    this.joint = j;
    this.handle = j.handle;
    const raw = world.impulseJoints.raw;
    raw.jointSetMotorMaxForce(this.handle, RAP.JointAxis.LinX as number, this.yieldForce);
    if (this.kind === 'weld') {
      raw.jointConfigureMotorModel(this.handle, RAP.JointAxis.AngX as number, RAP.MotorModel.ForceBased as number);
      raw.jointConfigureMotorPosition(this.handle, RAP.JointAxis.AngX as number, this.restAngle, this.kAng, this.cAng);
      raw.jointSetMotorMaxForce(this.handle, RAP.JointAxis.AngX as number, this.yieldMoment);
    }
    // Keep contacts between welded neighbours: compression goes through contact (rigid),
    // tension / shear / bending through the joint (measured).
    j.setContactsEnabled(true);
  }

  /**
   * Measure load from the cached part transforms and advance plasticity.
   * Called once per physics step while either side is awake.
   * Returns true when the joint should break.
   */
  evaluate(world: RapierNS.World): boolean {
    const a = this.a;
    const ca = Math.cos(a.angle);
    const sa = Math.sin(a.angle);
    const pax = a.x + ca * this.lax - sa * this.lay;
    const pay = a.y + sa * this.lax + ca * this.lay;
    let pbx: number;
    let pby: number;
    let angB = 0;
    const b = this.b;
    if (b) {
      const cb = Math.cos(b.angle);
      const sb = Math.sin(b.angle);
      pbx = b.x + cb * this.lbx - sb * this.lby;
      pby = b.y + sb * this.lbx + cb * this.lby;
      angB = b.angle;
    } else {
      pbx = this.lbx;
      pby = this.lby;
    }
    this.ax = pax;
    this.ay = pay;
    this.bx = pbx;
    this.by = pby;
    this.wx = (pax + pbx) * 0.5;
    this.wy = (pay + pby) * 0.5;
    const dx = pbx - pax;
    const dy = pby - pay;
    const d = Math.sqrt(dx * dx + dy * dy);

    if (this.kind === 'cable') {
      const ext = d - this.restLength;
      const slack = ext <= 0;
      if (slack !== this.slack) {
        this.slack = slack;
        world.impulseJoints.raw.jointSetMotorMaxForce(this.handle, R().JointAxis.LinX as number, slack ? 0 : this.yieldForce);
      }
      this.force = slack ? 0 : Math.min(ext * this.kLin, this.yieldForce);
      this.moment = 0;
      this.stress = this.force / this.yieldForce;
      const over = ext - this.yieldDisp;
      this.yielding = over > 0;
      this.damage = over > 0 ? over / this.stretchLimit : 0;
      this.updateVis();
      return this.damage >= 1;
    }

    // Linear (tension / shear) — elastic up to yield, then free separation.
    this.force = Math.min(d * this.kLin, this.yieldForce);
    const overLin = d - this.yieldDisp;
    let linDamage = overLin > 0 ? overLin / this.stretchLimit : 0;
    this.yielding = overLin > 0;

    let bendDamage = 0;
    if (this.kind === 'weld') {
      const rel = wrapAngle(angB - a.angle - this.restAngle - this.plastic);
      const mag = Math.abs(rel);
      if (mag > this.yieldRot) {
        // Plastic flow: the joint takes a permanent set.
        const excess = mag - this.yieldRot;
        this.plastic += rel > 0 ? excess : -excess;
        world.impulseJoints.raw.jointConfigureMotorPosition(
          this.handle,
          R().JointAxis.AngX as number,
          this.restAngle + this.plastic,
          this.kAng,
          this.cAng,
        );
        this.yielding = true;
        this.moment = this.yieldMoment;
      } else {
        this.moment = mag * this.kAng;
      }
      bendDamage = Math.abs(this.plastic) / this.bendLimit;
    } else {
      this.moment = 0;
    }

    this.stress = Math.max(this.force / this.yieldForce, this.yieldMoment > 0 ? this.moment / this.yieldMoment : 0);
    if (linDamage < 0) linDamage = 0;
    this.damage = Math.max(linDamage, bendDamage);
    this.updateVis();
    return this.damage >= 1;
  }

  private updateVis(): void {
    const target = Math.min(1.5, this.stress + this.damage * 0.5);
    this.stressVis = target > this.stressVis ? target : this.stressVis + (target - this.stressVis) * 0.08;
  }

  /** Remove from Rapier. Bookkeeping (part lists, events) is done by PhysicsWorld. */
  detach(world: RapierNS.World): void {
    if (this.joint && this.joint.isValid()) world.removeImpulseJoint(this.joint, true);
    this.joint = null;
    this.handle = -1;
  }
}

/** Moment of inertia of a part about a local point (parallel axis theorem). */
function inertiaAbout(p: StructurePart, lx: number, ly: number): number {
  let icm: number;
  const s = p.shape;
  if (s.kind === 'box') icm = (p.mass * (4 * s.hw * s.hw + 4 * s.hh * s.hh)) / 12;
  else if (s.kind === 'circle') icm = 0.5 * p.mass * s.r * s.r;
  else icm = 0.5 * p.mass * p.extent * p.extent * 0.6;
  return icm + p.mass * (lx * lx + ly * ly);
}

export function resetJointIds(): void {
  nextJointId = 1;
}
