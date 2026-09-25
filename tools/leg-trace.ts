/**
 * Gait tuning: prints one leg's muscle targets vs actual angles, torques and
 * foot contact every few physics steps.
 *   npx tsx tools/leg-trace.ts hound FL 3 4.2 2 speed=1.4,omega=90
 *   (creature, leg suffix, from s, to s, every n steps, blueprint params)
 */
import { initRapier } from './lib/headless';
import { Simulation } from '../src/sim/Simulation';
import { wrapAngle } from '../src/core/math';
await initRapier();
await import('../src/sim/creature');
const [id = 'hound', side = 'FL', t0s = '3', t1s = '4.2', every = '3', ps = ''] = process.argv.slice(2);
const params: Record<string, number> = {};
for (const kv of ps.split(',').filter(Boolean)) { const [k, v] = kv.split('='); params[k!] = Number(v); }
const sim = new Simulation({ seed: 5 });
const c = sim.creatures.spawn(id, 45, params, 11);
const hip = c.muscles.get(`hip${side}`)!, knee = c.muscles.get(`knee${side}`)!;
const foot = c.structure.part(`foot${side}`)!;
const leg = c.legs.find((l) => l.foot === foot)!;
const rel = (j: any) => wrapAngle((j.b ? j.b.angle : 0) - j.a.angle - j.restAngle);
let i = 0;
while (sim.physics.simTime < Number(t1s)) {
  sim.physics.step();
  if (sim.physics.simTime >= Number(t0s) && i++ % Number(every) === 0) {
    console.log(`t=${sim.physics.simTime.toFixed(2)} ph=${(c.phase % 1).toFixed(2)} ${leg.swinging ? 'SW' : 'st'} vx=${c.core.vx.toFixed(2)} pitch=${((c.core.angle * 180) / Math.PI).toFixed(0)} bodyH=${c.core.height.toFixed(2)} | hip d=${hip.drive.toFixed(2)} a=${rel(hip).toFixed(2)} M=${hip.moment.toFixed(0)}/${hip.torqueNow.toFixed(0)} | knee d=${knee.drive.toFixed(2)} a=${rel(knee).toFixed(2)} M=${knee.moment.toFixed(0)}/${knee.torqueNow.toFixed(0)} | foot h=${(foot.height - foot.halfHeightNow).toFixed(2)} x=${foot.x.toFixed(2)} vx=${foot.vx.toFixed(2)} fr=${foot.collider.friction().toFixed(2)}`);
  }
}
