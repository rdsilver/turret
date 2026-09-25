// Loads assault levels in headless Chromium, lets them run, screenshots each and
// reports console errors plus the creatures on the field.
//   node tools/assault-shots.mjs tools/out/shots 4,5,6 9000   (needs a preview server on :4173)
import { chromium } from 'playwright';
const out = process.argv[2];
const levels = (process.argv[3] ?? '4,5,6,7,8,9,10').split(',');
const wait = Number(process.argv[4] ?? 9000);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const lv of levels) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CERT|fonts/.test(m.text())) errs.push(m.text()); });
  await page.goto(`http://localhost:4173/?assault=1&level=${lv}`);
  await page.waitForTimeout(wait);
  const info = await page.evaluate(() => {
    const sc = window.__assault; if (!sc) return null;
    return { name: sc.assault?.level?.name, creatures: sc.simulation.creatures.list.map((c) => `${c.kind}:${c.state}:${c.x.toFixed(0)}`).join(' ') };
  });
  await page.screenshot({ path: `${out}/level${lv}.png` });
  console.log(`level ${lv}`, JSON.stringify(info), errs.length ? 'ERRORS ' + errs.join(' | ') : 'ok');
  await page.close();
}
await browser.close();
