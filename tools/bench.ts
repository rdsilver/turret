// Headless benchmark: increasingly large welded structures, idle + collapse.
// Walls are wide rather than tall (<= 25 courses) with load-sized welds, like the in-game
// debug benchmark: a tall wall with default welds yields under its own weight and never
// sleeps, which would make the "idle" figure measure a collapsing wall.
import RAPIER from '@dimforge/rapier2d-compat';
import { setRapier } from '../src/sim/RapierModule';
import { Simulation } from '../src/sim/Simulation';
import { Random } from '../src/core/Random';
import type { StructureDef } from '../src/sim/StructureDefinition';
await RAPIER.init();
setRapier(RAPIER as any);
const { StructureDraft } = await import('../src/sim/generator/StructureDraft');
const { sizeJoints, DEFAULT_SIZING } = await import('../src/sim/generator/modules/sizing');

function wall(cols: number, rows: number, bw = 0.8, bh = 0.5): StructureDef {
  const d = new StructureDraft(new Random(1));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const off = r % 2 ? bw / 2 : 0;
    d.add({ shape: { kind: 'box', w: bw, h: bh }, x: c * bw + off, y: bh / 2 + r * bh, material: r % 5 === 4 ? 'concrete' : 'wood' });
  }
  d.autoWeld();
  sizeJoints(d, DEFAULT_SIZING);
  return d.toDef(30);
}
for (const [cols, rows] of [[10, 10], [20, 20], [40, 25], [80, 25]] as const) {
  const sim = new Simulation();
  const t0 = performance.now();
  const s = sim.loadStructure(wall(cols, rows), undefined, 3);
  const tLoad = performance.now() - t0;
  const settleActive = sim.settleActive;
  // idle
  let t1 = performance.now();
  for (let i = 0; i < 120; i++) sim.physics.step();
  const idle = (performance.now() - t1) / 120;
  const activeIdle = sim.physics.stats.active;
  const idleNote = settleActive || activeIdle ? ` NOT ASLEEP (settle active ${settleActive}, broke ${s.settleJointsBroken}): idle figure invalid` : ' asleep';
  // collapse: explode near base
  sim.explosions.explode(s.parts[Math.floor(cols / 2)]!.x, -0.3, 4, 1.5, 'debug');
  let worst = 0; let sum = 0; let maxActive = 0;
  for (let i = 0; i < 600; i++) { const a = performance.now(); sim.physics.step(); const d = performance.now() - a; sum += d; worst = Math.max(worst, d); maxActive = Math.max(maxActive, sim.physics.stats.active); }
  console.log(`${cols}x${rows} parts=${s.parts.length} joints=${s.joints.length} load=${tLoad.toFixed(0)}ms idleStep=${idle.toFixed(3)}ms (active ${activeIdle}${idleNote}) collapse avg=${(sum/600).toFixed(2)}ms worst=${worst.toFixed(1)}ms maxActive=${maxActive} broken=${s.jointsBroken} fallen=${(s.fallenFraction*100).toFixed(0)}%`);
  sim.destroy();
}
{
  const sim = new Simulation();
  const s = sim.loadStructure(wall(40, 25), undefined, 3);
  sim.explosions.explode(s.parts[20]!.x, -0.3, 4, 1.5, 'debug');
  let step = 0, post = 0;
  for (let i = 0; i < 300; i++) { sim.physics.step(); step += sim.physics.stats.stepMs; post += sim.physics.stats.postMs; }
  console.log(`breakdown 40x25 collapse: rapier ~${(step/300).toFixed(2)}ms, post-step ~${(post/300).toFixed(2)}ms`);
}
