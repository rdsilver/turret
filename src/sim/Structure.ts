/**
 * A built structure: parts + joints + incrementally maintained physical
 * metrics used by objectives and scoring. Metrics are only updated for parts
 * that are awake (sleeping parts cannot change state), so cost is O(active).
 */
import type { StructurePart } from './StructurePart';
import type { BreakableJoint } from './BreakableJoint';
import type { StructureDef } from './StructureDefinition';

export class Structure {
  readonly def: StructureDef;
  readonly parts: StructurePart[] = [];
  readonly joints: BreakableJoint[] = [];
  readonly byName = new Map<string, StructurePart>();
  readonly cores: StructurePart[] = [];

  /** Mass of non-foundation parts at spawn (kg). */
  trackedMass = 0;
  /** Mass that has fallen (latched per part). */
  fallenMass = 0;
  /** Mass that started above the destruction line. */
  lineMass = 0;
  /** Of `lineMass`, mass currently below the line. */
  belowLineMass = 0;
  /** Destruction line height above ground (m); null = none. */
  lineHeight: number | null = null;

  /** Sum of m*h over tracked parts (for center of mass height). */
  private comSum = 0;
  comHeight0 = 0;
  /** Highest point at spawn (m above ground). */
  height0 = 0;
  minX0 = 0;
  maxX0 = 0;

  jointsBroken = 0;
  partsFallen = 0;
  /** Joints that broke while pre-settling (a valid level has 0). */
  settleJointsBroken = 0;
  /** Largest displacement of any part while pre-settling (m). */
  settleDrift = 0;

  constructor(def: StructureDef) {
    this.def = def;
  }

  /** Called by the builder after all parts exist and have their spawn transforms. */
  finalize(): void {
    for (const p of this.parts) {
      if (p.name) this.byName.set(p.name, p);
      if (p.isCore) this.cores.push(p);
    }
    this.finalizeMetrics();
  }

  private finalizeMetrics(): void {
    let top = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    this.trackedMass = 0;
    this.comSum = 0;
    for (const p of this.parts) {
      if (p.removed || p.destroyed) continue;
      const hh = p.halfHeightNow;
      const hw = p.halfWidthNow;
      top = Math.max(top, p.h0 + hh);
      minX = Math.min(minX, p.x0 - hw);
      maxX = Math.max(maxX, p.x0 + hw);
      if (!p.isFoundation) {
        this.trackedMass += p.mass;
        this.comSum += p.mass * p.h0;
      }
    }
    this.height0 = top;
    this.minX0 = isFinite(minX) ? minX : 0;
    this.maxX0 = isFinite(maxX) ? maxX : 0;
    this.comHeight0 = this.trackedMass > 0 ? this.comSum / this.trackedMass : 0;
  }

  /** Reset spawn heights and failure counters to the current (settled) pose. */
  rebaseline(): void {
    this.settleJointsBroken += this.jointsBroken;
    for (const p of this.parts) {
      if (!p.removed) this.settleDrift = Math.max(this.settleDrift, Math.hypot(p.x - p.x0, p.y - p.y0));
    }
    this.fallenMass = 0;
    this.partsFallen = 0;
    this.jointsBroken = 0;
    for (const p of this.parts) {
      if (p.removed) continue;
      p.h0 = -p.y;
      p.x0 = p.x;
      p.y0 = p.y;
      p.angle0 = p.angle;
      p.fallen = false;
      p.belowLine = false;
    }
    this.finalizeMetrics();
  }

  setDestructionLine(height: number | null): void {
    this.lineHeight = height;
    this.lineMass = 0;
    this.belowLineMass = 0;
    for (const p of this.parts) {
      p.aboveLineAtStart = height !== null && !p.isFoundation && p.h0 > height;
      p.belowLine = false;
      if (p.aboveLineAtStart) this.lineMass += p.mass;
    }
  }

  /** Threshold drop (m) after which a part counts as fallen. */
  static fallThreshold(p: StructurePart): number {
    return Math.max(0.7, 0.3 * p.h0);
  }

  /**
   * Update metrics for a part that moved this step. `prevH` is the center
   * height before the step. Returns true when the part newly fell.
   */
  onPartMoved(p: StructurePart, prevH: number): boolean {
    if (p.isFoundation || p.isFragment) return false;
    const h = -p.y;
    this.comSum += p.mass * (h - prevH);
    if (p.aboveLineAtStart && this.lineHeight !== null) {
      const below = h < this.lineHeight;
      if (below !== p.belowLine) {
        p.belowLine = below;
        this.belowLineMass += below ? p.mass : -p.mass;
      }
    }
    if (!p.fallen && p.h0 - h > Structure.fallThreshold(p)) {
      p.fallen = true;
      this.fallenMass += p.mass;
      this.partsFallen++;
      return true;
    }
    return false;
  }

  /** A part was removed/shattered: count it as fully fallen and gone. */
  onPartDestroyed(p: StructurePart): void {
    if (p.isFoundation || p.isFragment) return;
    const h = -p.y;
    this.comSum -= p.mass * h; // contributes height 0 from now on
    if (p.aboveLineAtStart && !p.belowLine) {
      p.belowLine = true;
      this.belowLineMass += p.mass;
    }
    if (!p.fallen) {
      p.fallen = true;
      this.fallenMass += p.mass;
      this.partsFallen++;
    }
  }

  get fallenFraction(): number {
    return this.trackedMass > 0 ? this.fallenMass / this.trackedMass : 0;
  }

  get belowLineFraction(): number {
    return this.lineMass > 0 ? this.belowLineMass / this.lineMass : 0;
  }

  get comHeight(): number {
    return this.trackedMass > 0 ? this.comSum / this.trackedMass : 0;
  }

  /** 0..1: how far the center of mass has dropped relative to spawn. */
  get comDropFraction(): number {
    return this.comHeight0 > 0 ? 1 - this.comHeight / this.comHeight0 : 0;
  }

  part(name: string): StructurePart | undefined {
    return this.byName.get(name);
  }

  /** Parts tagged `tag` that are still connected (through joints) to the ground or a fixed part. */
  connectedToGround(tag: string): { total: number; connected: number } {
    const targets = this.parts.filter((p) => p.hasTag(tag));
    if (targets.length === 0) return { total: 0, connected: 0 };
    const seen = new Set<StructurePart>();
    const stack: StructurePart[] = [];
    for (const p of this.parts) {
      if (p.destroyed) continue;
      if (p.fixed || p.joints.some((j) => j.isGround && !j.broken)) {
        seen.add(p);
        stack.push(p);
      }
    }
    while (stack.length) {
      const p = stack.pop()!;
      for (const j of p.joints) {
        if (j.broken) continue;
        const o = j.other(p);
        if (o && !seen.has(o)) {
          seen.add(o);
          stack.push(o);
        }
      }
    }
    let connected = 0;
    for (const t of targets) if (!t.destroyed && seen.has(t)) connected++;
    return { total: targets.length, connected };
  }
}
