/**
 * StructureGenerator: assembles structures from registered MODULES with
 * controlled, seeded randomness.
 *
 * A BlueprintDef is plain data (JSON-serialisable): a list of module specs,
 * stacked bottom-to-top by default. Every module receives a context with the
 * current "cursor" (base height, center x, available width) and returns the
 * parts it created plus the new top. The same blueprint + seed always yields
 * the same StructureDef (daily challenges / shared seeds).
 */
import { Random } from '../../core/Random';
import type { StructureDef } from '../StructureDefinition';
import { StructureDraft } from './StructureDraft';
import { overlapRegion, separation } from './modules/geom';
import { DEFAULT_SIZING, sizeJoints } from './modules/sizing';

/** One module instance in a blueprint. Extra keys are module parameters. */
export interface ModuleSpec {
  type: string;
  /** Horizontal center offset (m) relative to the blueprint origin. Default: cursor x. */
  x?: number;
  /** Base height (m). Default: the previous module's top ("stack on top"). */
  y?: number;
  /** Do not advance the cursor (side attachments, props). */
  detached?: boolean;
  /** No automatic welds between this module's parts and other modules / the ground (it rests by gravity). */
  loose?: boolean;
  /** Strength multiplier for the automatic welds joining this module to its neighbours (min of both sides). */
  seamStrength?: number;
  [param: string]: unknown;
}

/** Where a previously built module sits (so later modules can attach to it, e.g. braces). */
export interface ModuleRegion {
  type: string;
  index: number;
  parts: number[];
  /** Height (m) the module was built on. */
  baseY: number;
  /** Its top (m). */
  top: number;
  /** Center x at its top. */
  x: number;
  /** Width at its top. */
  width: number;
}

export interface BlueprintDef {
  name?: string;
  modules: ModuleSpec[];
  /** Auto-weld touching parts across module boundaries (default true). */
  weldBetween?: boolean;
  /** Strength multiplier for the auto-welds between modules. */
  interModuleStrength?: number;
  /**
   * Load-aware joint sizing (default on): welds that carry static vertical load get at least
   * `factor` x that load as yield force, so heavy stacks don't sit at yield after settling.
   * false = off, a number = custom factor (default 1.35). See modules/sizing.ts.
   */
  autoSize?: boolean | number;
  /**
   * Tether joint-less resting parts (loose props, balanced weights, dry voussoirs) to what they
   * rest on with a slack, weak cable tagged 'tether' (default true). It carries no load at rest
   * and snaps as soon as the part really moves away; it keeps the part out of the physics
   * world's loose-debris sleeper while the structure stands (see TETHER in StructureGenerator).
   */
  tether?: boolean;
}

/** Slack (m) and strength of tether cables: never engaged at rest, snap on real separation. */
export const TETHER = { slack: 0.03, strength: 0.02, tag: 'tether' } as const;

export interface ModuleContext {
  draft: StructureDraft;
  rng: Random;
  spec: ModuleSpec;
  /** Height (m above ground) where this module sits. */
  baseY: number;
  /** Center x (definition space). */
  x: number;
  /** Width of the module below (m) — a hint for sizing. */
  width: number;
  /** Index of this module in the blueprint. */
  index: number;
  /** The last non-detached, non-passive module built before this one (null for the first). */
  prev: ModuleRegion | null;
  /** Every module built so far, in order. */
  regions: readonly ModuleRegion[];
}

export interface ModuleResult {
  parts: number[];
  /** New top height (m). */
  top: number;
  /** Footprint width at the top (m). */
  width: number;
  /** Center x at the top. */
  x: number;
  /**
   * The module decorates the previous one (braces, props, hanging weights):
   * the cursor and `prev` are left unchanged, as if the spec were `detached`.
   */
  passive?: boolean;
}

export type ModuleFn = (ctx: ModuleContext) => ModuleResult;

const modules = new Map<string, ModuleFn>();

export function registerModule(type: string, fn: ModuleFn): void {
  modules.set(type, fn);
}

