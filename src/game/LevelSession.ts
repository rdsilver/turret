/**
 * Live bookkeeping for one level attempt (shots, ammo cost, timing, winning
 * shot) that produces the LevelOutcome for scoring. Engine-agnostic: used by
 * GameScene and headless tools. OWNER: meta agent.
 *
 * GameScene also writes `metAt` / `winningShot` from its own objectiveComplete
 * handler (registered first); the session only fills them in when nobody else
 * did, so headless tools get the same numbers without extra wiring.
 */
import type { Simulation } from '../sim/Simulation';
import type { LevelDef } from './LevelDefinition';
import type { LevelOutcome } from './Economy';

/** Pulverised parts (shattered / blown up) are worth less than intact fallen members. */
const DESTROYED_SALVAGE = 0.5;

export class LevelSession {
  shots = 0;
  ammoCost = 0;
  startedAt = 0;
  winningShot = 0;
  metAt = -1;
  /** Sim time of the first shot (-1 = none yet). */
  firstShotAt = -1;
  /** Shots per ammo id, e.g. { standard: 2, explosive: 1 }. */
  readonly ammoUsed: Record<string, number> = {};

  private offs: Array<() => void> = [];
  private disposed = false;

  constructor(
    readonly sim: Simulation,
    readonly level: LevelDef,
  ) {
    this.startedAt = sim.physics.simTime;
    this.offs.push(
      sim.events.on('objectiveComplete', () => {
        if (this.metAt < 0) this.metAt = sim.physics.simTime;
        if (this.winningShot <= 0) this.winningShot = this.shots;
      }),
    );
  }

  /** Record a player shot. */
  onShot(ammoId: string, cost: number): void {
    if (this.shots === 0) this.firstShotAt = this.sim.physics.simTime;
    this.shots++;
    this.ammoCost += cost;
    this.ammoUsed[ammoId] = (this.ammoUsed[ammoId] ?? 0) + 1;
  }

  /** Sim seconds since the level started (or until the objective was met). */
  get elapsed(): number {
    return (this.metAt >= 0 ? this.metAt : this.sim.physics.simTime) - this.startedAt;
  }

  /**
   * Salvage value of the fallen material: sum of mass * material.salvage over
   * structure parts that fell (latched), pulverised parts at a discount.
   * O(parts), called once when results are shown.
   */
  salvage(): number {
    const s = this.sim.structure;
    if (!s) return 0;
    let sum = 0;
    for (const p of s.parts) {
      if (!p.fallen || p.isFoundation || p.isFragment) continue;
      sum += p.mass * p.material.salvage * (p.destroyed ? DESTROYED_SALVAGE : 1);
    }
    return sum;
  }

  /** Build the outcome once the collapse has settled. */
  outcome(): LevelOutcome {
    const s = this.sim.structure;
    const chain = this.sim.chains.largest ?? this.sim.chains.current;
    return {
      level: this.level,
      shots: this.shots,
      ammoCost: this.ammoCost,
      time: this.elapsed,
      destroyedFraction: s ? Math.min(1, s.fallenFraction) : 0,
      chainJoints: chain?.joints ?? 0,
      chainParts: chain?.parts ?? 0,
      chainMass: chain?.mass ?? 0,
      jointsBroken: s?.jointsBroken ?? 0,
      partsFallen: s?.partsFallen ?? 0,
      winningShot: this.winningShot || this.shots,
      salvage: this.salvage(),
      totalMass: s?.trackedMass ?? 0,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
