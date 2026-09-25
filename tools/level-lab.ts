/**
 * Level lab: headless validation + difficulty measurement for a level.
 *
 *   npx tsx tools/level-lab.ts level03 [--stats base|mid|high] [--sweep full|quick|none]
 *        [--brute N] [--png path] [--seed N]
 *
 * Checks
 *  1. builds and settles with ZERO joints breaking and everything asleep;
 *  2. stands idle for 10 s without breaking, drifting or progressing the objective;
 *  3. one-shot sweep: aims (no spread) at every part (center/upper/lower) with
 *     low and high arcs; reports which single shots achieve the objective;
 *  4. brute force: random-target shots until destroyed (how hard for a
 *     non-thinking player);
 *  5. writes a filmstrip PNG: at rest (stress view) + best one-shot collapse.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initRapier, makeSim, run, fireAt, snapshot, renderFilmstrip, viewAround, STAT_PRESETS, type FrameSnap } from './lib/headless';
import type { LevelDef } from '../src/game/LevelDefinition';
import { Random } from '../src/core/Random';

await initRapier();
await import('../src/sim/generator/modules');
const { generateStructure } = await import('../src/sim/generator/StructureGenerator');

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) ?? 'level01';
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const statsName = opt('stats', 'base');
const sweepMode = opt('sweep', 'quick');
const brute = Number(opt('brute', '6'));
const png = opt('png', `tools/out/${id}.png`);
const seedOverride = args.includes('--seed') ? Number(opt('seed', '0')) : undefined;
const stats = STAT_PRESETS[statsName] ?? STAT_PRESETS.base!;

const mod = (await import(`../src/data/levels/${id}.ts`)) as Record<string, LevelDef>;
const level = (mod[id] ?? Object.values(mod)[0]) as LevelDef;
const build = () => generateStructure(level.blueprint, seedOverride ?? level.seed, level.originX);
const def = build();

const out: Record<string, unknown> = { id, name: level.name, stats: statsName };
const lines: string[] = [];
const log = (s: string) => lines.push(s);

// ---- 1+2: settle + idle
{
  const sim = makeSim(def, level.objective, stats);
  const s = sim.structure!;
  const settleBreaks = s.settleJointsBroken;
  const activeAfterSettle = sim.physics.stats.active;
  let idleBreaks = 0;
  sim.events.on('jointBroken', () => idleBreaks++);
  run(sim, 10);
  let drift = 0;
  for (const p of s.parts) drift = Math.max(drift, Math.hypot(p.x - p.x0, p.y - p.y0));
  let maxStress = 0;
  for (const j of s.joints) if (!j.broken) maxStress = Math.max(maxStress, j.stress);
  out.parts = s.parts.length;
  out.joints = s.joints.length;
  out.mass = Math.round(s.trackedMass);
  out.height = +s.height0.toFixed(2);
  out.line = sim.detector?.lineHeight ?? null;
  out.settleBreaks = settleBreaks;
  out.idleBreaks = idleBreaks;
  out.drift = +drift.toFixed(3);
  out.maxIdleStress = +maxStress.toFixed(2);
  out.idleProgress = +sim.progress.toFixed(3);
  out.settleActive = sim.settleActive;
  // Tether snaps are silent at runtime (no jointBroken event) but mean a loose prop slipped off.
  out.tetherBreaks = s.settleTetherBreaks + s.tetherBreaks;
  out.stable = settleBreaks === 0 && idleBreaks === 0 && out.tetherBreaks === 0 && drift < 0.08 && sim.progress < 0.05 && sim.settleActive === 0;
  log(`${level.name} [${id}] parts=${s.parts.length} joints=${s.joints.length} mass=${out.mass}kg height=${out.height}m line=${out.line === null ? '-' : (out.line as number).toFixed(2)}`);
  log(`  objective: ${sim.detector?.describe()}  par=${level.par}`);
  out.settleDrift = +s.settleDrift.toFixed(3);
  log(`  settle: breaks=${settleBreaks} tethers=${s.settleTetherBreaks} sag=${out.settleDrift}m activeAfter=${activeAfterSettle} | idle 10s: breaks=${idleBreaks} tethers=${s.tetherBreaks} drift=${out.drift}m maxStress=${out.maxIdleStress} progress=${out.idleProgress} => ${out.stable ? 'STABLE' : 'UNSTABLE!'}`);
  sim.destroy();
}

// ---- 3: one-shot sweep
interface Trial {
  target: string;
  x: number;
  y: number;
  arc: 0 | 1;
  met: boolean;
  progress: number;
  joints: number;
  timeToMet: number;
}
const trials: Trial[] = [];
if (sweepMode !== 'none') {
  const probe = makeSim(def, level.objective, stats);
  const targets: { name: string; x: number; y: number }[] = [];
  for (const p of probe.structure!.parts) {
    if (p.isFoundation) continue;
    const label = p.name ?? `#${p.index}:${p.material.id}`;
    targets.push({ name: label, x: p.x, y: p.y });
    if (sweepMode === 'full' && p.shape.kind === 'box' && p.shape.hh > 0.9) {
      const c = Math.cos(p.angle), sn = Math.sin(p.angle);
      for (const f of [-0.7, 0.7]) targets.push({ name: `${label}@${f > 0 ? 'low' : 'high'}`, x: p.x - sn * p.shape.hh * f, y: p.y + c * p.shape.hh * f });
    }
  }
  probe.destroy();
  const arcs: (0 | 1)[] = sweepMode === 'full' ? [0, 1] : [0];
  for (const t of targets) {
    for (const arc of arcs) {
      const sim = makeSim(def, level.objective, stats);
      if (!fireAt(sim, t.x, t.y, arc)) {
        sim.destroy();
        continue;
      }
      let metAt = -1;
      const t0 = sim.physics.simTime;
      sim.events.on('objectiveComplete', () => (metAt = sim.physics.simTime - t0));
      run(sim, 9);
      trials.push({ target: t.name, x: +t.x.toFixed(2), y: +(-t.y).toFixed(2), arc, met: sim.phase !== 'standing', progress: +sim.progress.toFixed(2), joints: sim.structure!.jointsBroken, timeToMet: +metAt.toFixed(2) });
      sim.destroy();
    }
  }
  const wins = trials.filter((t) => t.met);
  out.oneShotRate = trials.length ? +(wins.length / trials.length).toFixed(3) : 0;
  out.oneShotWins = wins.map((w) => `${w.target}${w.arc ? '(lob)' : ''}`);
  log(`  one-shot sweep (${sweepMode}, ${trials.length} aims): ${wins.length} succeed (${(Number(out.oneShotRate) * 100).toFixed(0)}%)`);
  if (wins.length) log(`    winners: ${wins.slice(0, 16).map((w) => `${w.target}${w.arc ? '(lob)' : ''} [${w.joints}j, ${w.timeToMet}s]`).join(', ')}${wins.length > 16 ? ' ...' : ''}`);
  const near = trials.filter((t) => !t.met).sort((a, b) => b.progress - a.progress).slice(0, 5);
  if (near.length) log(`    closest misses: ${near.map((n) => `${n.target}${n.arc ? '(lob)' : ''}=${Math.round(n.progress * 100)}%`).join(', ')}`);
}

// ---- 4: brute force (random targets, with normal spread)
if (brute > 0) {
  const shotsNeeded: number[] = [];
  for (let b = 0; b < brute; b++) {
    const rng = new Random(1000 + b);
    const sim = makeSim(def, level.objective, { ...stats, spread: stats.spread }, 50 + b);
    sim.weapon.stats.spread = stats.spread;
    let shots = 0;
    while (sim.phase === 'standing' && shots < 15) {
      const parts = sim.structure!.parts.filter((p) => !p.removed && !p.isFoundation);
      if (parts.length === 0) break;
      const p = parts[Math.floor(rng.next() * parts.length)]!;
      if (fireAt(sim, p.x, p.y, rng.chance(0.25) ? 1 : 0)) shots++;
      run(sim, 4);
    }
    shotsNeeded.push(sim.phase === 'standing' ? 16 : shots);
    sim.destroy();
  }
  const avg = shotsNeeded.reduce((a, b) => a + b, 0) / shotsNeeded.length;
  out.bruteShots = shotsNeeded;
  out.bruteAvg = +avg.toFixed(2);
  log(`  brute force (random targets): shots=${shotsNeeded.join(',')} avg=${avg.toFixed(1)} (16 = failed within 15)`);
}

// ---- 5: filmstrip
if (png !== 'none') {
  const frames: FrameSnap[] = [];
  const view = viewAround(def, 3);
  const sim0 = makeSim(def, level.objective, stats);
  frames.push(snapshot(sim0, `${level.name}: at rest`));
  const rest = snapshot(sim0, 'stress at rest');
  sim0.destroy();
  const best = trials.filter((t) => t.met).sort((a, b) => b.joints - a.joints)[0] ?? trials.sort((a, b) => b.progress - a.progress)[0];
  if (best) {
    const sim = makeSim(def, level.objective, stats);
    // Convert back to sim space (trial y is height).
    fireAt(sim, best.x, -best.y, best.arc);
    const marks = [0.35, 0.9, 1.6, 2.6, 4.2, 7];
    let k = 0;
    const t0 = sim.physics.simTime;
    run(sim, 7.1, (t) => {
      if (k < marks.length && t - t0 >= marks[k]!) {
        frames.push(snapshot(sim, `shot@${best.target}${best.arc ? '(lob)' : ''} +${marks[k]}s`));
        k++;
      }
    });
    sim.destroy();
  }
  mkdirSync(dirname(png), { recursive: true });
  await renderFilmstrip(frames, png, view, { cols: 4 });
  await renderFilmstrip([rest], png.replace(/\.png$/, '-stress.png'), view, { stress: true, cols: 1 });
  log(`  filmstrip: ${png} (+ -stress.png)`);
}

console.log(lines.join('\n'));
console.log('JSON ' + JSON.stringify(out));
