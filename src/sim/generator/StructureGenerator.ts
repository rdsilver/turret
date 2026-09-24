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

/** One module instance in a blueprint. Extra keys are module parameters. */
export interface ModuleSpec {
  type: string;
  /** Horizontal center offset (m) relative to the blueprint origin. Default: cursor x. */
  x?: number;
  /** Base height (m). Default: the previous module's top ("stack on top"). */
  y?: number;
  /** Do not advance the cursor (side attachments, props). */
  detached?: boolean;
  [param: string]: unknown;
}

export interface BlueprintDef {
  name?: string;
  modules: ModuleSpec[];
  /** Auto-weld touching parts across module boundaries (default true). */
  weldBetween?: boolean;
  /** Strength multiplier for the auto-welds between modules. */
  interModuleStrength?: number;
}

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
}

export interface ModuleResult {
  parts: number[];
  /** New top height (m). */
  top: number;
  /** Footprint width at the top (m). */
  width: number;
  /** Center x at the top. */
  x: number;
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
  const moduleParts: number[][] = [];
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
    };
    const r = fn(ctx);
    moduleParts.push(r.parts);
    if (!spec.detached) {
      cursorY = r.top;
      cursorX = r.x;
      width = r.width;
    }
  });
  if (blueprint.weldBetween !== false) {
    // Weld touching parts that belong to different modules (and anything on the ground).
    const owner = new Map<number, number>();
    moduleParts.forEach((list, m) => list.forEach((p) => owner.set(p, m)));
    draft.autoWeld({
      strength: blueprint.interModuleStrength,
      filter: (a, b) => b === -1 || owner.get(a) !== owner.get(b),
    });
  }
  const def = draft.toDef(originX, blueprint.name);
  def.meta = { ...def.meta, generator: 'blueprint', seed };
  return def;
}
