/**
 * Decides whether a structure counts as destroyed, from its PHYSICAL state
 * (no hit points). Objectives are data and can be combined.
 *
 *  massBelowLine  – X% of the mass that started above a destruction line is now below it
 *  massFallen     – X% of the structure's (non-foundation) mass has fallen
 *  comDrop        – the center of mass dropped to X% of its original height
 *  coreDown       – every part tagged 'core' is below `height` m (touching the ground)
 *  disconnect     – parts tagged `tag` no longer connect to the ground through joints
 *  all / any      – combinators
 */
import type { Structure } from './Structure';

export type ObjectiveDef =
  | { kind: 'massBelowLine'; fraction: number; lineHeight?: number; lineFraction?: number }
  | { kind: 'massFallen'; fraction: number }
  | { kind: 'comDrop'; fraction: number }
  | { kind: 'coreDown'; height?: number }
  | { kind: 'disconnect'; tag: string; fraction?: number }
  | { kind: 'all'; of: ObjectiveDef[] }
  | { kind: 'any'; of: ObjectiveDef[] };

export const DEFAULT_OBJECTIVE: ObjectiveDef = { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 };

export class CollapseDetector {
  readonly objective: ObjectiveDef;
  readonly structure: Structure;
  /** Height (m above ground) of the destruction line to draw, if any. */
  readonly lineHeight: number | null;
  private dirty = true;
  private cachedDisconnect = new Map<string, number>();

  constructor(structure: Structure, objective: ObjectiveDef) {
    this.structure = structure;
    this.objective = objective;
    this.lineHeight = findLine(objective, structure);
    structure.setDestructionLine(this.lineHeight);
  }

  /** Call when joints break (connectivity may have changed). */
  markDirty(): void {
    this.dirty = true;
  }

  /** 0..1 progress toward the objective (1 = met). */
  progress(o: ObjectiveDef = this.objective): number {
    const s = this.structure;
    switch (o.kind) {
      case 'massBelowLine':
        return clamp01(s.belowLineFraction / o.fraction);
      case 'massFallen':
        return clamp01(s.fallenFraction / o.fraction);
      case 'comDrop': {
        // fraction = target height fraction (e.g. 0.4 => COM at 40% of original)
        const drop = s.comDropFraction;
        return clamp01(drop / Math.max(0.01, 1 - o.fraction));
      }
      case 'coreDown': {
        const h = o.height ?? 1.2;
        if (s.cores.length === 0) return 0;
        let sum = 0;
        for (const c of s.cores) {
          if (c.destroyed || c.removed) {
            sum += 1;
            continue;
          }
          const start = Math.max(h + 0.01, c.h0);
          sum += clamp01((start - c.height) / (start - h));
        }
        return sum / s.cores.length;
      }
      case 'disconnect': {
        const key = o.tag;
        if (this.dirty || !this.cachedDisconnect.has(key)) {
          const r = s.connectedToGround(o.tag);
          const frac = r.total > 0 ? 1 - r.connected / r.total : 0;
          this.cachedDisconnect.set(key, frac);
        }
        return clamp01(this.cachedDisconnect.get(key)! / (o.fraction ?? 1));
      }
      case 'all': {
        let min = 1;
        for (const c of o.of) min = Math.min(min, this.progress(c));
        return min;
      }
      case 'any': {
        let max = 0;
        for (const c of o.of) max = Math.max(max, this.progress(c));
        return max;
      }
    }
  }

  isMet(): boolean {
    const p = this.progress();
    this.dirty = false;
    return p >= 0.999;
  }

  describe(o: ObjectiveDef = this.objective): string {
    switch (o.kind) {
      case 'massBelowLine':
        return `Bring ${pct(o.fraction)} of the structure below the line`;
      case 'massFallen':
        return `Collapse ${pct(o.fraction)} of the structure`;
      case 'comDrop':
        return `Drop its center of mass to ${pct(o.fraction)} of its height`;
      case 'coreDown':
        return this.structure.cores.length > 1 ? 'Bring every core down to the ground' : 'Bring the core down to the ground';
      case 'disconnect':
        return `Cut the ${o.tag} parts off from the ground`;
      case 'all':
        return o.of.map((c) => this.describe(c)).join(' AND ');
      case 'any':
        return o.of.map((c) => this.describe(c)).join(' OR ');
    }
  }
}

function findLine(o: ObjectiveDef, s: Structure): number | null {
  if (o.kind === 'massBelowLine') return o.lineHeight ?? s.height0 * (o.lineFraction ?? 0.4);
  if (o.kind === 'all' || o.kind === 'any') {
    for (const c of o.of) {
      const l = findLine(c, s);
      if (l !== null) return l;
    }
  }
  return null;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function pct(f: number): string {
  return `${Math.round(f * 100)}%`;
}
