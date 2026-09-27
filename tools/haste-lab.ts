/**
 * Haste lab (headless): how creatures cope with a hastener's lasting speed
 * boost (Creature.speedMul), and how the hastener hands it out.
 *
 *   npx tsx tools/haste-lab.ts walk hound [--mul 1.6] [--boost 1.6] [--x 100] [--seconds 30] [--params speed=1.6]
 *        Walks one creature with the near-line hurry (--boost, speedBoost) all
 *        the way, first unhastened, then with speedMul ramped up to --mul over
 *        --ramp s (default 4) at --at s (default 6). Reports speed before and
 *        after, whether it stays upright and whole (tilt, body height, joint
 *        breaks, creaks, state), and a filmstrip. --mul cap: as far as a beam
 *        going up to --cap (default 1.6) takes this creature (its
 *        spec.maxSpeedMul may hold it lower).
 *   npx tsx tools/haste-lab.ts walk all [--mul cap]   (every walker in turn, one summary line each)
 *
 *   npx tsx tools/haste-lab.ts beam [hastener] [--allies hound,engine] [--gap 5] [--at 6] [--seconds 40]
 *        [--kill 20]   (wreck the hastener's body at t: the boosts it gave must stay)
 *        [--cut crystal@18]   (wreck one of its parts at t; ';' for more)
 *        [--params rate=0.1] [--rows 1] [--png tools/out/haste-beam.png]
 *        A hastener flying escort over walkers (as in a level: they hurry near
 *        the line). Every --rows s: who it beams, each ally's speedMul and its
 *        speed; then the ramp, what stayed after the hastener died, and a
 *        filmstrip.
 */
import { initRapier, run, snapshot, renderFilmstrip, type FrameSnap } from './lib/headless';
import { Simulation } from '../src/sim/Simulation';
import { DEFENSE_LINE_X, SPAWN_X } from '../src/game/AssaultLevel';
import { URGENCY } from '../src/game/AssaultSession';
import type { Creature } from '../src/sim/creature/Creature';

await initRapier();
await import('../src/sim/creature');
const { hasteTarget, hasteCapOf } = await import('../src/sim/creature/haste');

const args = process.argv.slice(2);
const mode = args[0] ?? 'walk';
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const params: Record<string, number | string> = {};
for (const kv of opt('params', '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  params[k!] = Number.isFinite(Number(v)) ? Number(v) : v!;
}
const DEGS = 180 / Math.PI;
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);

/** Every walking creature (with its usual level params), for `walk all`. */
const WALKERS: [string, Record<string, number>][] = [
  ['stickman', { speed: 1 }],
  ['thrower', {}],
  ['hound', { speed: 1.7 }],
  ['beetle', {}],
  ['engine', { speed: 1.05 }],
  ['shield', { speed: 0.9 }],
  ['centipede', {}],
  ['strider', { speed: 0.45 }],
  ['triceratops', { speed: 0.6, hipsHp: 4 }],
  ['trex', { speed: 0.55, legHp: 2.1 }],
  ['bomber', {}],
  ['shifter', { hp: 1.2 }],
];

interface WalkResult {
  line: string;
  ok: boolean;
}

