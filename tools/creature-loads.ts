/**
 * Structural margins: walks every creature (or a list) for 8 s unshot and
 * prints the three most loaded joints (force / yield, or damage) — anything
 * near 1.0 will snap on its own.
 *   npx tsx tools/creature-loads.ts [stickman,strider]
 */
import { initRapier } from './lib/headless';
import { Simulation } from '../src/sim/Simulation';
import { creatureIds } from '../src/sim/creature/CreatureTypes';
await initRapier();
await import('../src/sim/creature');
const ids = process.argv[2] ? process.argv[2].split(',') : creatureIds();
for (const id of ids) {
  const sim = new Simulation({ seed: 5 });
  const c = sim.creatures.spawn(id, 45, {}, 11);
  const peak = new Map<string, number>();
  const broken: string[] = [];
  sim.events.on('jointBroken', (e) => broken.push(`${e.joint.name ?? '#' + e.joint.id}@${sim.physics.simTime.toFixed(2)}(${e.cause})`));
  for (let i = 0; i < 60 * 8; i++) {
    sim.physics.step();
    for (const j of c.structure.joints) {
      if (j.broken) continue;
      const k = j.name ?? `#${j.id}(${j.a.name}-${j.b?.name})`;
      const r = Math.max(j.force / j.yieldForce, j.damage);
      if (r > (peak.get(k) ?? 0)) peak.set(k, r);
    }
  }
  const top = [...peak.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ');
  console.log(`${id.padEnd(10)} walked ${(45 - c.x).toFixed(1)}m state=${c.state} top: ${top}${broken.length ? ' BROKEN ' + broken.join(',') : ''}`);
}
