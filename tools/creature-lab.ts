/**
 * Creature lab: headless walk + shooting tests with filmstrips.
 *
 *   npx tsx tools/creature-lab.ts stickman [--seconds 20] [--x 45] [--shoot kneeL|torso|...]
 *        [--start 3] [--stats mg|mg2|mg3] [--png tools/out/creature-stickman.png] [--frames 0.5,2,4,8]
 *
 * Reports walking speed, stability (does it stay upright unshot?), time to
 * reach the defense line, and — with --shoot — how long/how many rounds it
 * takes to stop it by holding fire on one part.
 */
import { initRapier, run, snapshot, renderFilmstrip, type FrameSnap } from './lib/headless';
import { Simulation } from '../src/sim/Simulation';
import { BASE_MG_STATS, type WeaponStats } from '../src/sim/weapons/Weapon';
import { AMMO } from '../src/data/ammo';
import { solveAim } from '../src/sim/ballistics';
import { DEFENSE_LINE_X } from '../src/game/AssaultLevel';

await initRapier();
await import('../src/sim/creature');

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) ?? 'stickman';
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const seconds = Number(opt('seconds', '20'));
const spawnX = Number(opt('x', '45'));
const shoot = opt('shoot', '');
const start = Number(opt('start', '3'));
const png = opt('png', `tools/out/creature-${id}${shoot ? '-' + shoot : ''}.png`);
const frameTimes = opt('frames', shoot ? `${start},${start + 1},${start + 2},${start + 3},${start + 5},${seconds - 0.1}` : '0.4,1.5,3,5,8,12').split(',').map(Number);
const PRESETS: Record<string, WeaponStats> = {
  mg: { ...BASE_MG_STATS },
  mg2: { ...BASE_MG_STATS, reloadTime: 1 / 7, damage: 1.5, spread: 1.4 * (Math.PI / 180) },
  mg3: { ...BASE_MG_STATS, reloadTime: 1 / 10, damage: 2.2, spread: 0.8 * (Math.PI / 180), projectileMass: 4 },
};
const stats = PRESETS[opt('stats', 'mg')] ?? PRESETS.mg!;

const sim = new Simulation({ seed: 5, weaponStats: stats, ammo: AMMO.bullet });
const c = sim.creatures.spawn(id, spawnX, {}, 11);
const log: string[] = [];
const ev = (s: string) => log.push(`${sim.physics.simTime.toFixed(2)}s ${s}`);
let rounds = 0;
let hits = 0;
sim.events.on('projectileFired', () => rounds++);
sim.events.on('partDamaged', (e) => {
  hits++;
  if (hits % 5 === 1) ev(`hit ${e.part.name ?? e.part.index} integrity=${e.integrity.toFixed(2)}`);
});
sim.events.on('jointBroken', (e) => ev(`JOINT BROKEN ${e.joint.name ?? '#' + e.joint.id} (${e.cause})`));
sim.events.on('partWrecked', (e) => ev(`WRECKED ${e.part.name}`));
sim.events.on('creatureNeutralized', (e) => ev(`NEUTRALIZED cause=${e.cause} at x=${e.x.toFixed(1)}`));
sim.events.on('creatureAbility', (e) => ev(`ability ${e.ability}`));

const frames: FrameSnap[] = [];
let fi = 0;
let reachedLine = -1;
let lastPrint = 0;
const rows: string[] = [];
const target = shoot ? c.structure.part(shoot) : undefined;
if (shoot && !target) throw new Error(`no part "${shoot}" (parts: ${c.structure.parts.map((p) => p.name).join(', ')})`);

run(sim, seconds, (t) => {
  if (target && t >= start && c.active && !target.removed) {
    const w = sim.weapon;
    const m = w.muzzle();
    const sol = solveAim(m.x, m.y, target.x, target.y, w.speed, sim.physics.gravity);
    if (sol.length) w.setAngle(sol[0]!);
    w.triggerHeld = true;
  } else sim.weapon.triggerHeld = false;
  if (reachedLine < 0 && c.active && c.x < DEFENSE_LINE_X) reachedLine = t;
  if (t - lastPrint >= 1) {
    lastPrint = t;
    const tilt = (c.core.angle * 180) / Math.PI;
    rows.push(
      `${t.toFixed(1).padStart(5)}s x=${c.x.toFixed(2).padStart(6)} vx=${c.core.vx.toFixed(2).padStart(5)} state=${c.state.padEnd(11)} legs=${c.functionalLegs}/${c.legs.length} cap=${c.capacity.toFixed(2)} power=${c.power.toFixed(2)} tilt=${tilt.toFixed(0).padStart(4)}° bodyH=${c.core.height.toFixed(2)} heat=${sim.weapon.heat.toFixed(2)}`,
    );
  }
  if (fi < frameTimes.length && t >= frameTimes[fi]!) {
    frames.push(snapshot(sim, `${id} t=${t.toFixed(1)}s ${c.state}`));
    fi++;
  }
});

console.log(rows.join('\n'));
console.log(log.slice(0, 60).join('\n'));
const walked = spawnX - c.x;
console.log(
  `\nSUMMARY ${id}: walked ${walked.toFixed(1)} m in ${seconds}s (avg ${(walked / seconds).toFixed(2)} m/s), state=${c.state} cause=${c.cause ?? '-'}, reached line at ${reachedLine >= 0 ? reachedLine.toFixed(1) + 's' : 'never'}, rounds fired=${rounds} hits=${hits}`,
);
const cx = Math.min(spawnX, c.x);
await renderFilmstrip(frames, png, { left: cx - 9, right: spawnX + 5, top: -8, bottom: 1.5 }, { cols: 3 });
console.log('filmstrip', png);
