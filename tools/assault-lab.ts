/**
 * Assault lab: plays an assault level headlessly with a simple bot gunner
 * (aims at the nearest creature's chosen target part, lets the barrel cool
 * when hot) to check the level is winnable with a given weapon, and how close
 * the creatures get.
 *
 *   npx tsx tools/assault-lab.ts a01 [--stats mg|mg2|mg3] [--aim shinL|torso|sling|...] [--png path]
 */
import { initRapier, run, snapshot, renderFilmstrip, type FrameSnap } from './lib/headless';
import { Simulation } from '../src/sim/Simulation';
import { BASE_MG_STATS, type WeaponStats } from '../src/sim/weapons/Weapon';
import { AMMO } from '../src/data/ammo';
import { solveAim } from '../src/sim/ballistics';
import { AssaultSession } from '../src/game/AssaultSession';
import { scoreAssault } from '../src/game/AssaultScoring';
import { ASSAULT_LEVELS } from '../src/data/assault/levels';
import { DEFENSE_LINE_X } from '../src/game/AssaultLevel';

await initRapier();
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) ?? 'a01';
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const DEG = Math.PI / 180;
const PRESETS: Record<string, WeaponStats> = {
  mg: { ...BASE_MG_STATS },
  mg2: { ...BASE_MG_STATS, reloadTime: 1 / 5.5, damage: 0.9, spread: 2 * DEG, coolRate: 0.32 },
  mg3: { ...BASE_MG_STATS, reloadTime: 1 / 8, damage: 1.3, spread: 1.2 * DEG, coolRate: 0.42, projectileMass: 1.2 },
};
const stats = PRESETS[opt('stats', 'mg')] ?? PRESETS.mg!;
const aimPart = opt('aim', 'auto');
const png = opt('png', `tools/out/assault-${id}.png`);
const level = ASSAULT_LEVELS.find((l) => l.id === id);
if (!level) throw new Error(`no level ${id}`);

const sim = new Simulation({ seed: 3, weaponStats: stats, ammo: AMMO.bullet });
const session = new AssaultSession(sim, level);
const frames: FrameSnap[] = [];
const log: string[] = [];
const ev = (s: string) => log.push(`${session.elapsed.toFixed(1)}s ${s}`);
sim.events.on('creatureSpawned', ({ creature }) => ev(`spawn ${creature.spec.name}`));
sim.events.on('creatureNeutralized', (e) => ev(`STOPPED ${e.creature.spec.name} (${e.cause}) at ${(e.x - DEFENSE_LINE_X).toFixed(1)} m from the line`));
sim.events.on('partWrecked', (e) => ev(`wrecked ${e.part.name}`));
sim.events.on('creatureAbility', (e) => ev(`${e.creature.spec.name}: ${e.ability}`));
sim.events.on('breach', (e) => ev(`BREACH by ${e.creature.spec.name}`));
let cooling = false;
let lastFrame = -10;
run(sim, 120, () => {
  session.update();
  if (session.state !== 'running') return;
  // Bot gunner: target the closest active creature.
  let target = null as null | { x: number; y: number };
  let best = Infinity;
  for (const c of session.creatures) {
    if (!c.active || c.core.removed || c.age < 0.5) continue;
    if (c.x < best) {
      best = c.x;
      const want = aimPart === 'auto' ? (c.structure.part('sling') && !c.structure.part('sling')!.wrecked ? 'sling' : 'shinL') : aimPart;
      const p = c.structure.part(want) ?? c.core;
      target = p.removed || p.wrecked ? { x: c.core.x, y: c.core.y } : { x: p.x, y: p.y };
    }
  }
  const w = sim.weapon;
  if (w.heat > 0.92) cooling = true;
  if (cooling && w.heat < 0.4) cooling = false;
  if (target && !cooling) {
    const m = w.muzzle();
    const sol = solveAim(m.x, m.y, target.x, target.y, w.speed, sim.physics.gravity);
    if (sol.length) w.setAngle(sol[0]!);
    w.triggerHeld = true;
  } else w.triggerHeld = false;
  if (session.elapsed - lastFrame > 6) {
    lastFrame = session.elapsed;
    frames.push(snapshot(sim, `${level.name} t=${session.elapsed.toFixed(0)}s`));
  }
});
const o = session.outcome();
const r = scoreAssault(o);
console.log(log.join('\n'));
console.log(`\nRESULT ${id} ${level.name}: ${o.won ? 'WON' : 'LOST'} in ${o.time.toFixed(1)}s, stopped ${o.stopped}/${o.creatures}, closest ${o.closest.toFixed(1)} m, shots ${o.shots} hits ${o.hits}, limbs ${o.limbsSevered}, distanceScore ${o.distanceScore.toFixed(2)}`);
console.log(`PAYOUT $${r.total} grade ${r.grade} ${r.titles.join(',')} :: ${r.lines.map((l) => `${l.label} ${l.amount}`).join(', ')}`);
frames.push(snapshot(sim, `end ${o.won ? 'WON' : 'LOST'}`));
await renderFilmstrip(frames.slice(-8), png, { left: 0, right: 64, top: -12, bottom: 1.5 }, { cols: 4 });
console.log('filmstrip', png);
