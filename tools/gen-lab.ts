/**
 * Generator lab: headless validation of the structure MODULES and of
 * ProceduralGenerator.randomBlueprint.
 *
 *   npx tsx tools/gen-lab.ts [--modules] [--proc] [--only a,b] [--seeds 40] [--diffs 0.1,0.4,0.7,1]
 *        [--brute 2] [--bruteMax 0.7] [--idle 8] [--png] [--gallery-seeds 1,2,3] [--verbose]
 *
 * With neither --modules nor --proc, both run.
 *  1. every module fixture (each module alone / in its natural combination) is built, pre-settled
 *     and left idle: reports settle breaks, idle breaks, idle drift, max joint stress, warnings
 *     (overlapping parts without joints) and bodies still awake when the 2.5 s pre-settle ended.
 *     STABLE = 0 breaks, drift < 0.08 m, idle progress < 5%, no explosions/shatters, no warnings,
 *     asleep before the settle window ends.
 *  2. randomBlueprint(seed, difficulty) for seeds x difficulties: same checks, plus brute-force
 *     destroyability (random-target shots with spread, up to 15) for difficulty <= --bruteMax.
 *  3. --png renders galleries into tools/out/gen-*.png.
 *  --oneshot adds a one-shot sweep per procedural level (direct fire, no spread, at every part):
 *     how many levels can be finished with a single well-aimed shot (par-1 sanity).
 *  4. --film 5@0.4,12@0.7 renders a collapse filmstrip per procedural level (at rest, then after
 *     each random-target shot) into tools/out/gen-film-<seed>-<diff>.png.
 */
import { mkdirSync } from 'node:fs';
import { initRapier, run, fireAt, snapshot, renderFilmstrip, STAT_PRESETS, type FrameSnap } from './lib/headless';
import { Simulation } from '../src/sim/Simulation';
import { Random } from '../src/core/Random';
import type { BlueprintDef } from '../src/sim/generator/StructureGenerator';
import type { ObjectiveDef } from '../src/sim/CollapseDetector';
import type { StructureDef } from '../src/sim/StructureDefinition';

await initRapier();
await import('../src/sim/generator/modules');
const { generateStructure } = await import('../src/sim/generator/StructureGenerator');
const { randomBlueprint } = await import('../src/sim/generator/ProceduralGenerator');

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : d;
};
const flag = (k: string) => args.includes(`--${k}`);
const films = opt('film', '').split(',').filter(Boolean);
const doModules = flag('modules') || (!flag('proc') && films.length === 0);
const doProc = flag('proc') || (!flag('modules') && films.length === 0);
const only = opt('only', '').split(',').filter(Boolean);
const seeds = Number(opt('seeds', '40'));
const seed0 = Number(opt('seed0', '1'));
const diffs = opt('diffs', '0.1,0.4,0.7,1').split(',').map(Number);
const brute = Number(opt('brute', '2'));
const bruteMax = Number(opt('bruteMax', '0.7'));
const idle = Number(opt('idle', '8'));
const png = flag('png');
const verbose = flag('verbose');
const doOneShot = flag('oneshot');
const stats = STAT_PRESETS.base!;
const OBJ: ObjectiveDef = { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 };

interface Check {
  name: string;
  parts: number;
  joints: number;
  mass: number;
  height: number;
  settleBreaks: number;
  settleSag: number;
  idleBreaks: number;
  /** Silent tether snaps (loose prop slipped off) while settling + idling. */
  tetherBreaks: number;
  drift: number;
  maxStress: number;
  progress: number;
  events: number;
  /** Bodies still awake when the pre-settle window ended (> 0 = settle timed out: risky). */
  awakeAfterSettle: number;
  warnings: string[];
  stable: boolean;
  ms: number;
}

function newSim(def: StructureDef, objective: ObjectiveDef, seed = 7): { sim: Simulation; boom: { n: number } } {
  const sim = new Simulation({ seed, weaponStats: { ...stats, spread: 0 } });
  const boom = { n: 0 };
  sim.events.on('explosion', () => boom.n++);
  sim.events.on('partShattered', () => boom.n++);
  sim.loadStructure(def, objective);
  return { sim, boom };
}

