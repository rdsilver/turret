/**
 * Fly trace: measures how steadily a flyer flies (headless), with a
 * multi-exposure filmstrip and a close-up of one wingbeat.
 *
 *   npx tsx tools/fly-trace.ts [bird] [--seconds 20] [--x 55] [--from 2] [--params speed=3,height=3]
 *        [--cut wingL1 --at 6]   (wreck a part mid-flight: does it glide down and get stopped?)
 *        [--boost 1.6]           (speedBoost, as near the defense line) [--rows 0.5]  (print a table every 0.5 s)
 *        [--png tools/out/fly-bird.png]   (also writes ...-stroke.png)
 *
 * Over the steady window (from --from s until the end, or until --cut) it
 * reports the body pitch (std-dev / max / rate; + = nose down), the vertical
 * jitter (the per-wingbeat bob: height minus the commanded swoop, minus its
 * moving average over one wingbeat), the slow swoop, "puffs" (impact events
 * its own wingbeat trips in mid-air: the game draws each as dust and
 * splinters), and the horizontal speed and its variation (vx / x jitter: minus
 * their one-wingbeat moving averages). With --cut it reports the glide down.
 */
import { initRapier, run, snapshot, renderFilmstrip, type FrameSnap, type ShapeSnap } from './lib/headless';
import { Simulation } from '../src/sim/Simulation';
import { PHYSICS_DT } from '../src/config/constants';

await initRapier();
await import('../src/sim/creature');

