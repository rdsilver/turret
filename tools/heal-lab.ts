/**
 * Heal lab: a healer flying escort over walkers (headless) — does it take
 * station over its ally and keep pace steadily, how fast does it mend a
 * wounded part, and what happens when its lamp or a wing is shot off?
 *
 *   npx tsx tools/heal-lab.ts [mender] [--allies hound,engine] [--gap 5] [--at 6] [--seconds 40]
 *        [--wound shinFL=0.3@14]   (set ally #0's part to that integrity at t=14 s; repeat with ';')
 *        [--cut lamp@22]           (wreck one of the healer's parts at t; ';' for more)
 *        [--stop 30]               (stop every ally at t: the healer should head for the line)
 *        [--params heal=3] [--rows 1] [--png tools/out/heal-lab.png]
 *
 * Reports, every --rows seconds: the healer's position over its ally (dx =
 * healer x minus the ally's middle, dh = healer height above the ally's top),
 * what it escorts, and each wounded part's integrity / weakest joint strength.
 * Then: flight steadiness while escorting (pitch, vertical jitter against the
 * commanded altitude, horizontal jitter), heal rates, and a filmstrip.
 */
import { initRapier, run, snapshot, renderFilmstrip, type FrameSnap } from './lib/headless';
import { Simulation } from '../src/sim/Simulation';
import { PHYSICS_DT } from '../src/config/constants';
import { DEFENSE_LINE_X, SPAWN_X } from '../src/game/AssaultLevel';
import type { Creature } from '../src/sim/creature/Creature';
import type { StructurePart } from '../src/sim/StructurePart';

await initRapier();
await import('../src/sim/creature');
const { escortOf } = await import('../src/sim/creature/healing');

