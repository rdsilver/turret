// Plays an assault level in headless Chromium with the REAL mouse: tracks the
// nearest creature's target part, holds the trigger (releasing when the
// barrel is hot) and captures frames.
//   node tools/assault-play.mjs --base http://localhost:4173 --level 1 --aim shinL --seconds 30 --every 3 --out tools/out/aplay
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://localhost:4173');
const level = arg('level', '1');
const aim = arg('aim', 'shinL');
const seconds = Number(arg('seconds', '30'));
const every = Number(arg('every', '3'));
const out = arg('out', 'tools/out/aplay');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|fonts/.test(m.text())) errs.push(m.text()); });
await page.goto(`${base}/?assault=1&level=${level}`);
await page.waitForTimeout(3500);
const t0 = Date.now();
let shot = 0;
let held = false;
while ((Date.now() - t0) / 1000 < seconds) {
  const st = await page.evaluate((aim) => {
    const sc = window.__assault;
    if (!sc) return null;
    const sim = sc.simulation;
    const cam = sc.cameras.main;
    const canvas = sc.game.canvas.getBoundingClientRect();
    const sx = canvas.width / sc.scale.width;
    const sy = canvas.height / sc.scale.height;
    let best = null;
    for (const c of sim.creatures.list) {
      if (!c.active || c.core.removed) continue;
      if (!best || c.x < best.x) best = c;
    }
    const w = sim.weapon;
    const s = sc.assault;
    const info = { state: s.state, stopped: s.stopped, total: s.total, closest: +s.closest.toFixed(1), heat: +w.heat.toFixed(2), over: w.overheated, shots: s.shots, hits: s.hits };
    if (!best) return { ...info, target: null };
    const p = best.structure.part(aim) && !best.structure.part(aim).wrecked ? best.structure.part(aim) : best.core;
    // world px -> screen px
    const wx = p.x * 30, wy = p.y * 30;
    const scrX = (wx - cam.worldView.x) * cam.zoom;
    const scrY = (wy - cam.worldView.y) * cam.zoom;
    return { ...info, target: { x: canvas.left + scrX * sx, y: canvas.top + scrY * sy } };
  }, aim);
  if (!st) break;
  if (st.target) await page.mouse.move(st.target.x, st.target.y);
  const want = !!st.target && st.state === 'running' && !(st.heat > 0.9) && !st.over;
  if (want && !held) { await page.mouse.down(); held = true; }
  if (!want && held) { await page.mouse.up(); held = false; }
  const el = (Date.now() - t0) / 1000;
  if (el >= shot * every) {
    await page.screenshot({ path: `${out}/f${String(shot).padStart(2, '0')}.png` });
    console.log(`${el.toFixed(1)}s`, JSON.stringify(st));
    shot++;
  }
  if (st.state !== 'running' && el > 5) { await page.waitForTimeout(4000); await page.screenshot({ path: `${out}/end.png` }); console.log('END', JSON.stringify(st)); break; }
  await page.waitForTimeout(60);
}
if (held) await page.mouse.up();
await browser.close();
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 8).join('\n') : 'no errors');