export function moduleTypes(): string[] {
  return [...modules.keys()];
}

export function hasModule(type: string): boolean {
  return modules.has(type);
}

/** Read a numeric param with default, optionally jittered by the seeded rng. */
export function param(ctx: ModuleContext, key: string, fallback: number, jitter = 0): number {
  const v = ctx.spec[key];
  const base = typeof v === 'number' ? v : fallback;
  return jitter > 0 ? base * (1 + (ctx.rng.next() * 2 - 1) * jitter) : base;
}

export function paramStr<T extends string>(ctx: ModuleContext, key: string, fallback: T): T {
  const v = ctx.spec[key];
  return (typeof v === 'string' ? v : fallback) as T;
}

export function paramBool(ctx: ModuleContext, key: string, fallback: boolean): boolean {
  const v = ctx.spec[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** Build a StructureDef from a blueprint. */
export function generateStructure(blueprint: BlueprintDef, seed: number, originX: number): StructureDef {
  const rng = new Random(seed);
  const draft = new StructureDraft(rng);
  let cursorY = 0;
  let cursorX = 0;
  let width = 6;
  let prev: ModuleRegion | null = null;
  const regions: ModuleRegion[] = [];
  const moduleParts: number[][] = [];
  const seamStrength: (number | undefined)[] = [];
  blueprint.modules.forEach((spec, index) => {
    const fn = modules.get(spec.type);
    if (!fn) throw new Error(`Unknown structure module "${spec.type}" (known: ${moduleTypes().join(', ')})`);
    const ctx: ModuleContext = {
      draft,
      rng: rng.fork(`${index}:${spec.type}`),
      spec,
      baseY: spec.y ?? cursorY,
      x: spec.x ?? cursorX,
      width,
      index,
      prev,
      regions,
    };
    const r = fn(ctx);
    moduleParts.push(r.parts);
    seamStrength.push(typeof spec.seamStrength === 'number' ? spec.seamStrength : undefined);
    if (spec.loose === true) draft.markLoose(r.parts);
    const region: ModuleRegion = { type: spec.type, index, parts: r.parts, baseY: ctx.baseY, top: r.top, x: r.x, width: r.width };
    regions.push(region);
    if (!spec.detached && !r.passive) {
      cursorY = r.top;
      cursorX = r.x;
      width = r.width;
      prev = region;
    }
  });
  const owner = new Map<number, number>();
  moduleParts.forEach((list, m) => list.forEach((p) => owner.set(p, m)));
  if (blueprint.weldBetween !== false) {
    // Weld touching parts that belong to different modules (and anything on the ground).
    const base = blueprint.interModuleStrength;
    draft.autoWeld({
      strength: base,
      filter: (a, b) => !draft.loose.has(a) && (b === -1 || (!draft.loose.has(b) && owner.get(a) !== owner.get(b))),
      strengthOf: (a, b) => {
        const sa = seamStrength[owner.get(a) ?? -1];
        const sb = b >= 0 ? seamStrength[owner.get(b) ?? -1] : undefined;
        if (sa === undefined && sb === undefined) return undefined;
        return Math.min(sa ?? 1, sb ?? 1) * (base ?? 1);
      },
    });
  }
  if (blueprint.autoSize !== false) {
    const factor = typeof blueprint.autoSize === 'number' ? blueprint.autoSize : DEFAULT_SIZING.factor;
    sizeJoints(draft, { ...DEFAULT_SIZING, factor, weakFactor: Math.min(DEFAULT_SIZING.weakFactor, factor) });
  }
  if (blueprint.tether !== false) tetherLooseParts(draft);
  const def = draft.toDef(originX, blueprint.name);
  const warnings = findOverlaps(draft, owner, blueprint);
  def.meta = { ...def.meta, generator: 'blueprint', seed, ...(warnings.length ? { warnings } : {}) };
  return def;
}

/**
 * Give every part that has no joint at all a slack tether to the part it rests on (or the ground).
 */
function tetherLooseParts(draft: StructureDraft): void {
  const n = draft.parts.length;
  const count = new Array<number>(n).fill(0);
  const idx = (r: number | string): number => (typeof r === 'number' ? r : draft.parts.findIndex((p) => p.id === r));
  for (const j of draft.joints) {
    const a = idx(j.a);
    if (a >= 0) count[a]!++;
    if (j.b !== 'ground') {
      const b = idx(j.b);
      if (b >= 0) count[b]!++;
    }
  }
  const boxes = draft.parts.map((_, i) => draft.bounds(i));
  for (let i = 0; i < n; i++) {
    if (count[i]! > 0 || draft.parts[i]!.fixed) continue;
    const B = boxes[i]!;
    const cx = (B.minX + B.maxX) / 2;
    if (B.minY <= 0.03) {
      draft.cable(i, 'ground', [cx, B.minY], [cx, B.minY], { length: TETHER.slack, strength: TETHER.strength, tags: [TETHER.tag] });
      count[i]!++;
      continue;
    }
    // Touching neighbour with the lowest center (what it most likely rests on).
    let best = -1;
    let bestY = Infinity;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const K = boxes[k]!;
      if (K.minX > B.maxX + 0.05 || K.maxX < B.minX - 0.05 || K.minY > B.maxY + 0.05 || K.maxY < B.minY - 0.05) continue;
      if (separation(draft.parts[i]!, draft.parts[k]!) > 0.02) continue;
      const ky = (K.minY + K.maxY) / 2;
      if (ky < bestY) {
        bestY = ky;
        best = k;
      }
    }
    if (best < 0) continue;
    const K = boxes[best]!;
    const ax = (Math.max(B.minX, K.minX) + Math.min(B.maxX, K.maxX)) / 2;
    const ay = K.maxY <= B.minY + 0.05 ? (K.maxY + B.minY) / 2 : ((B.minY + B.maxY) / 2 + (K.minY + K.maxY) / 2) / 2;
    draft.cable(i, best, [ax, ay], [ax, ay], { length: TETHER.slack, strength: TETHER.strength, tags: [TETHER.tag] });
    count[i]!++;
    count[best]!++;
  }
}

/**
 * Design check: parts that overlap without a joint between them fight
 * through contacts and explode apart on load. Reported in def.meta.warnings
 * (tools/gen-lab.ts and tools/level-lab.ts users should keep this empty).
 */
function findOverlaps(draft: StructureDraft, owner: Map<number, number>, blueprint: BlueprintDef): string[] {
  const out: string[] = [];
  const n = draft.parts.length;
  const joined = new Set<number>();
  for (const j of draft.joints) {
    if (typeof j.a === 'number' && typeof j.b === 'number') joined.add(j.a * 100003 + j.b).add(j.b * 100003 + j.a);
  }
  const boxes = draft.parts.map((_, i) => draft.bounds(i));
  for (let a = 0; a < n; a++) {
    const A = boxes[a]!;
    for (let b = a + 1; b < n; b++) {
      const B = boxes[b]!;
      if (A.maxX <= B.minX + 0.01 || B.maxX <= A.minX + 0.01 || A.maxY <= B.minY + 0.01 || B.maxY <= A.minY + 0.01) continue;
      if (joined.has(a * 100003 + b)) continue;
      const r = overlapRegion(draft.parts[a]!, draft.parts[b]!);
      if (!r || r.area < 0.003) continue;
      const ma = blueprint.modules[owner.get(a) ?? -1]?.type ?? '?';
      const mb = blueprint.modules[owner.get(b) ?? -1]?.type ?? '?';
      out.push(`parts ${a} (${ma}) and ${b} (${mb}) overlap ${r.area.toFixed(3)} m^2 at (${r.x.toFixed(2)}, ${r.y.toFixed(2)}) without a joint`);
      if (out.length >= 12) return out;
    }
  }
  return out;
}