function check(name: string, def: StructureDef, objective: ObjectiveDef): Check {
  const t0 = performance.now();
  const { sim, boom } = newSim(def, objective);
  const s = sim.structure!;
  const awakeAfterSettle = sim.physics.stats.active;
  let idleBreaks = 0;
  sim.events.on('jointBroken', () => idleBreaks++);
  run(sim, idle);
  let drift = 0;
  for (const p of s.parts) if (!p.removed) drift = Math.max(drift, Math.hypot(p.x - p.x0, p.y - p.y0));
  let maxStress = 0;
  for (const j of s.joints) if (!j.broken) maxStress = Math.max(maxStress, j.stress);
  const warnings = (def.meta?.warnings as string[] | undefined) ?? [];
  const r: Check = {
    name,
    parts: s.parts.length,
    joints: s.joints.length,
    mass: Math.round(s.trackedMass),
    height: +s.height0.toFixed(1),
    settleBreaks: s.settleJointsBroken,
    settleSag: +s.settleDrift.toFixed(3),
    idleBreaks,
    tetherBreaks: s.settleTetherBreaks + s.tetherBreaks,
    drift: +drift.toFixed(3),
    maxStress: +maxStress.toFixed(2),
    progress: +sim.progress.toFixed(3),
    events: boom.n,
    awakeAfterSettle,
    warnings,
    stable: false,
    ms: 0,
  };
  r.stable = r.settleBreaks === 0 && r.idleBreaks === 0 && r.tetherBreaks === 0 && r.drift < 0.08 && r.progress < 0.05 && r.events === 0 && warnings.length === 0 && awakeAfterSettle === 0;
  sim.destroy();
  r.ms = Math.round(performance.now() - t0);
  return r;
}

/** One-shot sweep (no spread, direct fire at every non-foundation part center): number of winning aims / aims. */
function oneShot(def: StructureDef, objective: ObjectiveDef): { wins: number; aims: number } {
  const probe = new Simulation({ seed: 7, weaponStats: { ...stats, spread: 0 } });
  probe.loadStructure(def, objective);
  const targets = probe.structure!.parts.filter((p) => !p.isFoundation).map((p) => ({ x: p.x, y: p.y }));
  probe.destroy();
  let wins = 0;
  let aims = 0;
  for (const t of targets) {
    const { sim } = newSim(def, objective);
    if (fireAt(sim, t.x, t.y, 0)) {
      aims++;
      run(sim, 7);
      if (sim.phase !== 'standing') wins++;
    }
    sim.destroy();
  }
  return { wins, aims };
}

/** Random-target shots (normal spread) until the objective is met; 16 = not within 15 shots. */
function bruteForce(def: StructureDef, objective: ObjectiveDef, trials: number): number[] {
  const out: number[] = [];
  for (let b = 0; b < trials; b++) {
    const rng = new Random(1000 + b);
    const sim = new Simulation({ seed: 50 + b, weaponStats: { ...stats } });
    sim.loadStructure(def, objective);
    let shots = 0;
    while (sim.phase === 'standing' && shots < 15) {
      const parts = sim.structure!.parts.filter((p) => !p.removed && !p.isFoundation);
      if (parts.length === 0) break;
      const p = parts[Math.floor(rng.next() * parts.length)]!;
      if (fireAt(sim, p.x, p.y, rng.chance(0.25) ? 1 : 0)) shots++;
      else if (fireAt(sim, p.x, p.y, 1)) shots++;
      run(sim, 4);
    }
    out.push(sim.phase === 'standing' ? 16 : shots);
    sim.destroy();
  }
  return out;
}

function fmt(c: Check): string {
  const flagStr = c.stable ? 'ok ' : 'BAD';
  return `${flagStr} ${c.name.padEnd(26)} parts=${String(c.parts).padStart(3)} joints=${String(c.joints).padStart(3)} mass=${String(c.mass).padStart(6)} h=${String(c.height).padStart(4)} | settle brk=${c.settleBreaks} sag=${c.settleSag.toFixed(3)} | idle brk=${c.idleBreaks}${c.tetherBreaks ? ` TETHER=${c.tetherBreaks}` : ''} drift=${c.drift.toFixed(3)} stress=${c.maxStress.toFixed(2)} prog=${c.progress.toFixed(2)}${c.events ? ` BOOM=${c.events}` : ''}${c.awakeAfterSettle ? ` AWAKE=${c.awakeAfterSettle}` : ''} (${c.ms}ms)${c.warnings.length ? '\n      ! ' + c.warnings.slice(0, 3).join('\n      ! ') : ''}`;
}

