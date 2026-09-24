/**
 * Turns a (serializable) StructureDef into live Rapier bodies + breakable
 * joints inside a PhysicsWorld. This is the ONLY place that converts from
 * definition space (y up, degrees) to simulation space (y down, radians).
 */
import { R, type RapierNS } from './RapierModule';
import type { PhysicsWorld } from './PhysicsWorld';
import { Structure } from './Structure';
import { StructurePart, type PartShape } from './StructurePart';
import { combineBond, material, MATERIALS, type BondProps, type MaterialId } from './Materials';
import type { JointDef, PartDef, PartRef, PartShapeDef, StructureDef } from './StructureDefinition';
import { GROUP, interactionGroups } from '../config/constants';
import { DEG, worldToLocal } from '../core/math';

const tmp = { x: 0, y: 0 };

export function toSimShape(s: PartShapeDef): PartShape {
  switch (s.kind) {
    case 'box':
      return { kind: 'box', hw: s.w / 2, hh: s.h / 2 };
    case 'circle':
      return { kind: 'circle', r: s.r };
    case 'poly': {
      // Flip y and reverse winding so the polygon stays counter-clockwise in y-down space.
      const pts: number[] = [];
      for (let i = s.points.length - 1; i >= 0; i--) {
        const p = s.points[i]!;
        pts.push(p[0], -p[1]);
      }
      return { kind: 'poly', points: pts };
    }
  }
}

export function colliderDescFor(shape: PartShape): RapierNS.ColliderDesc {
  const RAP = R();
  switch (shape.kind) {
    case 'box':
      return RAP.ColliderDesc.cuboid(shape.hw, shape.hh);
    case 'circle':
      return RAP.ColliderDesc.ball(shape.r);
    case 'poly': {
      const desc = RAP.ColliderDesc.convexHull(new Float32Array(shape.points));
      if (!desc) throw new Error('Invalid convex polygon');
      return desc;
    }
  }
}

export interface SpawnPartOptions {
  x: number;
  y: number;
  angle: number;
  vx?: number;
  vy?: number;
  av?: number;
  fragment?: boolean;
}

/** Create a single part body (sim-space transform). Used by the builder, fracture and debug spawners. */
export function spawnPart(physics: PhysicsWorld, def: PartDef, opts: SpawnPartOptions): StructurePart {
  const RAP = R();
  const mat = material(def.material);
  const shape = toSimShape(def.shape);
  const part = new StructurePart(def, mat, shape);
  part.isFragment = !!opts.fragment;
  const bodyDesc = (def.fixed ? RAP.RigidBodyDesc.fixed() : RAP.RigidBodyDesc.dynamic())
    .setTranslation(opts.x, opts.y)
    .setRotation(opts.angle)
    .setLinvel(opts.vx ?? 0, opts.vy ?? 0)
    .setAngvel(opts.av ?? 0);
  const body = physics.world.createRigidBody(bodyDesc);
  const membership = part.isFragment ? GROUP.DEBRIS : GROUP.STRUCTURE;
  const colDesc = colliderDescFor(shape)
    .setDensity(mat.density * (def.densityScale ?? 1))
    .setFriction(def.friction ?? mat.friction)
    .setRestitution(def.restitution ?? mat.restitution)
    .setCollisionGroups(interactionGroups(membership, 0xffff));
  const collider = physics.world.createCollider(colDesc, body);
  physics.register(part, body, collider);
  part.x0 = part.x;
  part.y0 = part.y;
  part.angle0 = part.angle;
  part.h0 = -part.y;
  return part;
}

