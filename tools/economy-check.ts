/**
 * Economy / upgrade sanity check (headless).
 *
 *   npx tsx tools/economy-check.ts [--sim none|quick|all] [--levels 1,3,5]
 *
 *  A. Synthetic scenarios per reward tier: 1 shot vs 2 / 3 / 6 / 8 shots,
 *     with the one-shot : brute-force payout ratio (target ≈ 2.5–3x).
 *  B. Real simulated runs (Rapier, no rendering) on campaign levels: best
 *     one-shot from an aim sweep vs random-target brute force, scored through
 *     LevelSession -> scoreLevel exactly like GameScene does.
 *  C. Upgrade catalogue: costs, stat progression, previews, and how many
 *     purchases typical earnings buy over the campaign.
 */
import { initRapier, makeSim, run, fireAt, STAT_PRESETS } from './lib/headless';
import { scoreLevel, type LevelOutcome, type LevelResult } from '../src/game/Economy';
import type { LevelDef } from '../src/game/LevelDefinition';
import { UpgradeSystem } from '../src/game/UpgradeSystem';
import { UPGRADES } from '../src/data/upgrades';
import { GameState } from '../src/game/GameState';
import { Random } from '../src/core/Random';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : d;
};
const simMode = opt('sim', 'quick');

const money = (n: number) => `$${n}`.padStart(6);
const fmtResult = (r: LevelResult) => `${money(r.total)} ${r.grade} ${r.titles.join(',')}`;

function lvl(reward: number, par: number): LevelDef {
  return {
    id: 'test',
    name: 'Test',
    subtitle: '',
    lesson: '',
    hint: '',
    seed: 1,
    originX: 40,
    blueprint: { modules: [] },
    objective: { kind: 'massFallen', fraction: 0.5 } as LevelDef['objective'],
    par,
    reward,
  };
}

// ------------------------------------------------------------------ A. synthetic
console.log('A. SYNTHETIC SCENARIOS (standard ammo, $10/shot)');
interface Scn {
  name: string;
  shots: number;
  f: number;
  chainShare: number;
  chainN: number;
  time: number;
}
const scenarios = (par: number): Scn[] => [
  { name: 'clean 1-shot', shots: 1, f: 0.9, chainShare: 0.85, chainN: 45, time: 9 },
  { name: 'at par', shots: par, f: 0.88, chainShare: 0.6, chainN: 30, time: 9 + par * 3 },
  { name: 'par+1', shots: par + 1, f: 0.88, chainShare: 0.45, chainN: 22, time: 14 + par * 3 },
  { name: 'par+2', shots: par + 2, f: 0.9, chainShare: 0.35, chainN: 16, time: 18 + par * 3 },
  { name: '6 shots', shots: Math.max(6, par * 3), f: 0.95, chainShare: 0.25, chainN: 12, time: 30 + par * 3 },
  { name: '8 shots', shots: Math.max(8, par * 4), f: 0.97, chainShare: 0.2, chainN: 10, time: 38 + par * 3 },
  { name: '12 shots', shots: Math.max(12, par * 6), f: 0.98, chainShare: 0.15, chainN: 8, time: 50 + par * 3 },
];
for (const par of [1, 2]) {
  for (const R of [140, 300, 500]) {
    const level = lvl(R, par);
    const mass = 20000;
    const rows: string[] = [];
    let one = 0;
    let six = 0;
    for (const s of scenarios(par)) {
      const o: LevelOutcome = {
        level,
        shots: s.shots,
        ammoCost: s.shots * 10,
        time: s.time,
        destroyedFraction: s.f,
        chainJoints: Math.round(s.chainN * 0.6),
        chainParts: Math.round(s.chainN * 0.4),
        chainMass: mass * s.chainShare,
        jointsBroken: 40,
        partsFallen: 30,
        winningShot: s.shots,
        salvage: mass * s.f * 0.02,
        totalMass: mass,
      };
      const r = scoreLevel(o);
      if (s.name === 'clean 1-shot') one = r.total;
      if (s.name === '6 shots') six = r.total;
      rows.push(`    ${s.name.padEnd(13)} ${String(s.shots).padStart(2)} shots ${fmtResult(r)}`);
    }
    console.log(`  reward ${R}, par ${par}: one-shot / ${Math.max(6, par * 3)}-shot = ${(one / six).toFixed(2)}x`);
    console.log(rows.join('\n'));
  }
}
{
  // Detailed line breakdown for one case.
  const o: LevelOutcome = {
    level: lvl(300, 1),
    shots: 1,
    ammoCost: 10,
    time: 8,
    destroyedFraction: 0.92,
    chainJoints: 30,
    chainParts: 20,
    chainMass: 17000,
    jointsBroken: 34,
    partsFallen: 24,
    winningShot: 1,
    salvage: 380,
    totalMass: 20000,
  };
  const r = scoreLevel(o);
  console.log('  breakdown (reward 300, par 1, one shot):');
  for (const l of r.lines) console.log(`    ${l.label.padEnd(16)} ${String(l.amount).padStart(5)}  ${l.detail ?? ''}`);
  console.log(`    ${'TOTAL'.padEnd(16)} ${String(r.total).padStart(5)}  grade ${r.grade} ${r.titles.join(' · ')}`);
  const zero = scoreLevel({ ...o, shots: 25, ammoCost: 25 * 60, destroyedFraction: 0.6, chainJoints: 0, chainParts: 0, chainMass: 0, salvage: 0, time: 200 });
  console.log(`  worst case (25 cluster shells): total ${zero.total} (floor), lines sum ${zero.lines.reduce((a, l) => a + l.amount, 0)}, grade ${zero.grade} ${zero.titles.join(',')}`);
}

