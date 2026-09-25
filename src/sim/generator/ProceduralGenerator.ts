/**
 * Seeded random structures assembled from modules (NOT random piles of
 * blocks). randomBlueprint(seed, difficulty 0..1) picks an ARCHETYPE and
 * composes it bottom-up (foundation -> storeys -> top), with difficulty
 * driving size, materials, bracing and redundancy. Every structure carries
 * exactly one deliberate, findable weakness (a weak column joint, an
 * unbraced storey, a volatile barrel, a slender pier, a keystone ...) and a
 * matching objective (coreDown when a core exists, else massBelowLine) and
 * par (1-3). Pure function of (seed, difficulty): same input, same level.
 *
 * Validated by tools/gen-lab.ts (stability for 40 seeds x 4 difficulties and
 * brute-force destroyability).
 */
import { Random, hashString } from '../../core/Random';
import type { BlueprintDef, ModuleSpec } from './StructureGenerator';
import type { ObjectiveDef } from '../CollapseDetector';
import type { MaterialId } from '../Materials';

export interface ProceduralLevel {
  name: string;
  blueprint: BlueprintDef;
  objective: ObjectiveDef;
  par: number;
}

type Archetype = 'tower' | 'masonry' | 'bridge' | 'arch' | 'crane' | 'pyramid' | 'twin';

interface Plan {
  name: string;
  modules: ModuleSpec[];
  core: boolean;
  /** Extra par for big / redundant structures. */
  parBonus: number;
  /** massBelowLine tuning. */
  fraction?: number;
  lineFraction?: number;
}

export function randomBlueprint(seed: number, difficulty: number): ProceduralLevel {
  const d = Math.max(0, Math.min(1, Number.isFinite(difficulty) ? difficulty : 0.5));
  const rng = new Random((hashString(`proc:${seed >>> 0}`) ^ Math.round(d * 1000)) >>> 0);
  const arch = pickArchetype(rng, d);
  const plan = BUILDERS[arch](rng, d);
  const objective: ObjectiveDef = plan.core
    ? { kind: 'coreDown' }
    : {
        kind: 'massBelowLine',
        fraction: plan.fraction ?? round2(0.45 + 0.15 * d + rng.range(-0.04, 0.04)),
        lineFraction: plan.lineFraction ?? round2(0.36 + 0.1 * d + rng.range(-0.03, 0.03)),
      };
  const par = Math.max(1, Math.min(3, 1 + (d > 0.34 ? 1 : 0) + (d > 0.74 ? 1 : 0) + plan.parBonus));
  // Joint sizing margin grows with difficulty (low levels keep joints closer to their static demand).
  const autoSize = round2(1.15 + 0.25 * d);
  return { name: plan.name, blueprint: { name: plan.name, modules: plan.modules, autoSize }, objective, par };
}

function pickArchetype(rng: Random, d: number): Archetype {
  const items: Archetype[] = ['tower', 'masonry', 'bridge', 'arch', 'crane', 'pyramid', 'twin'];
  const weights = [
    3, // tower: the backbone at every difficulty
    0.1 + d * 1.2, // masonry is heavy: rare early
    0.8 + d * 0.6,
    0.9,
    0.4 + d * 0.8,
    0.8 - d * 0.4,
    0.3 + d * 1.0,
  ];
  return rng.weighted(items, weights);
}

// ------------------------------------------------------------ helpers

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function frameMaterial(rng: Random, d: number): MaterialId {
  if (d < 0.4) return 'wood';
  if (d < 0.75) return rng.weighted<MaterialId>(['wood', 'concrete'], [3, 1]);
  return rng.weighted<MaterialId>(['wood', 'concrete', 'steel'], [1, 1.2, 1]);
}

function colWidth(m: MaterialId): number {
  return m === 'steel' ? 0.3 : m === 'concrete' ? 0.4 : 0.35;
}

const MAT_NAME: Partial<Record<MaterialId, string>> = { wood: 'Timber', concrete: 'Concrete', steel: 'Steel', stone: 'Stone' };

