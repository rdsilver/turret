/**
 * Weapon damage for small arms. A bullet can't snap a leg on momentum alone,
 * so hits wear parts down instead: each hit lowers the part's integrity
 * (armour absorbs a share) and weakens every joint attached to it. The
 * physics then does the breaking — a weakened knee buckles under the
 * creature's own weight and stride. At zero integrity the part is wrecked:
 * glass shatters, explosives detonate, anything else is torn off.
 */
import type { SimContext } from './SimContext';
import type { StructurePart } from './StructurePart';

/** Joint strength left at zero integrity just before the part is wrecked. */
export const MIN_JOINT_SCALE = 0.18;

export class DamageSystem {
  /** Global multiplier (difficulty, debug). */
  scale = 1;

  constructor(private readonly ctx: SimContext) {}

  /**
   * Apply `amount` damage points to a part at (x, y); `pierce` is the fraction
   * of its armour the round ignores. Returns damage actually dealt.
   */
  apply(part: StructurePart, amount: number, x: number, y: number, pierce = 0): number {
    if (part.removed || part.fixed || part.wrecked || amount <= 0) return 0;
    const armor = (part.material.armor ?? 0) * (1 - Math.min(1, Math.max(0, pierce)));
    const dealt = amount * this.scale * (1 - armor);
    const before = part.integrity;
    part.integrity = Math.max(0, part.integrity - dealt / part.maxHp);
    part.wear = Math.max(part.wear, 1 - part.integrity);
    // Engines run hot: a few hits overheat one long before it is destroyed.
    if (part.hasTag('engine')) part.heat = Math.min(1.6, part.heat + (dealt / part.maxHp) * 5);
    const jointScale = MIN_JOINT_SCALE + (1 - MIN_JOINT_SCALE) * part.integrity;
    const world = this.ctx.physics.world;
    for (let i = part.joints.length - 1; i >= 0; i--) {
      const j = part.joints[i]!;
      if (j.strengthScale > jointScale) j.setStrengthScale(world, jointScale, 0.5 + 0.5 * jointScale);
    }
    this.ctx.events.emit('partDamaged', { part, amount: dealt, integrity: part.integrity, x, y, armor });
    if (part.integrity <= 0 && before > 0) this.wreck(part, x, y);
    return dealt;
  }

  /** Destroy a part by damage (limb severed, plate torn off, tank bursts). */
  wreck(part: StructurePart, x: number, y: number): void {
    if (part.removed || part.wrecked) return;
    part.wrecked = true;
    const physics = this.ctx.physics;
    if (part.material.explosive) {
      this.ctx.explosions.detonate(part);
    } else if (part.material.shatter) {
      this.ctx.fracture.shatter(part, 4);
    } else {
      for (let i = part.joints.length - 1; i >= 0; i--) physics.breakJoint(part.joints[i]!, 'damage');
    }
    this.ctx.events.emit('partWrecked', { part, x, y });
  }
}
