/**
 * Tracks chain reactions: everything that breaks or falls after a shot lands,
 * as long as failures keep following each other closely in time. Also detects
 * "big collapse" moments (many failures in a short window) that the effects
 * layer can celebrate with a brief slow motion.
 */
import type { SimContext } from './SimContext';

export interface ChainStats {
  id: number;
  joints: number;
  parts: number;
  mass: number;
  startedAt: number;
  lastEventAt: number;
  /** Player shot that started the chain (0 = not attributed to a shot). */
  shot: number;
}

/** A chain ends when nothing new has failed for this long (sim seconds). */
const CHAIN_GAP = 1.6;
const WINDOW = 0.7;
const BIG_JOINTS = 7;
const BIG_MASS_FRACTION = 0.22;
const BIG_COOLDOWN = 3.5;

export class ChainReactionTracker {
  current: ChainStats | null = null;
  largest: ChainStats | null = null;
  chains = 0;
  /** Total joints broken by chains (not debug/removal). */
  totalJoints = 0;
  /** Ignore everything (set while a level pre-settles). */
  muted = false;

  private nextId = 1;
  /** Throwaway stats object returned while muted. */
  private readonly scratch: ChainStats = { id: 0, joints: 0, parts: 0, mass: 0, startedAt: 0, lastEventAt: 0, shot: 0 };
  private recentBreaks: number[] = [];
  private recentMass: { t: number; m: number }[] = [];
  private lastBig = -100;
  private trackedMass = 1;

  constructor(private readonly ctx: SimContext) {
    const ev = ctx.events;
    ev.on('projectileImpact', (e) => {
      if (e.first) this.touch(e.projectile.shot);
    });
    ev.on('explosion', () => this.touch(0));
    ev.on('jointBroken', (e) => {
      if (e.cause === 'removed' || e.cause === 'debug') return;
      const c = this.touch(0);
      c.joints++;
      this.totalJoints++;
      this.recentBreaks.push(ctx.physics.simTime);
      this.emitUpdate();
      this.checkBig(e.x, e.y);
    });
    ev.on('partFallen', ({ part }) => {
      const c = this.touch(0);
      c.parts++;
      c.mass += part.mass;
      this.recentMass.push({ t: ctx.physics.simTime, m: part.mass });
      this.emitUpdate();
      this.checkBig(part.x, part.y);
    });
    ctx.physics.addStepHook(() => this.step());
  }

  setTrackedMass(m: number): void {
    this.trackedMass = Math.max(1, m);
  }

  reset(): void {
    this.current = null;
    this.largest = null;
    this.chains = 0;
    this.totalJoints = 0;
    this.recentBreaks.length = 0;
    this.recentMass.length = 0;
    this.lastBig = -100;
  }

  /** Get or start the current chain. A new shot always starts a new chain. */
  /**
   * Get or start the current chain. `shot` > 0 marks a projectile's first impact:
   * a DIFFERENT shot starts a new chain (sub-munitions share their shot id, and a
   * chain that has no shot yet — e.g. failures in the impact step itself — adopts it).
   */
  private touch(shot: number): ChainStats {
    if (this.muted) return this.scratch;
    const now = this.ctx.physics.simTime;
    const c0 = this.current;
    if (shot > 0 && c0) {
      if (c0.shot === 0) c0.shot = shot;
      else if (c0.shot !== shot && c0.joints + c0.parts > 0) this.end();
    }
    if (!this.current) {
      this.current = { id: this.nextId++, joints: 0, parts: 0, mass: 0, startedAt: now, lastEventAt: now, shot };
      this.chains++;
      this.ctx.events.emit('chainStarted', { chainId: this.current.id });
    }
    this.current.lastEventAt = now;
    return this.current;
  }

  private emitUpdate(): void {
    if (this.muted) return;
    const c = this.current;
    if (!c) return;
    this.ctx.events.emit('chainUpdated', { chainId: c.id, joints: c.joints, parts: c.parts, mass: c.mass });
  }

  private end(): void {
    const c = this.current;
    if (!c) return;
    this.current = null;
    if (!this.largest || score(c) > score(this.largest)) this.largest = { ...c };
    this.ctx.events.emit('chainEnded', {
      chainId: c.id,
      joints: c.joints,
      parts: c.parts,
      mass: c.mass,
      duration: c.lastEventAt - c.startedAt,
    });
  }

  private checkBig(x: number, y: number): void {
    if (this.muted) return;
    const now = this.ctx.physics.simTime;
    if (now - this.lastBig < BIG_COOLDOWN) return;
    while (this.recentBreaks.length && now - this.recentBreaks[0]! > WINDOW) this.recentBreaks.shift();
    while (this.recentMass.length && now - this.recentMass[0]!.t > WINDOW) this.recentMass.shift();
    let mass = 0;
    for (const r of this.recentMass) mass += r.m;
    const jointScore = this.recentBreaks.length / BIG_JOINTS;
    const massScore = mass / this.trackedMass / BIG_MASS_FRACTION;
    const intensity = Math.max(jointScore, massScore);
    if (intensity >= 1) {
      this.lastBig = now;
      this.ctx.events.emit('bigCollapse', { intensity: Math.min(2, intensity), x, y });
    }
  }

  private step(): void {
    const c = this.current;
    if (c && this.ctx.physics.simTime - c.lastEventAt > CHAIN_GAP) this.end();
  }

  /** Close any open chain (end of level) and return the largest. */
  finish(): ChainStats | null {
    this.end();
    return this.largest;
  }
}

function score(c: ChainStats): number {
  return c.joints * 2 + c.parts;
}
