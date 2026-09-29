/**
 * Weapon damage for small arms. A bullet can't snap a leg on momentum alone,
 * so hits wear parts down instead: each hit lowers the part's integrity
 * (armour absorbs a share) and weakens every joint attached to it. The
 * physics then does the breaking — a weakened knee buckles under the
 * creature's own weight and stride. At zero integrity the part is wrecked:
 * glass shatters, explosives detonate, anything else is torn off. An
 * invulnerable part (StructurePart.invulnerable) shrugs hits off: the round
 * deflects (partDeflected) and nothing changes. A part tagged 'sturdy' (a
 * stone block) wears down without weakening its joints: it holds at full
 * strength until it breaks. With IMPACT_DAMAGE 'chips' the wear also takes
 * triangles out of the part's chip mesh where the round struck (Chips.ts):
 * real geometry for the rounds that follow.
 */
import type { SimContext } from './SimContext';
import type { StructurePart } from './StructurePart';
import { MAX_CHIP_EXTENT, buildChipMesh, chipAt, chipTarget } from './Chips';
import { IMPACT_DAMAGE } from '../config/constants';
import { hashString } from '../core/Random';

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
    if (part.invulnerable) {
      // Nothing wears down (no integrity loss, no weakened joints, no crater).
      this.ctx.events.emit('partDeflected', { part, x, y });
      return 0;
    }
    const armor = (part.material.armor ?? 0) * (1 - Math.min(1, Math.max(0, pierce)));
    const dealt = amount * this.scale * (1 - armor);
    const before = part.integrity;
    part.integrity = Math.max(0, part.integrity - dealt / part.maxHp);
    part.wear = Math.max(part.wear, 1 - part.integrity);
    // Engines run hot: a few hits overheat one long before it is destroyed.
    if (part.hasTag('engine')) part.heat = Math.min(1.6, part.heat + (dealt / part.maxHp) * 5);
    const jointScale = MIN_JOINT_SCALE + (1 - MIN_JOINT_SCALE) * part.integrity;
    const world = this.ctx.physics.world;
    for (let i = part.hasTag('sturdy') ? -1 : part.joints.length - 1; i >= 0; i--) {
      const j = part.joints[i]!;
      if (j.strengthScale > jointScale) j.setStrengthScale(world, jointScale, 0.5 + 0.5 * jointScale);
    }
    // (A part tagged 'noChips' keeps its shape: a gadget counting its own hits, like a shield bomb.)
    if (IMPACT_DAMAGE === 'chips' && !part.isFragment && part.extent <= MAX_CHIP_EXTENT && !part.hasTag('noChips')) this.chip(part, x, y);
    this.ctx.events.emit('partDamaged', { part, amount: dealt, integrity: part.integrity, x, y, armor });
    if (part.integrity <= 0 && before > 0) this.wreck(part, x, y);
    return dealt;
  }

  /**
   * Knock triangles out of the part's chip mesh around world point (x, y)
   * until as many are gone as its wear calls for (the mesh is made on the
   * first chip, seeded from the part's body so a replay cuts the same one).
   */
  private chip(part: StructurePart, x: number, y: number): void {
    let m = part.chips;
    if (!m) {
      if (Math.round((1 - part.integrity) * 20) === 0) return;
      m = part.chips = buildChipMesh(part.shape, hashString(`chips:${part.body.handle}`));
    }
    // (A strip one triangle thick could only lose its far ends: it keeps its shape.)
    if (m.chain) return;
    const want = chipTarget(m, part.integrity);
    if (m.chipped >= want) return;
    const dx = x - part.x;
    const dy = y - part.y;
    const c = Math.cos(part.angle);
    const s = Math.sin(part.angle);
    const lx = c * dx + s * dy;
    const ly = -s * dx + c * dy;
    const chips: number[] = [];
    while (m.chipped < want) {
      const i = chipAt(m, lx, ly);
      if (i < 0) break;
      chips.push(i);
    }
    if (chips.length) this.ctx.events.emit('partChipped', { part, chips, x, y });
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