// ------------------------------------------------------------ gallery helpers

/** Common view for gallery frames: structures are re-centered on x = 0. */
const GALLERY_VIEW = { left: -12, right: 12, top: -19, bottom: 1.5 };

function viewAroundDef(def: StructureDef): { left: number; right: number; top: number; bottom: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  for (const p of def.parts) {
    minX = Math.min(minX, def.originX + p.x);
    maxX = Math.max(maxX, def.originX + p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX + 12, (maxY + 4) * 1.3);
  const cx = (minX + maxX) / 2;
  return { left: cx - w / 2, right: cx + w / 2, top: -(maxY + 4), bottom: 1.5 };
}

function centered(f: FrameSnap, def: StructureDef): FrameSnap {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of def.parts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
  }
  const dx = -(def.originX + (minX + maxX) / 2);
  return {
    ...f,
    shapes: f.shapes.map((s) => ({ ...s, x: s.x + dx })),
    joints: f.joints.map((j) => ({ ...j, x: j.x + dx })),
  };
}

// ------------------------------------------------------------ fixtures

const FIXTURES: Record<string, BlueprintDef> = {
  // basic.ts (legacy names)
  block: { modules: [{ type: 'block', w: 2, h: 1 }] },
  stack: { modules: [{ type: 'stack', count: 6, w: 1.2, h: 1.2 }] },
  'frame+slab': { modules: [{ type: 'frame', w: 5, h: 3 }, { type: 'slab' }] },
  'frame-braced': { modules: [{ type: 'foundation', w: 7 }, { type: 'frame', w: 6, h: 3, columns: 3, brace: 'x' }] },
  parts: { modules: [{ type: 'parts', parts: [{ x: -1, y: 0.5, w: 1, h: 1 }, { x: 1, y: 0.5, w: 1, h: 1 }, { x: 0, y: 1.2, w: 3, h: 0.4 }] }] },
  // structural.ts
  foundation: { modules: [{ type: 'foundation', w: 8 }] },
  'foundation-stepped': { modules: [{ type: 'foundation', w: 8, steps: 3 }, { type: 'frame', w: 4 }] },
  column: { modules: [{ type: 'column' }] },
  pillar: { modules: [{ type: 'pillar', segments: 4, capital: true, plinth: true, h: 4 }] },
  tower: { modules: [{ type: 'foundation', w: 7 }, { type: 'tower', storeys: 4, w: 5 }] },
  'tower-x': { modules: [{ type: 'foundation', w: 7 }, { type: 'tower', storeys: 4, w: 5, brace: 'x' }] },
  'tower-alt': { modules: [{ type: 'tower', storeys: 5, w: 4, brace: 'alt' }] },
  'tower-concrete': { modules: [{ type: 'foundation', w: 8 }, { type: 'tower', storeys: 3, w: 6.5, columns: 3, colW: 0.45, material: 'concrete', brace: 'chevron', braceMaterial: 'steel' }] },
  'tower-steel': { modules: [{ type: 'foundation', w: 7 }, { type: 'tower', storeys: 5, w: 4.5, material: 'steel', colW: 0.3, beamH: 0.25, brace: 'x', taper: 0.4 }] },
  'tower-glass': { modules: [{ type: 'foundation', w: 8 }, { type: 'tower', storeys: 3, w: 6.5, columns: 3, glass: true, brace: 'single', braceFrom: 1 }] },
  'brace-x': { modules: [{ type: 'foundation', w: 6 }, { type: 'frame', w: 4, h: 3 }, { type: 'brace', pattern: 'x' }] },
  'brace-single': { modules: [{ type: 'frame', w: 4, h: 3 }, { type: 'brace', pattern: 'single', material: 'wood' }, { type: 'frame', w: 4, h: 3 }, { type: 'brace', pattern: 'v' }] },
  truss: { modules: [{ type: 'pillar', x: -3.8, h: 3, detached: true }, { type: 'pillar', x: 3.8, h: 3, detached: true }, { type: 'truss', x: 0, y: 3, w: 8 }] },
  'truss-pratt': { modules: [{ type: 'frame', w: 8, h: 3 }, { type: 'truss', style: 'pratt', h: 1.4 }] },
  'truss-howe-wood': { modules: [{ type: 'frame', w: 7, h: 2.5 }, { type: 'truss', style: 'howe', material: 'wood', webT: 0.16, chordT: 0.22 }] },
  platform: { modules: [{ type: 'frame', w: 5, h: 3 }, { type: 'platform', overhang: 0.6, planks: 3, parapet: true }] },
  'roof-gable': { modules: [{ type: 'frame', w: 5, h: 3 }, { type: 'roof', style: 'gable' }] },
  'roof-hip': { modules: [{ type: 'frame', w: 5, h: 3 }, { type: 'roof', style: 'hip', material: 'concrete' }] },
  'roof-shed': { modules: [{ type: 'frame', w: 5, h: 3 }, { type: 'roof', style: 'shed', h: 1.4 }] },
  'roof-slab': { modules: [{ type: 'frame', w: 5, h: 3 }, { type: 'roof', style: 'slab', material: 'concrete' }] },
  'roof-rafters': { modules: [{ type: 'frame', w: 6, h: 3 }, { type: 'roof', style: 'rafters', h: 2 }] },
  pyramid: { modules: [{ type: 'pyramid', levels: 6, w: 7 }] },
  'pyramid-dry': { modules: [{ type: 'pyramid', levels: 5, w: 6, mortar: 0, material: 'concrete' }, { type: 'weight', balanced: true }] },
  wall: { modules: [{ type: 'wall', w: 5, h: 3 }] },
  'wall-opening': { modules: [{ type: 'foundation', w: 6 }, { type: 'wall', w: 5, h: 3.2, opening: 1.4, openingH: 2 }, { type: 'slab', material: 'concrete' }] },
  'wall-dry': { modules: [{ type: 'wall', w: 4, h: 2.4, mortar: 0 }] },
  // special.ts
  arch: { modules: [{ type: 'arch' }] },
  'arch-mortar': { modules: [{ type: 'arch', span: 5, mortar: 0.4 }] },
  'arch-deck': { modules: [{ type: 'arch', span: 5, deck: true }, { type: 'weight', w: 1.2, h: 1 }] },
  'arch-segmental': { modules: [{ type: 'arch', span: 6, rise: 1.8, voussoirs: 11 }] },
  'counterweight-top': { modules: [{ type: 'frame', w: 4, h: 3 }, { type: 'counterweight' }] },
  'counterweight-hang': { modules: [{ type: 'cantilever', w: 6, overhang: 3.5, supportW: 0.7 }, { type: 'counterweight', at: 'right', hang: 1.2, w: 0.8, h: 0.8 }] },
  cantilever: { modules: [{ type: 'cantilever' }] },
  'cantilever-knee': { modules: [{ type: 'cantilever', knee: true, tipLoad: 0.8, side: 'left' }] },
  'cantilever-on-frame': { modules: [{ type: 'foundation', w: 6 }, { type: 'frame', w: 4, h: 3 }, { type: 'cantilever', overhang: 2.5, w: 5 }] },
  pendulum: { modules: [{ type: 'pendulum' }] },
  'pendulum-rod': { modules: [{ type: 'pendulum', mode: 'rod', material: 'concrete', r: 0.6 }] },
  'pendulum-hang': { modules: [{ type: 'foundation', w: 7 }, { type: 'frame', w: 5, h: 5 }, { type: 'pendulum', len: 2.2, r: 0.45 }] },
  cableStay: { modules: [{ type: 'cableStay' }] },
  'cableStay-harp': { modules: [{ type: 'cableStay', style: 'harp', span: 14, segments: 4, mastMaterial: 'steel', mastW: 0.4 }] },
  suspension: { modules: [{ type: 'suspension' }] },
  coreChamber: { modules: [{ type: 'foundation', w: 6 }, { type: 'tower', storeys: 2, w: 4 }, { type: 'coreChamber', w: 3.4 }] },
  'coreChamber-glass': { modules: [{ type: 'frame', w: 4, h: 3 }, { type: 'coreChamber', w: 4, wallMaterial: 'glass', open: 'left' }] },
  weight: { modules: [{ type: 'frame', w: 4, h: 3 }, { type: 'weight' }] },
  'weight-balanced': { modules: [{ type: 'foundation', w: 5 }, { type: 'weight', balanced: true, material: 'steel', w: 1.2, h: 1 }] },
  explosiveBarrel: { modules: [{ type: 'foundation', w: 7 }, { type: 'tower', storeys: 2, w: 5 }, { type: 'explosiveBarrel', inside: true, count: 2 }] },
  explosiveCrate: { modules: [{ type: 'frame', w: 4, h: 3 }, { type: 'explosiveCrate', count: 2, gap: 0.6 }] },
};

