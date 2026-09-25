// End-to-end flow: menu -> PLAY (assault L1) -> win with the real mouse -> results
// -> WORKSHOP -> DEPLOY -> assault L2. Reports scenes, money, errors; saves screenshots.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const base = process.argv[2] ?? 'http://localhost:4173';
const out = 'tools/out/flow';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|fonts/.test(m.text())) errs.push(m.text()); });
const scenes = () => page.evaluate(() => window.game.scene.getScenes(true).map((s) => s.scene.key));
await page.goto(base + '/');
await page.evaluate(() => { try { localStorage.clear(); } catch {} });
await page.goto(base + '/');
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/1-menu.png` });
console.log('menu scenes', await scenes());
await page.keyboard.press('Enter');
await page.waitForTimeout(3000);
console.log('after PLAY', await scenes());
// Speed things up: let the sim run with the bot gunner using the real mouse.
let held = false;
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  const st = await page.evaluate(() => {
    const sc = window.__assault;
    if (!sc || !sc.scene.isActive()) return null;
    const sim = sc.simulation, cam = sc.cameras.main, r = sc.game.canvas.getBoundingClientRect();
    const k = r.width / sc.scale.width;
    let best = null;
    for (const c of sim.creatures.list) if (c.active && !c.core.removed && (!best || c.x < best.x)) best = c;
    const s = sc.assault, w = sim.weapon;
    const res = { state: s.state, stopped: s.stopped, total: s.total, closest: +s.closest.toFixed(1), heat: w.heat, over: w.overheated, flow: sc.flow };
    if (!best) return { ...res, t: null };
    const p = best.structure.part('shinL') && !best.structure.part('shinL').wrecked ? best.structure.part('shinL') : best.core;
    return { ...res, t: { x: r.left + (p.x * 30 - cam.worldView.x) * cam.zoom * k, y: r.top + (p.y * 30 - cam.worldView.y) * cam.zoom * k } };
  });
  if (!st) break;
  if (st.t) await page.mouse.move(st.t.x, st.t.y);
  const want = !!st.t && st.state === 'running' && st.heat < 0.9 && !st.over;
  if (want !== held) { if (want) await page.mouse.down(); else await page.mouse.up(); held = want; }
  if (st.flow === 'results') break;
  await page.waitForTimeout(50);
}
if (held) await page.mouse.up();
await page.waitForTimeout(3000);
await page.screenshot({ path: `${out}/2-results.png` });
const money1 = await page.evaluate(() => JSON.parse(localStorage.getItem('turret.save.v1') || '{}'));
console.log('results scenes', await scenes(), 'save money', money1.money, 'assaultIndex', money1.assaultIndex);
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/3-workshop.png` });
console.log('workshop scenes', await scenes());
await page.keyboard.press('Enter');
await page.waitForTimeout(3500);
await page.screenshot({ path: `${out}/4-level2.png` });
console.log('level2 scenes', await scenes(), await page.evaluate(() => window.__assault?.assault?.level?.name));
await browser.close();
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 10).join('\n') : 'no errors');
