// Headless Chromium screenshots of the running game (dev server or preview).
// Usage:
//   node tools/screenshot.mjs --url "http://localhost:5173/?play=1&level=3" --out tools/out/shot.png
//        [--wait 2500] [--fire "x,y[,arc]"] [--frames 6 --interval 400] [--eval "js"]
// --fire aims (sim meters, y down => use negative heights) and fires via window.__turret.debugFireAt.
// With --frames N it captures N screenshots (out-0.png ...) every --interval ms after firing.
// A page reload after the first load (e.g. a Vite full reload because someone edited a file)
// invalidates the run: it is reported and the tool exits with code 2. For long sessions on a
// shared checkout prefer `vite preview` of a build or a dev server with server.hmr=false.
import { chromium } from 'playwright';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:5173/?play=1');
const out = arg('out', 'tools/out/shot.png');
const wait = Number(arg('wait', '2500'));
const fire = arg('fire', null);
const frames = Number(arg('frames', '1'));
const interval = Number(arg('interval', '400'));
const evalJs = arg('eval', null);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
await page.goto(url);
let reloaded = false;
page.on('framenavigated', (f) => {
  if (f !== page.mainFrame()) return;
  reloaded = true;
  console.log('[navigated] the page reloaded during the run (Vite HMR full reload?):', f.url());
});
const bail = async () => {
  if (!reloaded) return;
  console.log('ABORTED: page reloaded mid-run; screenshots/state would be from a fresh page.');
  await browser.close();
  process.exit(2);
};
await page.waitForTimeout(wait);
await bail();
if (evalJs) console.log('eval =>', JSON.stringify(await page.evaluate(evalJs)));
if (fire) {
  const [x, y, arc] = fire.split(',').map(Number);
  const ok = await page.evaluate(([x, y, arc]) => window.__turret?.debugFireAt(x, y, arc || 0), [x, y, arc]);
  console.log('fired:', ok);
}
for (let i = 0; i < frames; i++) {
  if (i > 0 || fire) await page.waitForTimeout(interval);
  await bail();
  const path = frames > 1 ? out.replace(/\.png$/, `-${i}.png`) : out;
  await page.screenshot({ path });
  console.log('saved', path);
}
await browser.close();
if (errors.length) process.exitCode = 1;
