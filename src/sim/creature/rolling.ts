/**
 * Rolling locomotion (CreatureSpec.roll): the body is a wheel, a closed ring
 * of rim parts joined end to end. Nothing pushes it along: the controller
 * turns the ring with a torque of its own (equal and opposite tangential
 * pulls on every rim part, so no net force), and the rim's grip on the ground
 * turns the spin into rolling. Lifted off the ground it only spins; against a
 * bump it leans harder into the torque, up to its limit.
 *
 * The ring holds its shape through its seams alone (rubber seams let it squash
 * a little where it meets the ground). A torn seam or a lost rim part opens
 * it, and an open ring can't roll: Creature treats that as downed.
 *
 * A polygon (RollSpec.tip: wedges round a hub, or any ring with corners)
 * tumbles rather than rolls: sitting on a face, it is tipped over its leading
 * corner by adding the torque gravity puts against that to the spin control;
 * past the corner it falls onto the next face and the spin control brakes it.
 */
import type { SimContext } from '../SimContext';
import type { Structure } from '../Structure';
import type { StructurePart } from '../StructurePart';
import type { BreakableJoint } from '../BreakableJoint';
import type { RollSpec } from './CreatureTypes';
import type { Creature } from './Creature';
import { clamp } from '../../core/math';

/** Spin controller gain (1/s): how quickly it closes on its rolling speed. */
const SPIN_GAIN = 3;
/** Drive torque limit as a share of its weight times the hub height (spec.drive scales it). */
const DRIVE_TORQUE = 0.5;
/** Hub height below this share of its rest height = squashed flat. */
const FLAT_SHARE = 0.5;
/** A rim corner this close to the ground (m) is touching it (a polygon's pivot). */
const CONTACT = 0.15;

export class Wheel {
  readonly rim: StructurePart[];
  /** The joints between neighbouring rim parts (the ring is whole while all hold). */
  readonly seams: BreakableJoint[];
  /** Hub (mass centre of the rim), its velocity, and the ring's spin (rad/s, sim sense: + = clockwise on screen). */
  hubX = 0;
  hubY = 0;
  vx = 0;
  vy = 0;
  spin = 0;
  /** Rim mass (kg) and its moment of inertia about the hub (kg m², rim parts as points). */
  mass = 0;
  inertia = 0;
  /** Distance from the hub to the outer edge of the rim at rest (m). */
  readonly outer: number;
  /** Hub height above the ground at rest (m). */
  readonly restHeight: number;
  /** A polygon: tip it over its leading corner (RollSpec.tip). */
  private readonly tip: boolean;

  constructor(structure: Structure, spec: RollSpec) {
    this.tip = !!spec.tip;
    this.rim = spec.rim.map((n) => {
      const p = structure.part(n);
      if (!p) throw new Error(`Wheel: rim part "${n}" missing`);
      return p;
    });
    const set = new Set(this.rim);
    this.seams = structure.joints.filter((j) => !!j.b && set.has(j.a) && set.has(j.b));
    this.measure();
    let outer = 0;
    for (const p of this.rim) {
      const s = p.shape;
      const c = Math.cos(p.angle);
      const sn = Math.sin(p.angle);
      const pts = s.kind === 'poly' ? s.points : [0, 0];
      for (let i = 0; i < pts.length; i += 2) {
        const x = p.x + c * pts[i]! - sn * pts[i + 1]!;
        const y = p.y + sn * pts[i]! + c * pts[i + 1]!;
        outer = Math.max(outer, Math.hypot(x - this.hubX, y - this.hubY) + (s.kind === 'circle' ? s.r : 0));
      }
    }
    this.outer = outer;
    this.restHeight = -this.hubY;
  }

  /** Hub height above the ground (m). */
  get height(): number {
    return -this.hubY;
  }

  /** Rim touching (or within a few cm of) the ground. */
  get grounded(): boolean {
    return this.height - this.outer < 0.25;
  }

  /** Squashed flat: the hub has sunk to under half its rest height. */
  get flat(): boolean {
    return this.height < this.restHeight * FLAT_SHARE;
  }

  /**
   * Does this rim part's outer face look toward (x, y)? Rounds from there can
   * reach it; otherwise the rim in front of it soaks them up. `margin` is the
   * cosine it must face by (0 = side on).
   */
  faces(p: StructurePart, x: number, y: number, margin = 0.2): boolean {
    const nx = p.x - this.hubX;
    const ny = p.y - this.hubY;
    const dx = x - p.x;
    const dy = y - p.y;
    return nx * dx + ny * dy > margin * Math.hypot(nx, ny) * Math.hypot(dx, dy);
  }

  /** Is the ring still closed: every rim part there and unwrecked, every seam holding? */
  intact(): boolean {
    for (const p of this.rim) if (p.removed || p.wrecked) return false;
    for (const j of this.seams) if (j.broken) return false;
    return true;
  }