/** What sits on top of a frame-like structure. */
function topper(rng: Random, d: number, w: number, allowCore: boolean): { modules: ModuleSpec[]; core: boolean; label: string } {
  const choice = rng.weighted(['roof', 'weight', 'core', 'crates', 'none'], [2, 0.3 + 1.2 * d, allowCore ? 0.8 + d : 0, 0.6 + 0.6 * (1 - d), 0.5]);
  switch (choice) {
    case 'roof': {
      const style = rng.pick(['gable', 'gable', 'hip', 'shed', 'rafters']);
      // Concrete only as a thin slab: a solid concrete gable weighs ~10 t.
      if (d > 0.6 && rng.chance(0.35)) return { modules: [{ type: 'roof', style: 'slab', material: 'concrete', h: 0.3, overhang: 0.2 }], core: false, label: '' };
      return { modules: [{ type: 'roof', style, material: 'wood', overhang: 0.3 }], core: false, label: '' };
    }
    case 'weight':
      return { modules: [{ type: 'weight', w: round2(Math.min(w * 0.4, d < 0.75 ? 1.4 : 1.8)), h: round2(rng.range(0.8, 1.1)), material: d >= 0.75 ? 'steel' : 'concrete' }], core: false, label: 'Weighted' };
    case 'core':
      return { modules: [{ type: 'coreChamber', w: round2(Math.min(w, rng.range(2.8, 3.6))), h: 1.8, material: d >= 0.75 ? 'concrete' : 'wood', wallMaterial: d > 0.8 && rng.chance(0.4) ? 'glass' : undefined }], core: true, label: 'Vault' };
    case 'crates':
      return { modules: [{ type: 'explosiveCrate', count: w > 4.5 ? 2 : 1, gap: round2(w * 0.3) }], core: false, label: 'Powder' };
    default:
      return { modules: [], core: false, label: '' };
  }
}

// ------------------------------------------------------------ archetypes