async function walk(id: string, p: Record<string, number | string>, film: boolean): Promise<WalkResult> {
  const boost = Number(opt('boost', '1.6'));
  const at = Number(opt('at', '6'));
  const rampS = Number(opt('ramp', '4'));
  const seconds = Number(opt('seconds', '30'));
  const x0 = Number(opt('x', '100'));
  const sim = new Simulation({ seed: 5 });
  const c = sim.creatures.spawn(id, x0, p, 11);
  const mulOpt = opt('mul', '1.6');
  const mul = mulOpt === 'cap' ? hasteCapOf(c, Number(opt('cap', '1.6'))) : Number(mulOpt);
  const breaks: string[] = [];
  let creaks = 0;
  let endT = seconds;
  sim.events.on('jointBroken', (e) => {
    if (endT === seconds && e.joint.a.structure === c.structure) breaks.push(`${e.joint.name ?? '#' + e.joint.id}@${sim.physics.simTime.toFixed(1)}(${e.cause})`);
  });
  sim.events.on('jointStressed', (e) => {
    if (endT === seconds && e.joint.a.structure === c.structure) creaks++;
  });
  const rows: { t: number; x: number; vx: number; tilt: number; h: number; state: string; mul: number }[] = [];
  const frames: FrameSnap[] = [];
  const frameAt = [at - 1.5, at + rampS + 1, at + rampS + 2, at + rampS + 3, at + rampS + 4.5, at + rampS + 6];
  let fi = 0;
  let endState = '';
  run(sim, seconds, (t) => {
    // (Done: the rest of the run is left out of every count.)
    if (endT < seconds) return;
    c.speedBoost = boost;
    c.speedMul = 1 + (mul - 1) * Math.max(0, Math.min(1, (t - at) / rampS));
    rows.push({ t, x: c.core.x, vx: c.core.vx, tilt: c.core.angle * DEGS, h: c.core.height / c.bodyHeight0, state: c.state, mul: c.speedMul });
    if (film && fi < frameAt.length && t >= frameAt[fi]!) {
      frames.push(snapshot(sim, `${id} t=${t.toFixed(1)}s mul=${c.speedMul.toFixed(2)} ${c.state}`));
      fi++;
    }
    // Stop short of the turret.
    if (c.frontX < DEFENSE_LINE_X + 4 || !c.active) {
      endT = t;
      endState = `${c.state}${c.cause ? '/' + c.cause : ''}`;
    }
  });
  const win = (a: number, b: number) => rows.filter((r) => r.t >= a && r.t < b);
  const before = win(2, at);
  const after = win(at + rampS + 1, endT);
  const speed = (w: typeof rows) => (w.length > 1 ? (w[0]!.x - w[w.length - 1]!.x) / (w[w.length - 1]!.t - w[0]!.t) : NaN);
  const vBefore = speed(before);
  const vAfter = speed(after);
  const target = (m: number) => c.spec.gait.speed * boost * m;
  const tiltMax = Math.max(...rows.filter((r) => r.t > 1).map((r) => Math.abs(r.tilt)));
  const tiltAfter = after.length ? Math.max(...after.map((r) => Math.abs(r.tilt))) : NaN;
  const hMin = Math.min(...after.map((r) => r.h));
  const hMean = mean(after.map((r) => r.h));
  if (!endState) endState = `${c.state}${c.cause ? '/' + c.cause : ''}`;
  const ok = !endState.startsWith('neutralized') && breaks.length === 0 && after.length > 30 && vAfter > target(mul) * 0.75;
  const line =
    `${ok ? 'OK  ' : 'BAD '}${id.padEnd(12)} mul ${mul.toFixed(2)} boost ${boost}: ` +
    `speed ${vBefore.toFixed(2)} -> ${vAfter.toFixed(2)} m/s (target ${target(1).toFixed(2)} -> ${target(mul).toFixed(2)}, ${((vAfter / vBefore) * 100 - 100).toFixed(0)}%) ` +
    `over ${after.length ? (after[after.length - 1]!.t - after[0]!.t).toFixed(1) : 0} s | tilt max ${tiltMax.toFixed(0)}° (hastened ${tiltAfter.toFixed(0)}°) body h ${hMean.toFixed(2)} (min ${hMin.toFixed(2)}) | ` +
    `state ${endState} creaks ${creaks}${breaks.length ? ' BREAKS ' + breaks.join(' ') : ''}`;
  if (film && frames.length) {
    const png = opt('png', `tools/out/haste-walk-${id}.png`);
    const panned = frames.map((f) => {
      const x = rows.find((r) => r.t >= f.t)?.x ?? x0;
      return { ...f, shapes: f.shapes.map((q) => ({ ...q, x: q.x - x })), joints: [] };
    });
    await renderFilmstrip(panned, png, { left: -16, right: 16, top: -18, bottom: 1.5 }, { cols: 3 });
    console.log(`filmstrip ${png}`);
    const every = Number(opt('rows', '1'));
    let last = -Infinity;
    for (const r of rows) {
      if (r.t - last < every - 1e-9) continue;
      last = r.t;
      console.log(`${r.t.toFixed(1).padStart(5)}s x=${r.x.toFixed(1).padStart(6)} vx=${r.vx.toFixed(2).padStart(6)} mul=${r.mul.toFixed(2)} tilt=${r.tilt.toFixed(0).padStart(4)}° h=${r.h.toFixed(2)} ${r.state}`);
    }
  }
  return { line, ok };
}

