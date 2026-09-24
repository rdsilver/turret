import RAPIER from '@dimforge/rapier2d-compat';
import { setRapier } from '../src/sim/RapierModule';
import { Simulation } from '../src/sim/Simulation';
import { solveAim } from '../src/sim/ballistics';
import type { StructureDef, PartDef, JointDef } from '../src/sim/StructureDefinition';
await RAPIER.init();
setRapier(RAPIER as any);

// A two-storey wood frame: 3 columns per floor + floor beams, welded.
function frame(): StructureDef {
  const parts: PartDef[] = []; const joints: JointDef[] = [];
  const add = (p: PartDef) => (parts.push(p), parts.length - 1);
  let below: number[] = [];
  for (let f = 0; f < 4; f++) {
    const y0 = f * 3.3;
    const cols = [-2.5, 0, 2.5].map((x) => add({ shape: { kind: 'box', w: 0.35, h: 3 }, x, y: y0 + 1.5, material: 'wood' }));
    const beam = add({ shape: { kind: 'box', w: 5.6, h: 0.3 }, x: 0, y: y0 + 3.15, material: 'wood' });
    cols.forEach((c) => { joints.push(f === 0 ? { kind: 'weld', a: c, b: 'ground' } : { kind: 'weld', a: c, b: below[0]! }); joints.push({ kind: 'weld', a: c, b: beam }); });
    below = [beam];
  }
  return { originX: 36, parts, joints };
}
const sim = new Simulation({ seed: 3 });
const log: string[] = [];
sim.events.on('jointBroken', (e) => log.push(`${sim.physics.simTime.toFixed(2)} break ${e.cause} stress=${e.stress.toFixed(2)}`));
sim.events.on('projectileImpact', (e) => e.first && log.push(`${sim.physics.simTime.toFixed(2)} IMPACT speed=${e.speed.toFixed(1)} impulse=${e.impulse.toFixed(0)}`));
sim.events.on('bigCollapse', (e) => log.push(`${sim.physics.simTime.toFixed(2)} BIG COLLAPSE ${e.intensity.toFixed(2)}`));
sim.events.on('objectiveComplete', (e) => log.push(`${sim.physics.simTime.toFixed(2)} OBJECTIVE ${e.description}`));
sim.events.on('collapseSettled', () => log.push(`${sim.physics.simTime.toFixed(2)} SETTLED`));
sim.events.on('chainEnded', (e) => log.push(`${sim.physics.simTime.toFixed(2)} chain ended joints=${e.joints} parts=${e.parts} mass=${e.mass.toFixed(0)}`));
const s = sim.loadStructure(frame());
console.log('loaded parts', s.parts.length, 'joints', s.joints.length, 'mass', s.trackedMass.toFixed(0), 'height', s.height0.toFixed(1), 't', sim.physics.simTime.toFixed(2), 'active', sim.physics.stats.active);
const target = s.parts[0]!; // bottom-left column
const m = sim.weapon.muzzle();
const angles = solveAim(m.x, m.y, target.x, target.y - 0.5, sim.weapon.speed, sim.physics.gravity);
console.log('aim angles (deg)', angles.map(a => (a * 180 / Math.PI).toFixed(1)));
sim.weapon.setAngle(angles[0]!);
sim.fire();
for (let i = 0; i < 60 * 12; i++) sim.physics.step();
console.log(log.join('\n'));
console.log('phase', sim.phase, 'fallen', (s.fallenFraction * 100).toFixed(0) + '%', 'belowLine', (s.belowLineFraction * 100).toFixed(0) + '%', 'broken', s.jointsBroken);
