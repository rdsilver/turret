/**
 * Live bookkeeping for one level attempt (shots, ammo cost, timing, winning
 * shot) that produces the LevelOutcome for scoring. Engine-agnostic: used by
 * GameScene and headless tools. OWNER: meta agent.
 */
import type { Simulation } from '../sim/Simulation';
import type { LevelDef } from './LevelDefinition';
import type { LevelOutcome } from './Economy';

export class LevelSession {
  shots = 0;
  ammoCost = 0;
  startedAt = 0;
  winningShot = 0;
  metAt = -1;

  constructor(
    readonly sim: Simulation,
    readonly level: LevelDef,
  ) {
    this.startedAt = sim.physics.simTime;
  }

  /** Record a player shot. */
  onShot(ammoId: string, cost: number): void {
    void ammoId;
    this.shots++;
    this.ammoCost += cost;
  }

  /** Build the outcome once the collapse has settled. */
  outcome(): LevelOutcome {
    const s = this.sim.structure;
    const chain = this.sim.chains.largest;
    return {
      level: this.level,
      shots: this.shots,
      ammoCost: this.ammoCost,
      time: (this.metAt >= 0 ? this.metAt : this.sim.physics.simTime) - this.startedAt,
      destroyedFraction: s ? s.fallenFraction : 0,
      chainJoints: chain?.joints ?? 0,
      chainParts: chain?.parts ?? 0,
      chainMass: chain?.mass ?? 0,
      jointsBroken: s?.jointsBroken ?? 0,
      partsFallen: s?.partsFallen ?? 0,
      winningShot: this.winningShot || this.shots,
      salvage: 0,
      totalMass: s?.trackedMass ?? 0,
    }; // IMPLEMENT salvage + listen for objectiveComplete to set metAt/winningShot
  }

  dispose(): void {}
}