export function buildStructure(physics: PhysicsWorld, def: StructureDef): Structure {
  const structure = new Structure(def);
  def.parts.forEach((pd, i) => {
    const part = spawnPart(physics, pd, {
      x: def.originX + pd.x,
      y: -pd.y,
      angle: -(pd.angle ?? 0) * DEG,
    });
    part.structure = structure;
    part.index = i;
    structure.parts.push(part);
  });

  const resolve = (ref: PartRef): StructurePart => {
    if (typeof ref === 'number') {
      const p = structure.parts[ref];
      if (!p) throw new Error(`Joint references missing part index ${ref}`);
      return p;
    }
    const idx = def.parts.findIndex((p) => p.id === ref);
    if (idx < 0) throw new Error(`Joint references unknown part id "${ref}"`);
    return structure.parts[idx]!;
  };

  for (const jd of def.joints) {
    const a = resolve(jd.a);
    const b = jd.b === 'ground' ? null : resolve(jd.b);
    if (a === b) continue;
    if (a.fixed && (!b || b.fixed)) continue; // nothing to hold
    const joint = createJointFromDef(physics, def, jd, a, b);
    // Overlapping welded parts (e.g. a brace running into a column) must not fight
    // through contacts while the joint holds.
    if (b && joint.joint) {
      const c = a.collider.contactCollider(b.collider, 0);
      if (c && c.distance < -0.02) joint.joint.setContactsEnabled(false);
    }
    structure.joints.push(joint);
  }

  structure.finalize();
  return structure;
}

function createJointFromDef(physics: PhysicsWorld, def: StructureDef, jd: JointDef, a0: StructurePart, b0: StructurePart | null) {
  // Rapier needs a dynamic body on at least one side; keep the fixed one as B.
  let a = a0;
  let b = b0;
  if (a.fixed && b && !b.fixed) {
    a = b0!;
    b = a0;
  }
  const bondMat: MaterialId = jd.bond ?? (jd.kind === 'cable' ? 'cable' : weakerMaterial(a.material.id, b ? b.material.id : 'ground'));
  let bond: BondProps;
  if (jd.bond || jd.kind === 'cable') bond = material(bondMat).bond;
  else bond = combineBond(a.material.bond, b ? b.material.bond : MATERIALS.ground.bond);

  const strength = jd.strength ?? 1;
  const tags = jd.tags ?? [];

  if (jd.kind === 'cable') {
    // If A/B were swapped (fixed body moved to B) the anchors swap with them.
    const swapped = a !== a0;
    const ancA = swapped ? jd.anchorB : jd.anchorA;
    const ancB = swapped ? jd.anchorA : jd.anchorB;
    const pa = ancA ? toSim(def, ancA) : { x: a.x, y: a.y };
    const pb = ancB ? toSim(def, ancB) : b ? { x: b.x, y: b.y } : { x: a.x, y: a.y - 5 };
    worldToLocal(a.x, a.y, a.angle, pa.x, pa.y, tmp);
    const lax = tmp.x;
    const lay = tmp.y;
    let lbx = pb.x;
    let lby = pb.y;
    if (b) {
      worldToLocal(b.x, b.y, b.angle, pb.x, pb.y, tmp);
      lbx = tmp.x;
      lby = tmp.y;
    }
    const rest = jd.length ?? Math.hypot(pb.x - pa.x, pb.y - pa.y);
    return physics.createJoint({ kind: 'cable', a, b, lax, lay, lbx, lby, restLength: rest, bond, bondMaterial: bondMat, seam: 1, strength, tags });
  }

  let anchor: { x: number; y: number };
  let seam = jd.seam;
  if (jd.at) anchor = toSim(def, jd.at);
  else {
    const s = seamBetween(a.def, b ? b.def : null);
    if (s) {
      anchor = toSim(def, [s.x, s.y]);
      seam ??= s.length;
    } else {
      anchor = b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : { x: a.x, y: 0 };
    }
  }
  seam ??= Math.min(minDim(a.def.shape), b ? minDim(b.def.shape) : minDim(a.def.shape));

  worldToLocal(a.x, a.y, a.angle, anchor.x, anchor.y, tmp);
  const lax = tmp.x;
  const lay = tmp.y;
  let lbx = anchor.x;
  let lby = anchor.y;
  if (b) {
    worldToLocal(b.x, b.y, b.angle, anchor.x, anchor.y, tmp);
    lbx = tmp.x;
    lby = tmp.y;
  }
  return physics.createJoint({ kind: jd.kind, a, b, lax, lay, lbx, lby, restLength: 0, bond, bondMaterial: bondMat, seam, strength, tags });
}