const args = process.argv.slice(2);
// The healer id: the first argument that is neither a flag nor a flag's value.
const id = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1]!.startsWith('--'))) ?? 'mender';
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const seconds = Number(opt('seconds', '40'));
const allyIds = opt('allies', 'hound').split(',').filter(Boolean);
const gap = Number(opt('gap', '5'));
const healerAt = Number(opt('at', '6'));
const rowsEvery = Number(opt('rows', '1'));
const stopAt = Number(opt('stop', 'Infinity'));
const png = opt('png', `tools/out/heal-lab-${id}.png`);
const params: Record<string, number | string> = {};
for (const kv of opt('params', '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  params[k!] = Number.isFinite(Number(v)) ? Number(v) : v!;
}
const parseAt = (s: string) =>
  s
    .split(';')
    .filter(Boolean)
    .map((e) => {
      const [what, at] = e.split('@');
      const [name, val] = what!.split('=');
      return { name: name!, val: Number(val ?? 0), at: Number(at ?? 0), done: false };
    });
const wounds = parseAt(opt('wound', ''));
const cuts = parseAt(opt('cut', ''));

const sim = new Simulation({ seed: 5 });
const allies: Creature[] = [];
let healer: Creature | null = null;
const log: string[] = [];
const ev = (s: string) => log.push(`${sim.physics.simTime.toFixed(2)}s ${s}`);
sim.events.on('partWrecked', (e) => ev(`WRECKED ${e.part.name}`));
sim.events.on('creatureNeutralized', (e) => ev(`STOPPED ${e.creature.spec.name} (${e.cause}) at x=${e.x.toFixed(1)} h=${(-e.y).toFixed(1)}`));
const healed = new Map<StructurePart, number>();
let healedTotal = 0;
sim.events.on('partHealed', (e) => {
  healed.set(e.part, (healed.get(e.part) ?? 0) + e.amount);
  healedTotal += e.amount;
});

interface Sample {
  t: number;
  h: number;
  ref: number;
  x: number;
  vx: number;
  deg: number;
  escorting: boolean;
  dx: number;
  dh: number;
}
const samples: Sample[] = [];
const watched: { part: StructurePart; from: number; t0: number; log: string[] }[] = [];
const frames: FrameSnap[] = [];
const frameTimes = opt('frames', '')
  .split(',')
  .filter(Boolean)
  .map(Number);
const autoFrames = frameTimes.length ? frameTimes : [healerAt + 2, healerAt + 6, ...wounds.map((w) => w.at + 0.5), ...wounds.map((w) => w.at + 3), ...cuts.map((c) => c.at + 1.5)].slice(0, 8);
let nextRow = 0;

/** An ally's middle (mass-weighted x) and highest point. */
function allyShape(k: Creature): { mx: number; top: number } {
  let mx = 0;
  let m = 0;
  let top = 0;
  for (const p of k.structure.parts) {
    if (p.removed || p.wrecked || !k.owns(p)) continue;
    mx += p.x * p.mass;
    m += p.mass;
    top = Math.max(top, p.height + p.halfHeightNow);
  }
  return { mx: m > 0 ? mx / m : k.x, top };
}

function weakestJoint(p: StructurePart): number {
  let s = 1;
  for (const j of p.joints) if (!j.broken) s = Math.min(s, j.strengthScale);
  return s;
}

run(sim, seconds, (t) => {
  for (let i = 0; i < allyIds.length; i++) {
    if (allies.length === i && t >= i * gap) allies.push(sim.creatures.spawn(allyIds[i]!, SPAWN_X, {}, 21 + i));
  }
  if (!healer && t >= healerAt) healer = sim.creatures.spawn(id, SPAWN_X, params, 11);
  for (const w of wounds) {
    if (w.done || t < w.at || !allies[0]) continue;
    w.done = true;
    const p = allies[0].structure.part(w.name);
    if (!p || p.removed || p.wrecked) throw new Error(`no part ${w.name} on ${allies[0].spec.name}`);
    const from = p.integrity;
    // Pierce everything: set the integrity exactly.
    sim.damage.apply(p, (p.integrity - w.val) * p.maxHp, p.x, p.y, 1);
    ev(`wound ${allies[0].spec.name}.${w.name}: integrity ${from.toFixed(2)} -> ${p.integrity.toFixed(2)} (${((from - p.integrity) * p.maxHp).toFixed(1)} of ${p.maxHp.toFixed(1)} HP), weakest joint ${weakestJoint(p).toFixed(2)}`);
    watched.push({ part: p, from: p.integrity, t0: t, log: [] });
  }
  for (const c of cuts) {
    if (c.done || t < c.at || !healer) continue;
    c.done = true;
    const p = healer.structure.part(c.name);
    if (p && !p.removed && !p.wrecked) sim.damage.wreck(p, p.x, p.y);
  }
  if (t >= stopAt) for (const k of allies) if (k.active) k.neutralize('killed');
  // As in a level: creatures hurry near the line.
  for (const k of [...allies, ...(healer ? [healer] : [])]) {
    const d = k.frontX - DEFENSE_LINE_X;
    k.speedBoost = 1 + 0.6 * Math.max(0, Math.min(1, 1 - d / (SPAWN_X - DEFENSE_LINE_X)));
  }
  const hc = healer as Creature | null;
  if (hc && !hc.core.removed && hc.active) {
    const k = escortOf(hc);
    const s = k ? allyShape(k) : null;
    samples.push({
      t,
      h: hc.core.height,
      ref: hc.flyRef,
      x: hc.core.x,
      vx: hc.core.vx,
      deg: (-hc.core.angle * 180) / Math.PI,
      escorting: !!k,
      dx: s ? hc.core.x - s.mx : NaN,
      dh: s ? hc.core.height - s.top : NaN,
    });
  }
  if (t >= nextRow - 1e-9) {
    nextRow = t + rowsEvery;
    const k = hc ? escortOf(hc) : null;
    const s = k ? allyShape(k) : null;
    const hs = hc && !hc.core.removed ? `healer x=${hc.core.x.toFixed(1)} h=${hc.core.height.toFixed(1)} vx=${hc.core.vx.toFixed(2)} ${hc.state}` : 'healer -';
    const es = k && s && hc ? ` over ${k.spec.name}#${k.id} (mid x=${s.mx.toFixed(1)} top=${s.top.toFixed(1)}): dx=${(hc.core.x - s.mx).toFixed(2)} dh=${(hc.core.height - s.top).toFixed(2)}` : '';
    const ws = watched.map((w) => ` ${w.part.name}=${w.part.integrity.toFixed(2)}/j${weakestJoint(w.part).toFixed(2)}`).join('');
    console.log(`${t.toFixed(1).padStart(5)}s ${hs}${es}${ws}  healed ${healedTotal.toFixed(1)} HP`);
  }
  if (autoFrames.some((ft) => Math.abs(t - ft) < PHYSICS_DT / 2)) frames.push(snapshot(sim, `t=${t.toFixed(1)}s`));
});

console.log('\n' + log.join('\n'));
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const std = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
const maxAbs = (a: number[]) => a.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
const smooth = (a: number[], w: number) => {
  const n = Math.max(1, Math.round(w / PHYSICS_DT / 2));
  return a.map((_, i) => mean(a.slice(Math.max(0, i - n), Math.min(a.length, i + n + 1))));
};
// Steady escort: escorting, at least 4 s after the healer arrived, before any cut.
const firstCut = Math.min(Infinity, ...cuts.map((c) => c.at));
const esc = samples.filter((s) => s.escorting && s.t > healerAt + 4 && s.t < firstCut && s.t < stopAt);
if (esc.length > 60 && healer) {
  const hc = healer as Creature;
  const beat = 1 / (hc.spec.fly?.flapHz ?? 1);
  const edge = Math.round(beat / 2 / PHYSICS_DT);
  const off = esc.map((s) => s.h - s.ref);
  const offS = smooth(off, beat);
  const jit = off.map((v, i) => v - offS[i]!).slice(edge, -edge);
  const xs = esc.map((s) => s.x);
  const xJit = xs.map((v, i) => v - smooth(xs, beat)[i]!).slice(edge, -edge);
  const settled = esc.filter((s) => s.t > healerAt + 10);
  console.log(`\nESCORT ${esc[0]!.t.toFixed(1)}-${esc[esc.length - 1]!.t.toFixed(1)} s:`);
  console.log(`  pitch      std ${std(esc.map((s) => s.deg)).toFixed(2)}°  max |${maxAbs(esc.map((s) => s.deg)).toFixed(1)}°|`);
  console.log(`  altitude   off the commanded path max ${maxAbs(offS.slice(edge, -edge)).toFixed(2)} m, v. jitter rms ${Math.sqrt(mean(jit.map((v) => v * v))).toFixed(3)} m (per-wingbeat bob)`);
  console.log(`  x jitter   rms ${Math.sqrt(mean(xJit.map((v) => v * v))).toFixed(3)} m   vx std ${std(esc.map((s) => s.vx)).toFixed(2)} m/s`);
  if (settled.length) {
    const dx = settled.map((s) => s.dx);
    const dh = settled.map((s) => s.dh);
    console.log(`  station    dx mean ${mean(dx).toFixed(2)} m (range ${Math.min(...dx).toFixed(2)}..${Math.max(...dx).toFixed(2)}), dh mean ${mean(dh).toFixed(2)} m (range ${Math.min(...dh).toFixed(2)}..${Math.max(...dh).toFixed(2)})  [from ${settled[0]!.t.toFixed(1)} s]`);
  }
}
for (const w of watched) {
  const got = healed.get(w.part) ?? 0;
  console.log(`  healed ${w.part.name}: ${w.from.toFixed(2)} -> ${w.part.integrity.toFixed(2)} (${got.toFixed(1)} HP of ${w.part.maxHp.toFixed(1)}), weakest joint now ${weakestJoint(w.part).toFixed(2)}`);
}
console.log(`  healed in total ${healedTotal.toFixed(1)} HP`);
if (frames.length) {
  const cx = (f: FrameSnap) => {
    const hs = healer as Creature | null;
    return hs ? samples.find((s) => s.t >= f.t)?.x ?? hs.core.x : 30;
  };
  const panned = frames.map((f) => {
    const dx = cx(f) - 12;
    return { ...f, shapes: f.shapes.map((q) => ({ ...q, x: q.x - dx })), joints: [] };
  });
  await renderFilmstrip(panned, png, { left: 0, right: 24, top: -22, bottom: 1 }, { cols: 4 });
  console.log('filmstrip', png);
}
