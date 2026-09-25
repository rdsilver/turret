// Browser smoke test: loads menu, every campaign level (fires one shot at the
// structure's weakest-looking point: its first non-foundation part), the
// workshop and the sandbox; reports console errors and saves screenshots.
//   node tools/smoke.mjs [--base http://localhost:4173] [--levels 1-10] [--out tools/out/smoke]
// A page reload mid-visit (e.g. a Vite full reload after a file edit) is reported as a problem.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const base = arg('base', 'http://localhost:4173');
const [l0, l1] = arg('levels', '1-10').split('-').map(Number);
const out = arg('out', 'tools/out/smoke');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const problems = [];
async function visit(name, url, fn) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errs.push('console: ' + m.text()); });
  await page.goto(url);
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) errs.push('navigated: page reloaded mid-visit (Vite HMR?), results invalid'); });
  await page.waitForTimeout(3500);
  const info = fn ? await fn(page).catch((e) => { errs.push('evaluate: ' + e.message); return null; }) : null;
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${name}: ${errs.length ? 'ERRORS ' + errs.length : 'ok'}${info ? ' ' + JSON.stringify(info) : ''}`);
  for (const e of errs.slice(0, 5)) console.log('   ', e);
  if (errs.length) problems.push(name);
  await page.close();
}
await visit('menu', `${base}/`);
for (let l = l0; l <= l1; l++) {
  await visit(`level${String(l).padStart(2, '0')}`, `${base}/?play=1&level=${l}`, async (page) => {
    const target = await page.evaluate(() => {
      const s = window.__turret?.simulation?.structure;
      if (!s) return null;
      const p = s.parts.find((q) => !q.isFoundation) ?? s.parts[0];
      return { x: p.x, y: p.y, parts: s.parts.length, joints: s.joints.length };
    });
    if (target) await page.evaluate(([x, y]) => window.__turret.debugFireAt(x, y, 0), [target.x, target.y]);
    await page.waitForTimeout(3000);
    const stats = await page.evaluate(() => { const sim = window.__turret?.simulation; return sim ? { phase: sim.phase, progress: +sim.progress.toFixed(2), broken: sim.structure?.jointsBroken, stepMs: +sim.physics.stats.stepMs.toFixed(2), fps: Math.round(window.game.loop.actualFps) } : null; });
    return { ...target, ...stats };
  });
}
await visit('workshop', `${base}/?play=1`, async (page) => { await page.evaluate(() => window.game.scene.getScenes(true).forEach((s) => s.scene.key === 'Game' && s.scene.start('Upgrade'))); await page.waitForTimeout(1500); return null; });
await visit('sandbox', `${base}/?sandbox=1`);
await browser.close();
console.log(problems.length ? `PROBLEMS: ${problems.join(', ')}` : 'ALL OK');
process.exitCode = problems.length ? 1 : 0;