  /** Update the hub, its velocity and the ring's spin from the rim parts. */
  measure(): void {
    let m = 0;
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    for (const p of this.rim) {
      if (p.removed) continue;
      m += p.mass;
      x += p.x * p.mass;
      y += p.y * p.mass;
      vx += p.vx * p.mass;
      vy += p.vy * p.mass;
    }
    if (m <= 0) return;
    x /= m;
    y /= m;
    vx /= m;
    vy /= m;
    let L = 0;
    let I = 0;
    for (const p of this.rim) {
      if (p.removed) continue;
      const rx = p.x - x;
      const ry = p.y - y;
      L += p.mass * (rx * (p.vy - vy) - ry * (p.vx - vx));
      I += p.mass * (rx * rx + ry * ry);
    }
    this.hubX = x;
    this.hubY = y;
    this.vx = vx;
    this.vy = vy;
    this.mass = m;
    this.inertia = I;
    this.spin = I > 0 ? L / I : 0;
  }

  /**
   * Turn the ring toward rolling at `speed` (m/s, toward the turret):
   * `strength` scales the torque limit.
   */
  drive(speed: number, strength: number, gravity: number, dt: number): void {
    if (this.inertia <= 0) return;
    // Rolling without slipping: the hub moves at spin x hub height (rolling left = spinning counter-clockwise).
    const h = Math.max(this.outer * 0.5, this.height);
    const target = -speed / h;
    // Inertia about the point touching the ground (plus a little for the rim parts' own turning).
    const J = this.inertia * 1.05 + this.mass * h * h;
    const cap = this.mass * gravity * h * DRIVE_TORQUE * strength;
    // (A polygon also needs what lifts it over its leading corner: counter-clockwise, like rolling left.)
    const lift = this.tip ? this.tipTorque(gravity) : 0;
    const tau = clamp(J * SPIN_GAIN * (target - this.spin) - lift, -cap, cap);
    // Every rim part pulled along the ring in proportion to its mass and
    // distance from the hub: a pure torque (the pulls cancel out).
    const a = (tau / this.inertia) * dt;
    for (const p of this.rim) {
      if (p.removed) continue;
      const k = p.mass * a;
      p.body.applyImpulse({ x: -(p.y - this.hubY) * k, y: (p.x - this.hubX) * k }, true);
    }
  }

  /**
   * Torque (N m) gravity holds it back with about its leading corner on the
   * ground (the front-most rim corner touching it): its weight times how far
   * the hub still sits behind that corner. 0 once the hub is over or past it,
   * or with nothing on the ground.
   */
  private tipTorque(gravity: number): number {
    let pivot = Infinity;
    for (const p of this.rim) {
      if (p.removed || p.shape.kind !== 'poly') continue;
      const c = Math.cos(p.angle);
      const s = Math.sin(p.angle);
      const pts = p.shape.points;
      for (let i = 0; i < pts.length; i += 2) {
        // (Sim y points down: the ground is y = 0.)
        const y = p.y + s * pts[i]! + c * pts[i + 1]!;
        if (y < -CONTACT) continue;
        pivot = Math.min(pivot, p.x + c * pts[i]! - s * pts[i + 1]!);
      }
    }
    return pivot < this.hubX ? this.mass * gravity * (this.hubX - pivot) : 0;
  }

  /** The ring bursts: every seam still holding tears, and the rim parts fly out from the hub. */
  burst(ctx: SimContext, speed: number): void {
    for (const j of this.seams) if (!j.broken) ctx.physics.breakJoint(j, 'damage');
    for (const p of this.rim) {
      if (p.removed || !p.body.isDynamic()) continue;
      let dx = p.x - this.hubX;
      let dy = p.y - this.hubY;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      // Outward, with a little lift (y is down) and a random tumble.
      const J = p.mass * speed;
      p.body.applyImpulse({ x: dx * J, y: (dy - 0.45) * J }, true);
      p.body.applyTorqueImpulse((ctx.rng.next() - 0.5) * p.mass * p.extent * speed, true);
    }
  }
}

/**
 * The weak points of a rolling creature a gun at (x, y) can hurt right now:
 * those whose outer face looks toward it (the rest of the ring is in the way
 * of the others), in weak-point order. With a roaming weak spot, only that
 * part counts (everything else deflects rounds).
 */
export function exposedWeakPoints(c: Creature, x: number, y: number): StructurePart[] {
  const w = c.wheel;
  if (!w) return [];
  const open = (q: StructurePart | null | undefined): q is StructurePart => !!q && !q.removed && !q.wrecked && c.owns(q) && w.faces(q, x, y);
  if (c.weakSpot) return open(c.weakSpot) ? [c.weakSpot] : [];
  const out: StructurePart[] = [];
  for (const n of c.spec.weakPoints ?? []) {
    const q = c.structure.part(n);
    if (open(q)) out.push(q);
  }
  return out;
}
