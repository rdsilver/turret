import { initRapier } from './lib/headless';
import { Simulation } from '../src/sim/Simulation';
import { wrapAngle } from '../src/core/math';
await initRapier();
await import('../src/sim/creature');
const sim = new Simulation({ seed: 5 });
const c = sim.creatures.spawn(process.argv[2] ?? 'stickman', 45, {}, 11);
const hipL = c.muscles.get(process.argv[3] ?? 'hipL')!, kneeL = c.muscles.get(process.argv[4] ?? 'kneeL')!, hipR = c.muscles.get(process.argv[5] ?? 'hipR')!;
const rel = (j: any) => wrapAngle((j.b ? j.b.angle : 0) - j.a.angle - j.restAngle);
for (let i = 0; i < 60 * 6; i++) {
  sim.physics.step();
  if (i % 10 === 0 && i > 60) {
    const fL = c.structure.part(process.argv[6] ?? 'footL')!, fR = c.structure.part(process.argv[7] ?? 'footR')!;
    console.log(`t=${sim.physics.simTime.toFixed(2)} ph=${c.phase.toFixed(2)} x=${c.x.toFixed(2)} vx=${c.core.vx.toFixed(2)} | hipL drv=${hipL.drive.toFixed(2)} act=${rel(hipL).toFixed(2)} T=${hipL.torqueNow.toFixed(0)} | kneeL drv=${kneeL.drive.toFixed(2)} act=${rel(kneeL).toFixed(2)} | hipR drv=${hipR.drive.toFixed(2)} act=${rel(hipR).toFixed(2)} | footL h=${(fL.height - fL.halfHeightNow).toFixed(2)} x=${fL.x.toFixed(2)} footR h=${(fR.height - fR.halfHeightNow).toFixed(2)} x=${fR.x.toFixed(2)} mass=${c.mass.toFixed(0)}`);
  }
}