const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--')) ?? 'bird';
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const seconds = Number(opt('seconds', '20'));
const spawnX = Number(opt('x', '55'));
const from = Number(opt('from', '2'));
const cut = opt('cut', '');
const cutAt = Number(opt('at', '6'));
const boost = Number(opt('boost', '1'));
const png = opt('png', `tools/out/fly-${id}${cut ? '-cut' : ''}.png`);
const params: Record<string, number | string> = {};
for (const kv of opt('params', '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  params[k!] = Number.isFinite(Number(v)) ? Number(v) : v!;
}

const sim = new Simulation({ seed: 5 });
const c = sim.creatures.spawn(id, spawnX, params, 11);
let cutDone = false;
let cutTime = Infinity;
const log: string[] = [];
const ev = (s: string) => log.push(`${sim.physics.simTime.toFixed(2)}s ${s}`);
sim.events.on('jointBroken', (e) => ev(`JOINT BROKEN ${e.joint.name ?? '#' + e.joint.id} (${e.cause})`));
sim.events.on('partWrecked', (e) => ev(`WRECKED ${e.part.name}`));
// Joints giving way (creaks: dust and splinters in the game) — a healthy flyer shouldn't.
const creaks = new Map<string, number>();
sim.events.on('jointStressed', (e) => creaks.set(e.joint.name ?? '#' + e.joint.id, (creaks.get(e.joint.name ?? '#' + e.joint.id) ?? 0) + 1));
// Impact events on its parts in mid-air (no ground): the game shows each as a puff of
// dust and splinters, so a flyer whose own wingbeat trips the impact detector trails debris.
const puffs = new Map<string, number>();
let puffsSteady = 0;
sim.events.on('impact', (e) => {
  if (e.hitGround || e.entity.kind === 'projectile') return;
  const n = (e.entity as { name?: string | null }).name ?? '?';
  puffs.set(n, (puffs.get(n) ?? 0) + 1);
  if (sim.physics.simTime >= from && sim.physics.simTime < Math.min(seconds, cutTime)) puffsSteady++;
});
sim.events.on('creatureNeutralized', (e) => ev(`NEUTRALIZED cause=${e.cause} at x=${e.x.toFixed(1)} h=${(-e.y).toFixed(1)}`));

interface Sample {
  t: number;
  x: number;
  h: number;
  /** Commanded altitude (spawn height + swoop), if it flies. */
  ref: number;
  vx: number;
  vy: number;
  deg: number;
  av: number;
  state: string;
}
const samples: Sample[] = [];
const DEGS = 180 / Math.PI;
// Multi-exposure frames: each covers one wingbeat, six exposures.
const frameStarts = cut ? [from, cutAt - 0.4, cutAt + 0.6, cutAt + 1.6, cutAt + 2.8, cutAt + 4.2] : [from, from + 2.5, from + 5, from + 7.5, from + 10, from + 12.5];
const win = 1 / (c.spec.fly?.flapHz ?? 1);
const dtx = win / 6;
const exposures: { t: number; snap: FrameSnap }[] = [];
let nextExp = 0;
run(sim, seconds, (t) => {
  c.speedBoost = boost;
  if (cut && !cutDone && t >= cutAt) {
    cutDone = true;
    cutTime = t;
    const p = c.structure.part(cut);
    if (!p) throw new Error(`no part "${cut}" (parts: ${c.structure.parts.map((q) => q.name).join(', ')})`);
    sim.damage.wreck(p, p.x, p.y);
  }
  if (!c.core.removed) {
    const f = c.spec.fly;
    // What the controller aimed for this step (the swoop around its cruising height, or an escort goal).
    const ref = f ? c.flyRef : c.core.height;
    samples.push({ t, x: c.core.x, h: c.core.height, ref, vx: c.core.vx, vy: -c.core.vy, deg: -c.core.angle * DEGS, av: -c.core.av * DEGS, state: c.state });
  }
  if (t >= nextExp) {
    nextExp = t + dtx - PHYSICS_DT / 2;
    if (frameStarts.some((s) => t >= s && t < s + win)) exposures.push({ t, snap: snapshot(sim) });
  }
});

// ---- metrics over the steady window -------------------------------------
const end = Math.min(seconds, cutTime);
const steady = samples.filter((s) => s.t >= from && s.t < end && s.state !== 'neutralized');
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const std = (a: number[]) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
const maxAbs = (a: number[]) => a.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
/** Centered moving average over `w` seconds. */
const smooth = (a: number[], w: number) => {
  const n = Math.max(1, Math.round(w / PHYSICS_DT / 2));
  return a.map((_, i) => mean(a.slice(Math.max(0, i - n), Math.min(a.length, i + n + 1))));
};
const rowEvery = Number(opt('rows', '0'));
if (rowEvery > 0) {
  let last = -1;
  for (const s of samples) {
    if (s.t - last < rowEvery - 1e-6) continue;
    last = s.t;
    console.log(`${s.t.toFixed(1).padStart(5)}s x=${s.x.toFixed(2).padStart(6)} h=${s.h.toFixed(2).padStart(5)} vx=${s.vx.toFixed(2).padStart(5)} vUp=${s.vy.toFixed(2).padStart(5)} pitch=${s.deg.toFixed(1).padStart(6)}° rate=${s.av.toFixed(0).padStart(4)}°/s ${s.state}`);
  }
}
console.log(log.join('\n'));
if (puffs.size) console.log(`mid-air impact puffs: ${[...puffs].map(([k, v]) => `${k} x${v}`).join(', ')}`);
if (creaks.size) console.log(`creaks: ${[...creaks].map(([k, v]) => `${k} x${v}`).join(', ')}`);
if (steady.length > 10) {
  const h = steady.map((s) => s.h);
  // One wingbeat: a moving average over it holds none of the beat.
  const beat = 1 / (c.spec.fly?.flapHz ?? 1);
  const off = steady.map((s) => s.h - s.ref);
  const offS = smooth(off, beat);
  // Trim the smoothing edges.
  const edge = Math.round(beat / 2 / PHYSICS_DT);
  const jit = off.map((v, i) => v - offS[i]!).slice(edge, -edge);
  const hs = smooth(h, beat);
  const vx = steady.map((s) => s.vx);
  const vxs = smooth(vx, beat);
  const vxJit = vx.map((v, i) => v - vxs[i]!).slice(edge, -edge);
  const xs = steady.map((s) => s.x);
  const xsS = smooth(xs, beat);
  const xJit = xs.map((v, i) => v - xsS[i]!).slice(edge, -edge);
  const deg = steady.map((s) => s.deg);
  const av = steady.map((s) => s.av);
  const x0 = steady[0]!;
  const x1 = steady[steady.length - 1]!;
  const avgV = (x0.x - x1.x) / Math.max(0.01, x1.t - x0.t);
  const hsCore = hs.slice(edge, -edge);
  console.log(`\nFLY ${id}${Object.keys(params).length ? ' ' + JSON.stringify(params) : ''}${boost !== 1 ? ` boost ${boost}` : ''} over ${from}-${end.toFixed(1)} s:`);
  console.log(`  pitch      std ${std(deg).toFixed(2)}°  max |${maxAbs(deg).toFixed(1)}°|  mean ${mean(deg).toFixed(1)}°  rate rms ${Math.sqrt(mean(av.map((v) => v * v))).toFixed(1)}°/s`);
  console.log(`  height     mean ${mean(h).toFixed(2)} m  range ${Math.min(...h).toFixed(2)}..${Math.max(...h).toFixed(2)}  slow swoop p-p ${(Math.max(...hsCore) - Math.min(...hsCore)).toFixed(2)} m  off the commanded path ${maxAbs(offS.slice(edge, -edge)).toFixed(2)} m`);
  console.log(`  v. jitter  rms ${Math.sqrt(mean(jit.map((v) => v * v))).toFixed(3)} m  max ${maxAbs(jit).toFixed(3)} m   (per-wingbeat bob)`);
  console.log(`  puffs      ${(puffsSteady / Math.max(0.1, end - from)).toFixed(2)}/s  (mid-air impact events on its own parts)`);
  console.log(`  speed      avg ${avgV.toFixed(2)} m/s  vx std ${std(vx).toFixed(2)}  vx range ${Math.min(...vx).toFixed(2)}..${Math.max(...vx).toFixed(2)}  vx jitter rms ${Math.sqrt(mean(vxJit.map((v) => v * v))).toFixed(3)}  x jitter rms ${Math.sqrt(mean(xJit.map((v) => v * v))).toFixed(3)} m`);
}
if (cut) {
  const falling = samples.filter((s) => s.t >= cutTime && s.state !== 'neutralized');
  const a = falling[0];
  const b = falling[falling.length - 1];
  if (a && b) {
    const pitches = falling.map((s) => s.deg);
    const slope = (Math.atan2(a.h - b.h, Math.abs(a.x - b.x)) * 180) / Math.PI;
    console.log(`  after cut: ${c.state} (${c.cause ?? '-'}) ${c.neutralizedAt >= 0 ? (c.neutralizedAt - cutTime).toFixed(1) + ' s after the cut' : 'still flying'}; glide ${(a.h - b.h).toFixed(1)} m down over ${Math.abs(a.x - b.x).toFixed(1)} m (${slope.toFixed(0)}° below level), touchdown vx ${b.vx.toFixed(1)} vUp ${b.vy.toFixed(1)} m/s; pitch while falling ${Math.min(...pitches).toFixed(0)}..${Math.max(...pitches).toFixed(0)}°; x now ${c.x.toFixed(1)}`);
  }
}

// ---- filmstrip: each frame overlays one window's exposures (older = fainter) ----
const frames: FrameSnap[] = [];
const trail: ShapeSnap[] = samples.filter((_, i) => i % 6 === 0).map((s) => ({ kind: 'circle', r: 0.06, x: s.x, y: -s.h, angle: 0, color: 0xff5a4e, alpha: 1, stress: 0 }));
for (const s0 of frameStarts) {
  const ex = exposures.filter((e) => e.t >= s0 && e.t < s0 + win);
  if (!ex.length) continue;
  const shapes: ShapeSnap[] = [...trail];
  ex.forEach((e, k) => {
    const a = 0.25 + (0.75 * (k + 1)) / ex.length;
    for (const sh of e.snap.shapes) shapes.push({ ...sh, alpha: sh.alpha * a });
  });
  frames.push({ t: s0, shapes, joints: [], line: null, label: `${id} ${s0.toFixed(1)}-${(s0 + win).toFixed(1)}s` });
}
// Pan each frame to the creature (one shared view, so shift the shapes instead).
const xAt = (t: number) => samples.find((q) => q.t >= t)?.x ?? spawnX;
const hAt = (t: number) => samples.find((q) => q.t >= t)?.h ?? 0;
const shift = (f: FrameSnap, dx: number, dy = 0): FrameSnap => ({ ...f, shapes: f.shapes.map((q) => ({ ...q, x: q.x - dx, y: q.y - dy })) });
const panned = frames.map((f) => shift(f, xAt(f.t + win / 2)));
await renderFilmstrip(panned, png, { left: -9, right: 9, top: -16, bottom: 1.5 }, { cols: 3 });
console.log('filmstrip', png);
// The stroke: one wingbeat, exposure by exposure, close up and centred on the body.
const s1 = frameStarts[cut ? 0 : 1]!;
const stroke = exposures
  .filter((e) => e.t >= s1 && e.t < s1 + win)
  .map((e) => shift({ ...e.snap, joints: [], line: null, label: `${id} t=${e.t.toFixed(2)}s` }, xAt(e.t), 10 - hAt(e.t)));
const strokePng = png.replace(/\.png$/, '-stroke.png');
await renderFilmstrip(stroke, strokePng, { left: -6, right: 6, top: -16, bottom: -4 }, { cols: 6 });
console.log('stroke', strokePng);
