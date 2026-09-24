/**
 * Simulation facade: one arena worth of physics + gameplay systems.
 *
 * Used identically by the Phaser GameScene and by headless Node tools
 * (level validation, benchmarks). Contains no rendering code.
 */
import { EventBus } from '../core/EventBus';
import { Random } from '../core/Random';
import { PhysicsWorld } from './PhysicsWorld';
import type { SimEvents } from './SimEvents';
import type { SimContext } from './SimContext';
import { ProjectileSystem } from './weapons/ProjectileSystem';
import { ExplosionSystem } from './Explosions';
import { FractureSystem } from './Fracture';
import { StatusEffects } from './StatusEffects';
import { ChainReactionTracker } from './ChainReactionTracker';
import { DebrisManager } from './DebrisManager';
import { CollapseDetector, DEFAULT_OBJECTIVE, type ObjectiveDef } from './CollapseDetector';
import { Weapon, BASE_WEAPON_STATS, type WeaponStats } from './weapons/Weapon';
import type { AmmoDef } from './weapons/Ammo';
import { buildStructure } from './StructureBuilder';
import type { Structure } from './Structure';
import type { StructureDef } from './StructureDefinition';
import { StructurePart } from './StructurePart';
import { DEFAULT_GRAVITY, PHYSICS_DT, TURRET } from '../config/constants';
import { DEFAULT_AMMO } from '../data/ammo';

export type SimPhase = 'empty' | 'standing' | 'collapsing' | 'settled';

export interface SimulationOptions {
  seed?: number;
  gravity?: number;
  weaponStats?: WeaponStats;
  ammo?: AmmoDef;
}

/** Seconds of quiet (no failures) before a collapse counts as settled. */
const SETTLE_QUIET = 1.1;
const SETTLE_MIN = 1.6;
const SETTLE_MAX = 7;
const SETTLE_ACTIVE = 6;

export class Simulation implements SimContext {
  readonly events = new EventBus<SimEvents>();
  readonly rng: Random;
  readonly physics: PhysicsWorld;
  readonly projectiles: ProjectileSystem;
  readonly explosions: ExplosionSystem;
  readonly fracture: FractureSystem;
  readonly status: StatusEffects;
  readonly chains: ChainReactionTracker;
  readonly debris: DebrisManager;
  readonly weapon: Weapon;

  structure: Structure | null = null;
  detector: CollapseDetector | null = null;
  phase: SimPhase = 'empty';
  /** True while pre-settling a freshly built structure (views may ignore noise). */
  settling = false;
  objectiveMetAt = -1;
  private lastFailureAt = 0;

  constructor(opts: SimulationOptions = {}) {
    this.rng = new Random(opts.seed ?? 1);
    this.physics = new PhysicsWorld(this.events, opts.gravity ?? DEFAULT_GRAVITY);
    this.projectiles = new ProjectileSystem(this);
    this.explosions = new ExplosionSystem(this);
    this.fracture = new FractureSystem(this);
    this.status = new StatusEffects(this);
    this.chains = new ChainReactionTracker(this);
    this.debris = new DebrisManager(this);
    this.weapon = new Weapon(this, opts.weaponStats ?? BASE_WEAPON_STATS, opts.ammo ?? DEFAULT_AMMO);

    // Turret base is solid: rubble can pile against it.
    this.physics.addStaticBox(TURRET.x, -1.0, 1.7, 1.0);

    this.events.on('jointBroken', () => {
      this.lastFailureAt = this.physics.simTime;
      this.detector?.markDirty();
    });
    this.events.on('partFallen', () => (this.lastFailureAt = this.physics.simTime));
    this.events.on('partShattered', () => {
      this.lastFailureAt = this.physics.simTime;
      this.detector?.markDirty();
    });
    this.events.on('explosion', () => (this.lastFailureAt = this.physics.simTime));
    this.physics.addStepHook(() => this.stepPhase());
  }

  /**
   * Build a structure and let it settle under gravity before play starts, so
   * the player sees it at rest (and asleep).
   */
  loadStructure(def: StructureDef, objective: ObjectiveDef = DEFAULT_OBJECTIVE, settleSeconds = 2.5): Structure {
    this.clearStructure();
    const s = buildStructure(this.physics, def);
    this.structure = s;
    this.debris.reset();

    this.settling = true;
    this.chains.muted = true;
    const maxSteps = Math.round(settleSeconds / PHYSICS_DT);
    const minSteps = Math.round(0.5 / PHYSICS_DT);
    for (let i = 0; i < maxSteps; i++) {
      this.physics.step();
      if (i > minSteps && this.physics.stats.active === 0) break;
    }
    this.settling = false;
    this.chains.muted = false;
    // Whatever happened while settling is not gameplay: re-baseline metrics at the rest pose.
    s.rebaseline();
    this.detector = new CollapseDetector(s, objective);
    this.chains.reset();
    this.chains.setTrackedMass(s.trackedMass);
    // Put anything still barely moving to sleep; seed stress values for the heat map.
    for (const p of s.parts) {
      if (!p.fixed && !p.removed && Math.hypot(p.vx, p.vy) < 0.05 && Math.abs(p.av) < 0.05) p.body.sleep();
    }
    this.physics.evaluateAllJoints();
    this.phase = 'standing';
    this.objectiveMetAt = -1;
    this.lastFailureAt = this.physics.simTime;
    this.events.emit('structureLoaded', { partCount: s.parts.length, jointCount: s.joints.length });
    return s;
  }

  /** Remove the structure, rubble and projectiles (keeps the world). */
  clearStructure(): void {
    this.projectiles.clear();
    this.explosions.clear();
    this.status.clear();
    const ents = [...this.physics.entities.values()];
    for (const e of ents) if (e instanceof StructurePart) this.physics.removeEntity(e);
    this.structure = null;
    this.detector = null;
    this.phase = 'empty';
  }

  update(realDt: number): number {
    return this.physics.update(realDt);
  }

  fire() {
    return this.weapon.fire();
  }

  /** Objective progress 0..1. */
  get progress(): number {
    return this.detector ? this.detector.progress() : 0;
  }

  private stepPhase(): void {
    const d = this.detector;
    if (!d || this.settling) return;
    const now = this.physics.simTime;
    if (this.phase === 'standing') {
      if (d.isMet()) {
        this.phase = 'collapsing';
        this.objectiveMetAt = now;
        this.events.emit('objectiveComplete', { description: d.describe() });
      }
    } else if (this.phase === 'collapsing') {
      const since = now - this.objectiveMetAt;
      const quiet = now - this.lastFailureAt > SETTLE_QUIET;
      const calm = this.physics.stats.active <= SETTLE_ACTIVE;
      if ((since > SETTLE_MIN && quiet && calm) || since > SETTLE_MAX) {
        this.phase = 'settled';
        this.chains.finish();
        this.debris.beginCleanup();
        this.events.emit('collapseSettled', {});
      }
    }
  }

  destroy(): void {
    this.events.clear();
    this.physics.destroy();
  }
}
