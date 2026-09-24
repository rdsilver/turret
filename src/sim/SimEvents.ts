/**
 * Every event the simulation publishes. Views (effects, audio, UI) and
 * gameplay trackers (chain reactions, scoring) subscribe to these; nothing in
 * the sim depends on who listens.
 *
 * Positions are simulation space (meters, y down).
 */
import type { Entity } from './Entity';
import type { StructurePart } from './StructurePart';
import type { BreakableJoint, BreakCause } from './BreakableJoint';
import type { Projectile } from './weapons/Projectile';
import type { MaterialId } from './Materials';

export interface ImpactEvent {
  entity: Entity;
  /** The other side of the contact if known (null = ground/static or unknown). */
  other: Entity | null;
  hitGround: boolean;
  x: number;
  y: number;
  /** Velocity change magnitude this step (m/s). */
  dv: number;
  /** Kinetic energy removed, approx 0.5*m*dv^2 (J). */
  energy: number;
  mass: number;
  material: MaterialId;
}

export interface JointBrokenEvent {
  joint: BreakableJoint;
  cause: BreakCause;
  x: number;
  y: number;
  /** Utilisation at failure (>= 1 means overloaded). */
  stress: number;
  /** Load the joint was rated for (N), useful to scale effects. */
  rating: number;
  materialA: MaterialId;
  materialB: MaterialId;
}

export interface JointStressedEvent {
  joint: BreakableJoint;
  x: number;
  y: number;
  /** 0..1 progress towards failure. */
  damage: number;
  /** Plastic deformation this report period (rad or m, normalised 0..1). */
  rate: number;
  material: MaterialId;
}

export interface ExplosionEvent {
  x: number;
  y: number;
  radius: number;
  power: number;
  source: 'material' | 'projectile' | 'debug';
}

export interface SimEvents {
  entityAdded: { entity: Entity };
  entityRemoved: { entity: Entity };
  /** Debris manager started fading an entity; it will be removed after `duration` seconds. */
  entityFading: { entity: Entity; duration: number };

  projectileFired: { projectile: Projectile; x: number; y: number; vx: number; vy: number; recoil: number };
  /** First (and subsequent strong) contacts of a projectile. */
  projectileImpact: {
    projectile: Projectile;
    target: Entity | null;
    hitGround: boolean;
    x: number;
    y: number;
    speed: number;
    impulse: number;
    first: boolean;
  };
  projectileExpired: { projectile: Projectile };

  impact: ImpactEvent;
  jointStressed: JointStressedEvent;
  jointBroken: JointBrokenEvent;
  /** A part lost its last joint (now free rubble). */
  partDetached: { part: StructurePart };
  /** A structure part fell (dropped past the fallen threshold) — fires once per part. */
  partFallen: { part: StructurePart };
  partShattered: { part: StructurePart; fragments: StructurePart[]; x: number; y: number };
  explosion: ExplosionEvent;

  /** Chain reaction bookkeeping (see ChainReactionTracker). */
  chainStarted: { chainId: number };
  chainUpdated: { chainId: number; joints: number; parts: number; mass: number };
  chainEnded: { chainId: number; joints: number; parts: number; mass: number; duration: number };
  /** Especially large structural failure: effects may slow time. 0..1 intensity. */
  bigCollapse: { intensity: number; x: number; y: number };

  structureLoaded: { partCount: number; jointCount: number };
  /** Objective satisfied (structure counts as destroyed). */
  objectiveComplete: { description: string };
  /** Objective complete AND motion has settled enough to show results. */
  collapseSettled: Record<string, never>;
}