const summary: Record<string, unknown> = {};

if (doModules) {
  console.log(`== modules (idle ${idle}s) ==`);
  const results: Check[] = [];
  const frames: FrameSnap[] = [];
  for (const [name, bp] of Object.entries(FIXTURES)) {
    if (only.length && !only.some((o) => name.startsWith(o))) continue;
    let def: StructureDef;
    try {
      def = generateStructure(bp, 11, 40);
    } catch (e) {
      console.log(`ERR ${name}: ${(e as Error).message}`);
      continue;
    }
    const c = check(name, def, OBJ);
    results.push(c);
    console.log(fmt(c));
    if (png) {
      const { sim } = newSim(def, OBJ);
      frames.push(centered(snapshot(sim, name), def));
      sim.destroy();
    }
  }
  const bad = results.filter((r) => !r.stable);
  console.log(`modules: ${results.length - bad.length}/${results.length} stable${bad.length ? ' — UNSTABLE: ' + bad.map((b) => b.name).join(', ') : ''}`);
  summary.modules = { total: results.length, unstable: bad.map((b) => b.name) };
  if (png && frames.length) {
    mkdirSync('tools/out', { recursive: true });
    for (let k = 0; k < frames.length; k += 16) {
      const path = `tools/out/gen-modules-${k / 16 + 1}.png`;
      await renderFilmstrip(frames.slice(k, k + 16), path, GALLERY_VIEW, { cols: 4 });
      console.log(`  gallery: ${path}`);
    }
  }
}