async function beam(): Promise<void> {
  const id = args[1] && !args[1].startsWith('--') ? args[1] : 'hastener';
  const seconds = Number(opt('seconds', '40'));
  const allyIds = opt('allies', 'hound').split(',').filter(Boolean);
  const gap = Number(opt('gap', '5'));
  const birdAt = Number(opt('at', '6'));
  const killAt = Number(opt('kill', 'Infinity'));
  const rowsEvery = Number(opt('rows', '1'));
  const png = opt('png', `tools/out/haste-beam-${id}.png`);
  const cuts = opt('cut', '')
    .split(';')
    .filter(Boolean)
    .map((e) => {
      const [name, t] = e.split('@');
      return { name: name!, at: Number(t ?? 0), done: false };
    });
  const allyParams = (i: number): Record<string, number> => WALKERS.find(([w]) => w === allyIds[i])?.[1] ?? {};
  const sim = new Simulation({ seed: 5 });
  const allies: Creature[] = [];
  let bird: Creature | null = null;
  const log: string[] = [];
  const ev = (s: string) => log.push(`${sim.physics.simTime.toFixed(2)}s ${s}`);
  sim.events.on('partWrecked', (e) => ev(`WRECKED ${e.part.name}`));
  sim.events.on('creatureNeutralized', (e) => ev(`STOPPED ${e.creature.spec.name}#${e.creature.id} (${e.cause}) at x=${e.x.toFixed(1)} h=${(-e.y).toFixed(1)} speedMul ${e.creature.speedMul.toFixed(2)}`));
  let hasted = 0;
  sim.events.on('creatureHasted', (e) => {
    if (hasted++ % 20 === 0) ev(`hasted ${e.creature.spec.name}#${e.creature.id} -> speedMul ${e.speedMul.toFixed(2)}`);
    if (e.maxed) ev(`${e.creature.spec.name}#${e.creature.id} MAXED at ${e.speedMul.toFixed(2)}`);
  });
  const frames: FrameSnap[] = [];
  const frameX: number[] = [];
  const frameAt = [birdAt + 3, birdAt + 6, birdAt + 9, birdAt + 12, ...(Number.isFinite(killAt) ? [killAt + 1, killAt + 5] : [birdAt + 15, birdAt + 18])];
  let fi = 0;
  let nextRow = 0;
  // Each ally's position a second ago (speed over the last second).
  const hist = new Map<Creature, { t: number; x: number }[]>();
  const speed1s = (k: Creature) => {
    const h = hist.get(k);
    if (!h || h.length < 2) return NaN;
    const a = h[0]!;
    const b = h[h.length - 1]!;
    return (a.x - b.x) / Math.max(0.01, b.t - a.t);
  };
  const atKill: string[] = [];
  run(sim, seconds, (t) => {
    for (let i = 0; i < allyIds.length; i++) {
      if (allies.length === i && t >= i * gap) allies.push(sim.creatures.spawn(allyIds[i]!, SPAWN_X, allyParams(i), 21 + i));
    }
    if (!bird && t >= birdAt) bird = sim.creatures.spawn(id, SPAWN_X, params, 11);
    const b = bird as Creature | null;
    for (const cu of cuts) {
      if (cu.done || t < cu.at || !b) continue;
      cu.done = true;
      const p = b.structure.part(cu.name);
      if (p && !p.removed && !p.wrecked) sim.damage.wreck(p, p.x, p.y);
    }
    if (b && t >= killAt && b.active) {
      atKill.push(...allies.map((k) => `${k.spec.name}#${k.id} speedMul ${k.speedMul.toFixed(3)}`));
      const body = b.core;
      sim.damage.wreck(body, body.x, body.y);
    }
    for (const k of [...allies, ...(b ? [b] : [])]) {
      const d = k.frontX - DEFENSE_LINE_X;
      k.speedBoost = 1 + URGENCY * Math.max(0, Math.min(1, 1 - d / (SPAWN_X - DEFENSE_LINE_X)));
    }
    for (const k of allies) {
      let h = hist.get(k);
      if (!h) hist.set(k, (h = []));
      h.push({ t, x: k.core.x });
      while (h.length && h[0]!.t < t - 1) h.shift();
    }
    if (fi < frameAt.length && t >= frameAt[fi]!) {
      const tg = b ? hasteTarget(b) : null;
      frames.push(snapshot(sim, `t=${t.toFixed(1)}s${tg ? ` beaming ${tg.spec.name} (x${tg.speedMul.toFixed(2)})` : ''}`));
      // Centred between the hastener and what it escorts (or on the lead ally once it is gone).
      const lead = allies.find((k) => k.active) ?? allies[0];
      frameX.push(b && !b.core.removed && b.active ? (b.core.x + (tg ?? lead ?? b).core.x) / 2 : (lead?.core.x ?? 30));
      fi++;
    }
    if (t >= nextRow - 1e-9) {
      nextRow = t + rowsEvery;
      const tg = b ? hasteTarget(b) : null;
      const bs = b && !b.core.removed ? `bird x=${b.core.x.toFixed(1)} h=${b.core.height.toFixed(1)} ${b.state} prio=${b.targetPriority.toFixed(1)}${tg ? ` beaming ${tg.spec.name}#${tg.id}` : ''}` : 'bird -';
      const as = allies.map((k) => `${k.spec.name}#${k.id} x=${k.frontX.toFixed(1)} mul=${k.speedMul.toFixed(2)} v=${speed1s(k).toFixed(2)} (boost ${k.speedBoost.toFixed(2)}) ${k.state}`).join(' | ');
      console.log(`${t.toFixed(1).padStart(5)}s ${bs} || ${as}`);
    }
  });
  console.log('\n' + log.join('\n'));
  if (atKill.length) console.log(`\nat the kill: ${atKill.join(', ')}`);
  console.log(`at the end: ${allies.map((k) => `${k.spec.name}#${k.id} speedMul ${k.speedMul.toFixed(3)} ${k.state}`).join(', ')}`);
  if (frames.length) {
    const panned = frames.map((f, i) => ({ ...f, shapes: f.shapes.map((q) => ({ ...q, x: q.x - frameX[i]! + 15 })), joints: [] }));
    await renderFilmstrip(panned, png, { left: 0, right: 30, top: -22, bottom: 1 }, { cols: 3 });
    console.log('filmstrip', png);
  }
}

if (mode === 'walk') {
  const id = args[1] && !args[1].startsWith('--') ? args[1] : 'hound';
  if (id === 'all') {
    let bad = 0;
    for (const [w, p] of WALKERS) {
      const r = await walk(w, { ...p, ...params }, false);
      console.log(r.line);
      if (!r.ok) bad++;
    }
    console.log(bad ? `${bad} of ${WALKERS.length} walkers BAD` : `all ${WALKERS.length} walkers OK`);
  } else {
    const base = WALKERS.find(([w]) => w === id)?.[1] ?? {};
    const r = await walk(id, { ...base, ...params }, true);
    console.log(r.line);
  }
} else if (mode === 'beam') await beam();
else throw new Error(`unknown mode ${mode} (walk | beam)`);