// ------------------------------------------------------------------ C. upgrades
console.log('\nC. UPGRADES');
const us = new UpgradeSystem();
let total = 0;
for (const d of UPGRADES) {
  const sum = d.costs.reduce((a, b) => a + b, 0);
  total += sum;
  const owned: Record<string, number> = {};
  const steps: string[] = [];
  for (let i = 0; i < d.maxLevel; i++) {
    if (d.requires) owned[d.requires.id] = d.requires.level;
    const p = us.preview(d.id, owned)!;
    steps.push(p.text);
    us.purchase(d.id, { money: 1e9, upgrades: owned });
  }
  const maxed = us.preview(d.id, owned)!;
  console.log(`  ${d.name.padEnd(20)} [${d.branch}] costs ${d.costs.join('/').padEnd(22)} (=${sum}) ${steps.join(' | ')} || ${maxed.text}`);
}
console.log(`  catalogue total: $${total}`);
{
  const owned: Record<string, number> = {};
  console.log(`  cluster locked reason: ${us.lockedReason('cluster', owned)}; nextCost=${us.nextCost('cluster', owned)}; status=${us.status('cluster', owned, 9999)}`);
  owned.he = 1;
  console.log(`  after HE: unlocked ammo = ${us.unlockedAmmo(owned).join(',')}; cluster nextCost=${us.nextCost('cluster', owned)}`);
  const all: Record<string, number> = {};
  for (const d of UPGRADES) all[d.id] = d.maxLevel;
  const st = us.weaponStats(all);
  console.log(`  fully upgraded: v=${st.muzzleVelocity.toFixed(1)} m=${st.projectileMass.toFixed(0)} r=${st.projectileRadius.toFixed(3)} reload=${st.reloadTime.toFixed(2)} spread=${((st.spread * 180) / Math.PI).toFixed(2)}° recoil=${st.recoil.toFixed(2)} preview=${st.previewTime.toFixed(2)} ammo=${us.unlockedAmmo(all).join(',')}`);
  console.log(`  clamp check (velocity: 99 in save): level=${us.level('velocity', { velocity: 99 })}, unknown id ignored: ${JSON.stringify(us.weaponStats({ bogus: 3 }).muzzleVelocity)}`);
}
{
  // Save round trip + corrupted data.
  const gs = new GameState();
  gs.money = 1234;
  gs.upgrades = { velocity: 2, he: 1 };
  gs.records.level01 = { completed: true, bestGrade: 'A', bestShots: 2, bestPayout: 300 };
  const back = GameState.fromJSON(JSON.parse(JSON.stringify(gs.toJSON())));
  console.log(`  save round-trip: money=${back.money} upgrades=${JSON.stringify(back.upgrades)} record=${JSON.stringify(back.records.level01)} saved(no storage)=${gs.save()}`);
  const bad = GameState.fromJSON({ money: 'lots', levelIndex: -4, upgrades: { velocity: 'x', mass: 2.7 }, records: { a: 5, b: { bestGrade: 'Z' } }, settings: { volume: 9 } });
  console.log(`  corrupted save -> money=${bad.money} levelIndex=${bad.levelIndex} upgrades=${JSON.stringify(bad.upgrades)} records=${JSON.stringify(bad.records)} volume=${bad.settings.volume}`);
}