if (doProc) {
  console.log(`\n== procedural (${seeds} seeds x [${diffs.join(', ')}], idle ${idle}s, brute ${brute} for d<=${bruteMax}) ==`);
  const rows: { seed: number; diff: number; c: Check; name: string; par: number; brute: number[]; obj: string; oneShot: { wins: number; aims: number } | null }[] = [];
  const gallery: FrameSnap[] = [];
  const gallerySeeds = opt('gallery-seeds', '1,2,3,4').split(',').map(Number);
  for (const diff of diffs) {
    for (let s = seed0; s < seed0 + seeds; s++) {
      const lvl = randomBlueprint(s, diff);
      // Determinism check: same seed -> same blueprint and structure.
      const again = randomBlueprint(s, diff);
      const def = generateStructure(lvl.blueprint, s, 42);
      const def2 = generateStructure(again.blueprint, s, 42);
      if (JSON.stringify(def) !== JSON.stringify(def2)) console.log(`NON-DETERMINISTIC seed=${s} d=${diff}`);
      const c = check(`${s}@${diff} ${lvl.name}`, def, lvl.objective);
      const b = diff <= bruteMax + 1e-9 && brute > 0 ? bruteForce(def, lvl.objective, brute) : [];
      const os = doOneShot ? oneShot(def, lvl.objective) : null;
      if (os && verbose) console.log(`   one-shot ${s}@${diff} ${lvl.name}: ${os.wins}/${os.aims} aims win (par ${lvl.par})`);
      rows.push({ seed: s, diff, c, name: lvl.name, par: lvl.par, brute: b, obj: lvl.objective.kind, oneShot: os });
      if (verbose || !c.stable || b.some((x) => x > 10)) console.log(fmt(c) + (b.length ? ` brute=${b.join(',')}` : '') + ` obj=${lvl.objective.kind} par=${lvl.par}`);
      if (png && gallerySeeds.includes(s)) {
        const { sim } = newSim(def, lvl.objective);
        gallery.push(centered(snapshot(sim, `s${s} d${diff} ${lvl.name} par${lvl.par}`), def));
        sim.destroy();
      }
    }
  }
  const bad = rows.filter((r) => !r.c.stable);
  for (const diff of diffs) {
    const rs = rows.filter((r) => r.diff === diff);
    const bs = rs.flatMap((r) => r.brute);
    const avg = bs.length ? bs.reduce((a, b) => a + b, 0) / bs.length : NaN;
    const hard = rs.filter((r) => r.brute.length && r.brute.reduce((a, b) => a + b, 0) / r.brute.length >= 10).length;
    const parts = rs.map((r) => r.c.parts);
    const objs = new Map<string, number>();
    for (const r of rs) objs.set(r.obj, (objs.get(r.obj) ?? 0) + 1);
    const names = new Map<string, number>();
    for (const r of rs) names.set(r.name.split(' ').slice(-1)[0]!, (names.get(r.name.split(' ').slice(-1)[0]!) ?? 0) + 1);
    console.log(
      `d=${diff}: stable ${rs.length - rs.filter((r) => !r.c.stable).length}/${rs.length}` +
        `, parts ${Math.min(...parts)}..${Math.max(...parts)}` +
        `, max drift ${Math.max(...rs.map((r) => r.c.drift)).toFixed(3)}` +
        (bs.length ? `, brute avg ${avg.toFixed(1)} (runs >=10: ${hard}/${rs.length})` : '') +
        `, par ${[1, 2, 3].map((p) => rs.filter((r) => r.par === p).length).join('/')}` +
        (doOneShot ? `, one-shot possible ${rs.filter((r) => r.oneShot && r.oneShot.wins > 0).length}/${rs.length} (par-1 levels: ${rs.filter((r) => r.par === 1 && r.oneShot && r.oneShot.wins > 0).length}/${rs.filter((r) => r.par === 1).length})` : '') +
        `, objectives ${[...objs].map(([k, v]) => `${k}:${v}`).join(' ')}` +
        `, archetypes ${[...names].map(([k, v]) => `${k}:${v}`).join(' ')}`,
    );
  }
  console.log(`procedural: ${rows.length - bad.length}/${rows.length} stable${bad.length ? ' — UNSTABLE: ' + bad.map((b) => `${b.seed}@${b.diff}`).join(', ') : ''}`);
  summary.procedural = { total: rows.length, unstable: bad.map((b) => `${b.seed}@${b.diff}`) };
  if (png && gallery.length) {
    mkdirSync('tools/out', { recursive: true });
    for (let k = 0; k < gallery.length; k += 16) {
      const path = `tools/out/gen-proc-${k / 16 + 1}.png`;
      await renderFilmstrip(gallery.slice(k, k + 16), path, GALLERY_VIEW, { cols: 4 });
      console.log(`  gallery: ${path}`);
    }
  }
}

