/**
 * Shared helpers for structure modules.
 */
import type { MaterialId } from '../../Materials';
import { MATERIALS } from '../../Materials';
import type { PartTag } from '../../StructureDefinition';
import type { ModuleContext } from '../StructureGenerator';
import type { PartOpts, StructureDraft } from '../StructureDraft';
import { centroidOf, signedArea, type Pt } from './geom';

/** `tags` param (comma separated string or array) plus extra tags. */
export function tagsOf(ctx: ModuleContext, ...extra: PartTag[]): PartTag[] | undefined {
  const t = ctx.spec.tags;
  let list: PartTag[] = [];
  if (typeof t === 'string') list = t.split(',').map((s) => s.trim()).filter(Boolean) as PartTag[];
  else if (Array.isArray(t)) list = t as PartTag[];
  for (const e of extra) if (!list.includes(e)) list = [...list, e];
  return list.length ? list : undefined;
}

export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Material param with validation (unknown ids fall back instead of crashing the builder). */
export function matParam(ctx: ModuleContext, key: string, fallback: MaterialId): MaterialId {
  const v = ctx.spec[key];
  return typeof v === 'string' && v in MATERIALS ? (v as MaterialId) : fallback;
}

/** Optional `id` param, suffixed when a module creates several named parts. */
export function idOf(ctx: ModuleContext, suffix?: string): string | undefined {
  const id = ctx.spec.id;
  if (typeof id !== 'string' || !id) return undefined;
  return suffix ? `${id}.${suffix}` : id;
}

/** True when the module sits directly on the ground. */
export function onGround(baseY: number): boolean {
  return baseY <= 0.001;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Symmetric random jitter in [-amount, amount] (0 = none) from the module's seeded stream. */
export function jitter(ctx: ModuleContext, amount: number): number {
  return amount > 0 ? (ctx.rng.next() * 2 - 1) * amount : 0;
}

/** 'left' | 'right' | -1 | 1 -> -1 / 1. */
export function sideParam(ctx: ModuleContext, key: string, fallback: 1 | -1): 1 | -1 {
  const v = ctx.spec[key];
  if (v === 'left' || v === -1) return -1;
  if (v === 'right' || v === 1) return 1;
  return fallback;
}

/** Bounding box of a set of parts. */
export function extentOf(ctx: ModuleContext, idx: number[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const i of idx) {
    const b = ctx.draft.bounds(i);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minY = Math.min(minY, b.minY);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * The highest part surface under (x, y): index of the part whose top is
 * closest below/at y within `range` m, or -1. Used to hang things below a beam.
 */
export function supportAt(ctx: ModuleContext, x: number, y: number, range = 0.6): number {
  let best = -1;
  let bestTop = -Infinity;
  for (let i = 0; i < ctx.draft.parts.length; i++) {
    const b = ctx.draft.bounds(i);
    if (x < b.minX + 0.02 || x > b.maxX - 0.02) continue;
    if (b.maxY > y + 0.05 || b.maxY < y - range) continue;
    if (b.maxY > bestTop) {
      bestTop = b.maxY;
      best = i;
    }
  }
  return best;
}

/**
 * Convex polygon given in coordinates relative to (x, y); the part is placed
 * at the polygon's centroid (so its origin = center of mass). Winding is
 * fixed to counter-clockwise. Returns the part index.
 */
export function polyAt(d: StructureDraft, x: number, y: number, pts: Pt[], material: MaterialId, o: PartOpts = {}): number {
  const ccw = signedArea(pts) < 0 ? pts.slice().reverse() : pts;
  const [cx, cy] = centroidOf(ccw);
  return d.poly(x + cx, y + cy, ccw.map(([px, py]) => [px - cx, py - cy] as [number, number]), material, o);
}