// ------------------------------------------------------------------ B. simulated runs
if (simMode !== 'none') {
  console.log('\nB. SIMULATED RUNS (headless Rapier; one-shot = best aim from a sweep, brute = random targets w/ spread)');
  await initRapier();
  const { LEVELS } = await import('../src/data/levels');
  const { levelManager } = await import('../src/game/LevelManager');
  const { LevelSession } = await import('../src/game/LevelSession');
  const which = opt('levels', simMode === 'all' ? LEVELS.map((_, i) => i + 1).join(',') : '1,4,7,10');
  const indices = which.split(',').map((s) => Number(s) - 1).filter((i) => i >= 0 && i < LEVELS.length);
  // Procedural levels (sandbox / endless) are closer to real campaign structures than placeholders.
  const procList: LevelDef[] = opt('proc', '0.2,0.5,0.8')
    .split(',')
    .filter(Boolean)
    .map((d, k) => levelManager.procedural(7001 + k * 97, Number(d)));
  // Reference structures (placeholder-independent): multi-storey frames that can collapse in one shot.
  const ref = (name: string, reward: number, par: number, modules: LevelDef['blueprint']['modules']): LevelDef => ({
    ...lvl(reward, par),
    id: `ref-${name}`,
    name,
    originX: 36,
    blueprint: { modules },
    objective: { kind: 'massBelowLine', fraction: 0.6, lineFraction: 0.4 },
  });
  const storey = (material: string, w = 6, columns = 3) => ({ type: 'frame', w, h: 3, columns, material });
  const refs: LevelDef[] = opt('refs', '1') === '0' ? [] : [
    ref('Wood frame x4', 180, 1, [storey('wood'), storey('wood'), storey('wood'), storey('wood')]),
    ref('Steel+wood frame x4', 340, 1, [storey('steel', 7), storey('wood', 6), storey('wood', 6), storey('wood', 6)]),
    ref('Mixed frame x6', 500, 2, [storey('steel', 7), storey('concrete', 7), storey('concrete', 7), storey('wood', 6), storey('wood', 6), storey('wood', 5)]),
  ];
  const runs: LevelDef[] = [...indices.map((i) => LEVELS[i]!), ...procList, ...refs];
  const stats = STAT_PRESETS.base!;
  const AIM_TIME = 4;
  const GAP = 2.4;

  const settle = (sim: ReturnType<typeof makeSim>) => {
    for (let i = 0; i < 60 * 10 && sim.phase !== 'settled'; i++) sim.physics.step();
  };

  let sumOne = 0;
  let sumBrute = 0;
  for (let idx = 0; idx < runs.length; idx++) {
    const level = runs[idx]!;
    const def = levelManager.build(level);
    // One-shot sweep: first aim (low arc, part centers) that meets the objective, best payout wins.
    const probe = makeSim(def, level.objective, stats);
    const targets = probe.structure!.parts.filter((p) => !p.isFoundation).map((p) => ({ x: p.x, y: p.y }));
    const probeMass = probe.structure!.trackedMass;
    probe.destroy();
    // Spread the sampled aims over the whole structure.
    const stride = Math.max(1, Math.floor(targets.length / (simMode === 'all' ? 40 : 18)));
    for (let k = targets.length - 1; k >= 0; k--) if (k % stride !== 0) targets.splice(k, 1);
    let best: LevelResult | null = null;
    let tried = 0;
    for (const t of targets) {
      if (tried >= (simMode === 'all' ? 40 : 18)) break;
      tried++;
      const sim = makeSim(def, level.objective, stats);
      const session = new LevelSession(sim, level);
      run(sim, AIM_TIME);
      if (!fireAt(sim, t.x, t.y, 0)) {
        sim.destroy();
        continue;
      }
      session.onShot('standard', 10);
      run(sim, 8);
      if (sim.phase !== 'standing') {
        settle(sim);
        const r = scoreLevel(session.outcome());
        if (!best || r.total > best.total) best = r;
      }
      session.dispose();
      sim.destroy();
    }
    // Brute force.
    const brutes: LevelResult[] = [];
    const bruteShots: number[] = [];
    for (let b = 0; b < 3; b++) {
      const rng = new Random(500 + b);
      const sim = makeSim(def, level.objective, stats, 90 + b);
      sim.weapon.stats.spread = stats.spread;
      const session = new LevelSession(sim, level);
      run(sim, AIM_TIME);
      while (sim.phase === 'standing' && session.shots < 16) {
        const parts = sim.structure!.parts.filter((p) => !p.removed && !p.isFoundation);
        if (!parts.length) break;
        const p = parts[Math.floor(rng.next() * parts.length)]!;
        if (fireAt(sim, p.x, p.y, 0)) session.onShot('standard', 10);
        run(sim, GAP);
      }
      if (sim.phase !== 'standing') {
        settle(sim);
        brutes.push(scoreLevel(session.outcome()));
        bruteShots.push(session.shots);
      }
      session.dispose();
      sim.destroy();
    }
    const bAvg = brutes.length ? Math.round(brutes.reduce((a, r) => a + r.total, 0) / brutes.length) : 0;
    sumOne += best?.total ?? 0;
    sumBrute += bAvg;
    const tag = idx < indices.length ? `L${indices[idx]! + 1}` : 'proc';
    console.log(`  ${tag} ${level.name.padEnd(22)} R=${level.reward} par=${level.par} mass=${Math.round(probeMass)}kg parts=${targets.length}`);
    if (best) {
      console.log(`     one-shot: ${fmtResult(best)}  [${best.lines.map((l) => `${l.label} ${l.amount}`).join(', ')}]`);
    } else console.log(`     one-shot: none found in ${tried} aims`);
    for (let i = 0; i < brutes.length; i++) {
      const r = brutes[i]!;
      console.log(`     brute ${bruteShots[i]!.toString().padStart(2)} shots: ${fmtResult(r)}  [${r.lines.map((l) => `${l.label} ${l.amount}`).join(', ')}]`);
    }
    if (best && bAvg) console.log(`     ratio one-shot / brute avg = ${(best.total / bAvg).toFixed(2)}x`);
  }
  if (sumBrute) console.log(`  overall one-shot / brute = ${(sumOne / sumBrute).toFixed(2)}x`);
}