for (const f of films) {
  const [sd, df] = f.split('@').map(Number) as [number, number];
  const lvl = randomBlueprint(sd, df);
  const def = generateStructure(lvl.blueprint, sd, 42);
  const rng = new Random(1000);
  const sim = new Simulation({ seed: 50, weaponStats: { ...stats } });
  sim.loadStructure(def, lvl.objective);
  const frames: FrameSnap[] = [snapshot(sim, `${lvl.name} (s${sd} d${df}) par ${lvl.par}`)];
  let shots = 0;
  while (sim.phase === 'standing' && shots < 11) {
    const parts = sim.structure!.parts.filter((p) => !p.removed && !p.isFoundation);
    if (parts.length === 0) break;
    const p = parts[Math.floor(rng.next() * parts.length)]!;
    if (fireAt(sim, p.x, p.y, rng.chance(0.25) ? 1 : 0)) shots++;
    run(sim, 0.5);
    frames.push(snapshot(sim, `shot ${shots} +0.5s  ${Math.round(sim.progress * 100)}%`));
    run(sim, 3.5);
  }
  if (sim.phase !== 'standing') {
    run(sim, 2);
    frames.push(snapshot(sim, `settled after ${shots} shots`));
  }
  sim.destroy();
  mkdirSync('tools/out', { recursive: true });
  const path = `tools/out/gen-film-${sd}-${df}.png`;
  await renderFilmstrip(frames.slice(0, 12), path, viewAroundDef(def), { cols: 4 });
  console.log(`film: ${path} (${shots} shots, ${sim.phase})`);
}

console.log('JSON ' + JSON.stringify(summary));
