/**
 * Runs one assault level: spawns waves on schedule, watches the defense line
 * (any active creature crossing it = level failed), declares victory when
 * every creature is stopped, and keeps the stats scoring needs.
 * Engine-agnostic: used by GameScene and headless tools.
 */
import type { Simulation } from '../sim/Simulation';
import type { Creature } from '../sim/creature/Creature';
import { DEFENSE_LINE_X, SPAWN_X, type AssaultLevelDef, type WaveEntry } from './AssaultLevel';

export type AssaultState = 'running' | 'won' | 'lost';

/** Extra speed (fraction) a creature has gained by the time it reaches the line. */
export const URGENCY = 0.6;

export interface AssaultOutcome {
  level: AssaultLevelDef;
  won: boolean;
  time: number;
  creatures: number;
  stopped: number;
  shots: number;
  hits: number;
  limbsSevered: number;
  /** Sum of creature bounties for creatures stopped. */
  bounty: number;
  /** 0..1 average of how far from the line each creature was stopped (1 = at its spawn point). */
  distanceScore: number;
  /** Closest any creature came to the line (m; negative = crossed). */
  closest: number;
}

export class AssaultSession {
  state: AssaultState = 'running';
  readonly startedAt: number;
  private queue: WaveEntry[];
  private spawned = 0;
  readonly creatures: Creature[] = [];
  shots = 0;
  hits = 0;
  limbsSevered = 0;
  private stopX = new Map<Creature, number>();
  closest = Infinity;
  breachedBy: Creature | null = null;
  /** Creatures that came from splits (a cut centipede's back half). */
  private extra = 0;
  endedAt = -1;
  private offs: Array<() => void> = [];

  constructor(
    readonly sim: Simulation,
    readonly level: AssaultLevelDef,
  ) {
    this.startedAt = sim.physics.simTime;
    this.queue = [...level.waves].sort((a, b) => a.at - b.at);
    const ev = sim.events;
    this.offs.push(
      ev.on('projectileFired', () => this.state === 'running' && this.shots++),
      ev.on('partDamaged', () => this.state === 'running' && this.hits++),
      ev.on('partWrecked', ({ part }) => {
        if (this.state === 'running' && part.hasTag('limb')) this.limbsSevered++;
      }),
      ev.on('creatureSplit', ({ creature, parent }) => {
        if (this.state !== 'running' || !this.creatures.includes(parent)) return;
        this.creatures.push(creature);
        this.extra++;
      }),
      ev.on('creatureNeutralized', ({ creature }) => {
        if (this.state === 'running' && !this.stopX.has(creature)) this.stopX.set(creature, creature.frontX);
      }),
    );
  }

  get elapsed(): number {
    return this.sim.physics.simTime - this.startedAt;
  }

  get total(): number {
    return this.level.waves.length + this.extra;
  }

  get stopped(): number {
    return this.stopX.size;
  }

  /** Seconds until the next creature enters (or -1 when all have spawned). */
  get nextSpawnIn(): number {
    const next = this.queue[0];
    return next ? Math.max(0, next.at - this.elapsed) : -1;
  }

  /** Call once per rendered frame (or physics step in tools). */
  update(): void {
    if (this.state !== 'running') return;
    const t = this.elapsed;
    while (this.queue.length && this.queue[0]!.at <= t) {
      const w = this.queue.shift()!;
      const c = this.sim.creatures.spawn(w.creature, w.x ?? SPAWN_X, w.params ?? {}, this.level.seed + this.spawned * 101);
      this.spawned++;
      this.creatures.push(c);
    }
    for (const c of this.creatures) {
      if (!c.active || c.core.removed) continue;
      // Big creatures reach the line with their front, long before their middle does.
      const d = c.frontX - DEFENSE_LINE_X;
      if (d < this.closest) this.closest = d;
      // They pick up speed as the line gets close.
      c.speedBoost = 1 + URGENCY * Math.max(0, Math.min(1, 1 - d / (SPAWN_X - DEFENSE_LINE_X)));
      // Only a creature still on the move breaches (one toppling over the line after it was stopped doesn't).
      if (d < 0 && (c.state === 'walking' || c.state === 'crippled')) {
        this.state = 'lost';
        this.breachedBy = c;
        this.endedAt = this.sim.physics.simTime;
        this.sim.events.emit('breach', { creature: c, x: c.x, y: c.core.y });
        return;
      }
    }
    if (this.queue.length === 0 && this.creatures.length > 0 && this.creatures.every((c) => !c.active)) {
      this.state = 'won';
      this.endedAt = this.sim.physics.simTime;
    }
  }

  outcome(): AssaultOutcome {
    let bounty = 0;
    let dist = 0;
    for (const c of this.creatures) {
      const x = this.stopX.get(c);
      if (x === undefined) continue;
      bounty += c.spec.bounty ?? 50;
      const spawnX = SPAWN_X;
      dist += Math.max(0, Math.min(1, (x - DEFENSE_LINE_X) / (spawnX - DEFENSE_LINE_X)));
    }
    const stopped = this.stopX.size;
    return {
      level: this.level,
      won: this.state === 'won',
      time: (this.endedAt >= 0 ? this.endedAt : this.sim.physics.simTime) - this.startedAt,
      creatures: this.total,
      stopped,
      shots: this.shots,
      hits: this.hits,
      limbsSevered: this.limbsSevered,
      bounty,
      distanceScore: stopped ? dist / stopped : 0,
      closest: this.closest === Infinity ? SPAWN_X - DEFENSE_LINE_X : this.closest,
    };
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }
}
