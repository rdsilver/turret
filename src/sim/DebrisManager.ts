/**
 * Decides when rubble stops mattering and fades it out.
 *
 * Rules
 *  - only entities that are loose (no joints), fragments or spent rounds;
 *  - only once they have been ASLEEP for a while (never mid-collapse);
 *  - fragments go quickly; big loose parts stay during play (they are part
 *    of the scene — ramps, rubble piles) unless the debris budget is exceeded;
 *  - after the level is won (`beginCleanup`) settled rubble fades in a
 *    staggered way so the player sees the wreck before it clears.
 * Checks run a few times per second over the candidate set only.
 */
import type { SimContext } from './SimContext';
import type { Entity } from './Entity';
import { StructurePart } from './StructurePart';

const CHECK_INTERVAL = 0.25;
const FRAGMENT_REST = 2.5;
const LOOSE_REST_CLEANUP = 0.6;
const DEBRIS_BUDGET = 350;
const FADE = 1.1;

export class DebrisManager {
  private candidates = new Set<StructurePart>();
  private fading = new Set<Entity>();
  private timer = 0;
  cleanup = false;
  private cleanupClock = 0;

  constructor(private readonly ctx: SimContext) {
    const ev = ctx.events;
    ev.on('partDetached', ({ part }) => this.candidates.add(part));
    ev.on('partShattered', ({ fragments }) => {
      for (const f of fragments) this.candidates.add(f);
    });
    ev.on('entityAdded', ({ entity }) => {
      if (entity instanceof StructurePart && (entity.isFragment || (!entity.structure && entity.joints.length === 0))) this.candidates.add(entity);
    });
    ev.on('entityRemoved', ({ entity }) => {
      if (entity instanceof StructurePart) this.candidates.delete(entity);
      this.fading.delete(entity);
    });
    ctx.physics.addStepHook((dt) => this.step(dt));
  }

  get candidateCount(): number {
    return this.candidates.size;
  }

  /** Level complete: start clearing settled rubble. */
  beginCleanup(): void {
    this.cleanup = true;
    this.cleanupClock = 0;
    // Everything unattached or fallen is now eligible.
    for (const e of this.ctx.physics.entities.values()) {
      if (e instanceof StructurePart && !e.fixed && (e.joints.length === 0 || e.fallen)) this.candidates.add(e);
    }
  }

  reset(): void {
    this.cleanup = false;
    this.candidates.clear();
    this.fading.clear();
  }

  fade(e: Entity, duration = FADE): void {
    if (e.removed || e.fading > 0) return;
    e.fading = duration;
    e.fadeDuration = duration;
    this.fading.add(e);
    this.ctx.events.emit('entityFading', { entity: e, duration });
  }

  private step(dt: number): void {
    // Progress fades every step (smooth for the view), remove when done.
    if (this.fading.size) {
      for (const e of this.fading) {
        e.fading -= dt;
        if (e.fading <= 0) {
          this.fading.delete(e);
          if (!e.removed) this.ctx.physics.removeEntity(e);
        }
      }
    }
    this.timer += dt;
    if (this.cleanup) this.cleanupClock += dt;
    if (this.timer < CHECK_INTERVAL) return;
    const dtc = this.timer;
    this.timer = 0;

    let budgetExcess = this.candidates.size - DEBRIS_BUDGET;
    let staggered = 0;
    for (const p of this.candidates) {
      if (p.removed) {
        this.candidates.delete(p);
        continue;
      }
      if (p.fading > 0) continue;
      const asleep = p.body.isSleeping();
      p.restTime = asleep ? p.restTime + dtc : 0;
      if (!asleep) continue;
      if (p.isFragment && p.restTime > FRAGMENT_REST) {
        this.fade(p, 0.8);
      } else if (this.cleanup && p.restTime > LOOSE_REST_CLEANUP && this.cleanupClock > 1.2) {
        // Stagger the cleanup so the wreck dissolves rather than vanishing at once.
        if (staggered < 6) {
          this.fade(p, FADE + this.ctx.rng.next() * 0.6);
          staggered++;
        }
      } else if (budgetExcess > 0 && p.restTime > 4) {
        this.fade(p, 0.8);
        budgetExcess--;
      }
    }
  }
}
