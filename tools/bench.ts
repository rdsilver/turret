// Headless benchmark: increasingly large welded structures, idle + collapse.
import RAPIER from '@dimforge/rapier2d-compat';
import { setRapier } from '../src/sim/RapierModule';
import { Simulation } from '../src/sim/Simulation';
import type { StructureDef, PartDef, JointDef } from '../src/sim/StructureDefinition';
await RAPIER.init();
setRapier(RAPIER as any);

function wall(cols: number, rows: number, bw = 0.8, bh = 0.5): StructureDef {
  const parts: PartDef[] = []; const joints: JointDef[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const off = r % 2 ? bw / 2 : 0;
    parts.push({ shape: { kind: 'box', w: bw, h: bh }, x: c * bw + off, y: bh / 2 + r * bh, material: r % 5 === 4 ? 'concrete' : 'wood' });
  }
  const idx = (r: number, c: number) => r * cols + c;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (r === 0) joints.push({ kind: 'weld', a: idx(r, c), b: 'ground' });
    if (c > 0) joints.push({ kind: 'weld', a: idx(r, c), b: idx(r, c - 1) });
    if (r > 0) { joints.push({ kind: 'weld', a: idx(r, c), b: idx(r - 1, c) }); const c2 = r % 2 ? c + 1 : c - 1; if (c2 >= 0 && c2 < cols) joints.push({ kind: 'weld', a: idx(r, c), b: idx(r - 1, c2) }); }
  }
  return { originX: 30, parts, joints };
}
for (const [cols, rows] of [[10, 10], [20, 20], [30, 34], [40, 50]] as const) {
  const sim = new Simulation();
  const t0 = performance.now();
  const s = sim.loadStructure(wall(cols, rows), undefined, 3);
  const tLoad = performance.now() - t0;
  // idle
  let t1 = performance.now();
  for (let i = 0; i < 120; i++) sim.physics.step();
  const idle = (performance.now() - t1) / 120;
  const activeIdle = sim.physics.stats.active;
  // collapse: explode near base
  sim.explosions.explode(s.parts[Math.floor(cols / 2)]!.x, -0.3, 4, 1.5, 'debug');
  let worst = 0; let sum = 0; let maxActive = 0;
  for (let i = 0; i < 600; i++) { const a = performance.now(); sim.physics.step(); const d = performance.now() - a; sum += d; worst = Math.max(worst, d); maxActive = Math.max(maxActive, sim.physics.stats.active); }
  console.log(`${cols}x${rows} parts=${s.parts.length} joints=${s.joints.length} load=${tLoad.toFixed(0)}ms idleStep=${idle.toFixed(3)}ms (active ${activeIdle}) collapse avg=${(sum/600).toFixed(2)}ms worst=${worst.toFixed(1)}ms maxActive=${maxActive} broken=${s.jointsBroken} fallen=${(s.fallenFraction*100).toFixed(0)}%`);
  sim.destroy();
}
{
  const sim = new Simulation();
  const s = sim.loadStructure(wall(30, 34), undefined, 3);
  sim.explosions.explode(s.parts[15]!.x, -0.3, 4, 1.5, 'debug');
  let step = 0, post = 0;
  for (let i = 0; i < 300; i++) { sim.physics.step(); step += sim.physics.stats.stepMs; post += sim.physics.stats.postMs; }
  console.log(`breakdown 30x34 collapse: rapier ~${(step/300).toFixed(2)}ms, post-step ~${(post/300).toFixed(2)}ms`);
}