function toSim(def: StructureDef, p: readonly [number, number]): { x: number; y: number } {
  return { x: def.originX + p[0], y: -p[1] };
}

function weakerMaterial(a: MaterialId, b: MaterialId): MaterialId {
  return MATERIALS[a].bond.tension <= MATERIALS[b].bond.tension ? a : b;
}

export function minDim(s: PartShapeDef): number {
  if (s.kind === 'box') return Math.min(s.w, s.h);
  if (s.kind === 'circle') return s.r * 1.2;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of s.points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return Math.min(maxX - minX, maxY - minY);
}

/** Axis-aligned bounds of a part def (definition space). Rotated boxes use their rotated extents. */
export function boundsOf(p: PartDef): { minX: number; maxX: number; minY: number; maxY: number; axisAligned: boolean } {
  const ang = ((p.angle ?? 0) % 180 + 180) % 180;
  const s = p.shape;
  if (s.kind === 'box') {
    const quarter = Math.abs(ang - 90) < 0.01;
    const aligned = ang < 0.01 || quarter || Math.abs(ang - 180) < 0.01;
    if (aligned) {
      const hw = (quarter ? s.h : s.w) / 2;
      const hh = (quarter ? s.w : s.h) / 2;
      return { minX: p.x - hw, maxX: p.x + hw, minY: p.y - hh, maxY: p.y + hh, axisAligned: true };
    }
    const c = Math.abs(Math.cos(ang * DEG));
    const sn = Math.abs(Math.sin(ang * DEG));
    const hw = (s.w / 2) * c + (s.h / 2) * sn;
    const hh = (s.w / 2) * sn + (s.h / 2) * c;
    return { minX: p.x - hw, maxX: p.x + hw, minY: p.y - hh, maxY: p.y + hh, axisAligned: false };
  }
  if (s.kind === 'circle') return { minX: p.x - s.r, maxX: p.x + s.r, minY: p.y - s.r, maxY: p.y + s.r, axisAligned: false };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  const c = Math.cos((p.angle ?? 0) * DEG);
  const sn = Math.sin((p.angle ?? 0) * DEG);
  for (const [lx, ly] of s.points) {
    const x = p.x + c * lx - sn * ly;
    const y = p.y + sn * lx + c * ly;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, maxX, minY, maxY, axisAligned: false };
}

/**
 * Contact seam between two axis-aligned boxes (definition space), or between
 * a part and the ground (b = null). Returns null if they don't touch.
 */
export function seamBetween(a: PartDef, b: PartDef | null, tol = 0.03): { x: number; y: number; length: number } | null {
  const A = boundsOf(a);
  if (!b) {
    if (Math.abs(A.minY) > tol) return null;
    return { x: (A.minX + A.maxX) / 2, y: 0, length: A.maxX - A.minX };
  }
  const B = boundsOf(b);
  const ox = Math.min(A.maxX, B.maxX) - Math.max(A.minX, B.minX);
  const oy = Math.min(A.maxY, B.maxY) - Math.max(A.minY, B.minY);
  // Horizontal seam (one on top of the other).
  if (ox > tol && Math.abs(oy) <= tol) {
    const y = A.maxY <= B.minY + tol ? (A.maxY + B.minY) / 2 : (B.maxY + A.minY) / 2;
    return { x: (Math.max(A.minX, B.minX) + Math.min(A.maxX, B.maxX)) / 2, y, length: ox };
  }
  // Vertical seam (side by side).
  if (oy > tol && Math.abs(ox) <= tol) {
    const x = A.maxX <= B.minX + tol ? (A.maxX + B.minX) / 2 : (B.maxX + A.minX) / 2;
    return { x, y: (Math.max(A.minY, B.minY) + Math.min(A.maxY, B.maxY)) / 2, length: oy };
  }
  return null;
}