const BUILDERS: Record<Archetype, (rng: Random, d: number) => Plan> = {
  /** Foundation -> 2..5 storeys of frames (braced with difficulty) -> roof / weight / core. */
  tower(rng, d) {
    const mat = frameMaterial(rng, d);
    const maxStoreys = mat === 'wood' ? (d < 0.75 ? 4 : 5) : d < 0.75 ? 3 : 4;
    let storeys = Math.max(2, Math.min(maxStoreys, Math.round(2 + d * 2.2 + rng.range(-0.6, 0.9))));
    const w = round2(rng.pick([4, 4.5, 5, 5.5]) + (d > 0.6 ? 0.5 : 0));
    // Solver envelope (tools/gen-lab.ts): 3-column braced frames settle reliably up to 3 storeys,
    // and only 2-column X-braced frames settle at 5 storeys.
    const columns = d > 0.5 && w >= 5 && storeys <= 3 && rng.chance(0.55) ? 3 : 2;
    // (chevron bracing is left to hand-made levels: under heavy tops it does not settle reliably)
    let brace = d < 0.22 ? 'none' : d < 0.5 ? rng.pick(['none', 'alt', 'single']) : d < 0.75 ? rng.pick(['alt', 'single', 'alt', 'x']) : rng.pick(['x', 'alt', 'x']);
    if (columns === 3 && (brace === 'single' || brace === 'x')) brace = 'alt';
    if (storeys >= 5) brace = 'x';
    if (storeys >= 4 && brace === 'single') brace = 'alt';
    if (mat === 'concrete' && brace === 'single') brace = 'alt';
    // Heavy columns + light beams only settle reliably unbraced (tools/gen-lab.ts matrix).
    const lightBeams = mat === 'concrete' && brace === 'none' && d < 0.75;
    storeys = Math.min(storeys, brace === 'none' ? 4 : storeys);
    const tower: ModuleSpec = {
      type: 'tower',
      storeys,
      w,
      h: round2(rng.range(2.5, 3.0)),
      columns,
      colW: colWidth(mat),
      material: mat,
      beamMaterial: lightBeams ? 'wood' : mat,
      brace,
      braceMaterial: d > 0.5 ? 'steel' : mat === 'concrete' ? 'wood' : mat,
      taper: storeys >= 4 && rng.chance(0.4) ? 0.3 : 0,
    };
    // One deliberate weakness, findable by looking.
    const weak = rng.weighted(['column', 'unbraced', 'barrel', 'glass'], [2, brace !== 'none' ? 2 : 0, d > 0.25 ? (d < 0.8 ? 2 : 1.2) : 0, d > 0.45 ? 0.6 : 0]);
    const extra: ModuleSpec[] = [];
    let label = '';
    if (weak === 'column') {
      tower.weakStorey = rng.int(0, Math.max(0, Math.min(1, storeys - 2)));
      tower.weakColumn = rng.int(0, columns - 1);
    } else if (weak === 'unbraced') {
      tower.skipBrace = rng.int(0, Math.min(1, storeys - 1));
    } else if (weak === 'barrel') {
      tower.braceFrom = 1; // the ground floor stays open around the barrel
      extra.push({ type: 'explosiveBarrel', inside: true, count: columns === 3 ? 1 : rng.int(1, 2), dx: columns === 3 ? round2(w / 4) : 0 });
      label = 'Volatile';
    } else {
      tower.glass = true;
      tower.braceFrom = 1;
      label = 'Glass';
    }
    const top = topper(rng, d, w, true);
    // A vault has to come all the way down: keep vault towers short below the top tier.
    if (top.core && d < 0.75) tower.storeys = Math.min(storeys, 3);
    const name = [label || top.label, MAT_NAME[mat], brace !== 'none' ? 'Braced' : '', 'Tower'].filter(Boolean).join(' ');
    return {
      name,
      modules: [{ type: 'foundation', w: round2(w + rng.range(1.2, 2.4)), h: 0.5 }, tower, ...extra, ...top.modules],
      core: top.core,
      // one-shot sweeps (tools/gen-lab.ts --oneshot): 3+ storey towers rarely fall to one shot early on
      parBonus: storeys >= 5 || (columns === 3 && brace !== 'none') || (storeys >= 3 && d < 0.34) ? 1 : 0,
    };
  },

  /** Brick walls between slabs, a doorway on the ground floor. */
  masonry(rng, d) {
    const w = round2(rng.range(3.6, 5.2));
    const storeys = 2; // 3-storey stone keeps crack their head joints while settling
    const mortar = round2(0.2 + d * 0.5);
    const brick = rng.pick([0.8, 1.0, 1.2]);
    const mods: ModuleSpec[] = [{ type: 'foundation', w: round2(w + 1.6), h: 0.5 }];
    for (let s = 0; s < storeys; s++) {
      mods.push({ type: 'wall', w, h: round2(rng.range(1.8, 2.2 + 0.4 * d)), brickW: brick, brickH: 0.45, mortar, material: 'stone', opening: s === 0 ? round2(rng.range(1.0, 1.6)) : 0, openingH: 1.6 });
      mods.push({ type: 'slab', w: round2(w + 0.4), h: 0.3, material: 'wood' });
    }
    // Weakness: the ground-floor doorway lintel is soft wood, or a barrel waits inside.
    const weak = rng.chance(0.5) ? 'lintel' : 'barrel';
    if (weak === 'lintel') mods[1] = { ...mods[1]!, lintel: 'wood' };
    const top = topper(rng, d, w, true);
    if (weak === 'barrel') {
      // Barrel stands in the doorway of the ground floor.
      mods.splice(3, 0, { type: 'explosiveBarrel', y: 0.5, x: 0, detached: true, w: 0.6, h: 0.9 });
    }
    return {
      name: [weak === 'barrel' ? 'Volatile' : top.label, 'Masonry', storeys > 2 ? 'Keep' : 'House'].filter(Boolean).join(' '),
      modules: [...mods, ...top.modules],
      core: top.core,
      parBonus: storeys > 2 ? 1 : 0,
      fraction: round2(0.45 + 0.15 * d),
    };
  },

  /** Two piers carrying a truss or deck with loads on it. */
  bridge(rng, d) {
    const span = round2(rng.range(7, 10));
    const pierH = round2(rng.range(2.5, 3.6));
    const pierMat: MaterialId = d < 0.5 ? 'wood' : rng.pick<MaterialId>(['stone', 'concrete', 'wood']);
    const deckKind = d < 0.3 ? 'platform' : rng.pick(['truss', 'truss', 'platform']);
    const steelTruss = d >= 0.75;
    const pierW = pierMat === 'wood' ? 0.4 : 0.5;
    const half = span / 2 - pierW / 2;
    const slender = rng.int(0, 1); // the weak pier
    const mods: ModuleSpec[] = [
      { type: 'foundation', w: round2(span + 1.5), h: 0.4 },
      { type: 'column', x: -half, detached: true, h: pierH, w: slender === 0 ? round2(pierW * 0.7) : pierW, material: pierMat, tags: slender === 0 ? 'weakpoint' : undefined },
      { type: 'column', x: half, detached: true, h: pierH, w: slender === 1 ? round2(pierW * 0.7) : pierW, material: pierMat, tags: slender === 1 ? 'weakpoint' : undefined },
    ];
    const deckY = 0.4 + pierH;
    if (deckKind === 'truss') {
      mods.push({ type: 'truss', x: 0, y: deckY, w: span, h: round2(rng.range(1.0, 1.4)), style: rng.pick(['warren', 'pratt', 'howe']), material: steelTruss ? 'steel' : 'wood', webT: 0.14, chordT: 0.2 });
    } else {
      mods.push({ type: 'platform', x: 0, y: deckY, w: span, h: 0.4, material: 'wood' });
    }
    // Cargo on the deck.
    const cargo = rng.weighted(['weights', 'hut', 'core'], [1.2, 1, 0.4 + d]);
    let core = false;
    if (cargo === 'weights') {
      mods.push({ type: 'weight', dx: round2(-span / 4), w: 1.2, h: 1, material: 'concrete', detached: true });
      mods.push({ type: 'weight', dx: round2(span / 4), w: 1.2, h: 1, material: d > 0.7 ? 'steel' : 'concrete' });
    } else if (cargo === 'hut') {
      mods.push({ type: 'frame', w: round2(span * 0.45), h: 2.2, material: 'wood' });
      mods.push({ type: 'roof', style: 'gable', material: 'wood' });
    } else {
      mods.push({ type: 'coreChamber', w: 2.8, h: 1.6, material: 'wood' });
      core = true;
    }
    return {
      name: `${core ? 'Vault ' : ''}${deckKind === 'truss' ? 'Truss' : 'Plank'} Bridge`,
      modules: mods,
      core,
      parBonus: 0,
      lineFraction: round2((0.4 + pierH * 0.5) / (deckY + 2.5)),
      fraction: 0.55,
    };
  },

  /** Voussoir arch carrying a deck and a small structure; the keystone is the obvious weakness. */
  arch(rng, d) {
    const span = round2(rng.range(3.6, 5.2));
    const mortar = d < 0.5 ? 0 : 0.5;
    const mods: ModuleSpec[] = [
      { type: 'arch', span, t: round2(rng.range(0.5, 0.65)), voussoirs: rng.pick([7, 9, 9, 11]), abutH: round2(rng.range(1.0, 1.6)), deck: true, mortar, material: 'stone', abutMaterial: d > 0.6 ? 'concrete' : 'stone' },
    ];
    const top = rng.weighted(['tower', 'weight', 'core'], [1.2, 1, 0.5 + d]);
    let core = false;
    if (top === 'tower') {
      mods.push({ type: 'tower', storeys: d < 0.5 ? 1 : 2, w: round2(span * 0.7), h: 2.2, material: 'wood' });
      mods.push({ type: 'roof', style: 'gable' });
    } else if (top === 'weight') {
      mods.push({ type: 'weight', w: 1.4, h: 1.1, material: 'concrete' });
    } else {
      mods.push({ type: 'coreChamber', w: round2(Math.min(3.2, span * 0.8)), h: 1.6, material: 'wood' });
      core = true;
    }
    // A weight on the deck pins the keystone: not a one-shot any more.
    return { name: `${core ? 'Vault ' : ''}${mortar > 0 ? 'Mortared' : 'Dry'} Stone Arch`, modules: mods, core, parBonus: top === 'weight' ? 1 : 0, fraction: 0.5 };
  },

  /** A crane: tower + cantilever jib with a hanging load and a counterweight. */
  crane(rng, d) {
    const mat = frameMaterial(rng, d * 0.8);
    const storeys = rng.int(1, d > 0.5 ? 3 : 2);
    const w = round2(rng.range(3, 4));
    const side = rng.pick(['left', 'right'] as const);
    const jib = round2(rng.range(5.5, 7));
    const overhang = round2(rng.range(2.4, 3.2));
    return {
      name: `${MAT_NAME[mat]} Crane`,
      modules: [
        { type: 'foundation', w: round2(w + 1.5), h: 0.5 },
        { type: 'tower', storeys, w, h: 2.6, material: mat, colW: colWidth(mat), brace: d > 0.4 ? 'alt' : 'none', braceMaterial: 'wood', weakStorey: 0, weakColumn: side === 'left' ? 0 : 1 },
        { type: 'cantilever', w: jib, overhang, side, beamH: 0.35, material: 'wood' },
        // A hanging load on a stiff braced tower never settles (solver limit): hang only from unbraced ones.
        d <= 0.4
          ? { type: 'counterweight', at: side, hang: round2(rng.range(1.0, 1.8)), w: 0.8, h: 0.7, material: 'concrete' }
          : { type: 'counterweight', at: side, w: 0.8, h: 0.7, material: 'concrete', detached: true },
        { type: 'counterweight', at: side === 'left' ? 'right' : 'left', w: 0.9, h: 0.8, material: 'concrete' },
      ],
      core: false,
      parBonus: 0,
      fraction: 0.5,
      lineFraction: 0.45,
    };
  },

  /** Stepped pyramid with a balanced weight or a core on a pedestal. */
  pyramid(rng, d) {
    const w = round2(rng.range(5, 7));
    const levels = rng.int(4, 6);
    const mods: ModuleSpec[] = [{ type: 'pyramid', w, levels, blockW: rng.pick([0.9, 1.0, 1.2]), blockH: 0.55, mortar: round2(0.3 + d * 0.5), material: 'stone', minTop: 1.4 }];
    const core = d > 0.35 && rng.chance(0.6);
    if (core) {
      mods.push({ type: 'column', w: 0.35, h: round2(rng.range(1.4, 2.2)), material: 'wood', tags: 'weakpoint' });
      mods.push({ type: 'coreChamber', w: 1.8, h: 1.2, wallT: 0.25, material: 'wood' });
    } else {
      mods.push({ type: 'weight', balanced: true, pedestalH: round2(rng.range(1.0, 1.8)), w: 1.4, h: 1.1, material: d > 0.6 ? 'steel' : 'concrete' });
    }
    return { name: core ? 'Pyramid Vault' : 'Balanced Pyramid', modules: mods, core, parBonus: 0, fraction: 0.4, lineFraction: 0.5 };
  },

  /** Two towers joined by a skybridge that carries the prize. */
  twin(rng, d) {
    const mat = frameMaterial(rng, d);
    const storeys = rng.int(2, d > 0.6 ? 4 : 3);
    const tw = round2(rng.range(2.6, 3.2));
    const gap = round2(rng.range(2.5, 3.5));
    const off = round2((tw + gap) / 2);
    const h = round2(rng.range(2.4, 2.8));
    const brace = d < 0.35 ? 'none' : rng.pick(['x', 'alt']);
    const weakSide = rng.int(0, 1);
    const tower = (x: number, weak: boolean): ModuleSpec => ({
      type: 'tower',
      x,
      storeys,
      w: tw,
      h,
      material: mat,
      colW: colWidth(mat),
      brace,
      braceMaterial: d > 0.5 ? 'steel' : 'wood',
      detached: true,
      weakStorey: weak ? 0 : -1,
      weakColumn: weak ? rng.int(0, 1) : -1,
      skipBrace: weak && brace !== 'none' ? 0 : -1,
    });
    const topY = 0.5 + storeys * (h + 0.3);
    const top = rng.weighted(['core', 'weight', 'hut'], [0.6 + d, 1, 1]);
    const mods: ModuleSpec[] = [
      { type: 'foundation', w: round2(tw * 2 + gap + 1.6), h: 0.5 },
      tower(-off, weakSide === 0),
      tower(off, weakSide === 1),
      { type: 'platform', x: 0, y: round2(topY), w: round2(tw * 2 + gap), h: 0.35, material: 'wood' },
    ];
    let core = false;
    if (top === 'core') {
      mods.push({ type: 'coreChamber', w: round2(gap + 0.6), h: 1.6, material: 'wood' });
      core = true;
    } else if (top === 'weight') {
      mods.push({ type: 'weight', w: 1.6, h: 1, material: 'concrete' });
    } else {
      mods.push({ type: 'frame', w: round2(gap + 1), h: 2, material: 'wood' });
      mods.push({ type: 'roof', style: 'gable' });
    }
    return { name: `${core ? 'Vault ' : ''}Twin ${MAT_NAME[mat]} Towers`, modules: mods, core, parBonus: storeys >= 4 ? 1 : 0 };
  },
};
