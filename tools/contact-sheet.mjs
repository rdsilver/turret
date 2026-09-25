// Tile screenshots into one image: node tools/contact-sheet.mjs out.png cols cropX,cropY,cropW,cropH img1.png img2.png ...
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const [out, colsS, crop, ...files] = process.argv.slice(2);
const cols = Number(colsS);
const [cx, cy, cw, ch] = crop.split(',').map(Number);
const scale = 0.5;
const cells = files.map((f, i) => {
  const b64 = readFileSync(f).toString('base64');
  return `<div style="width:${cw * scale}px;height:${ch * scale}px;overflow:hidden;position:relative"><img src="data:image/png;base64,${b64}" style="position:absolute;left:${-cx * scale}px;top:${-cy * scale}px;width:${1600 * scale}px"/><span style="position:absolute;left:4px;top:2px;color:#fff;font:12px monospace">${i}</span></div>`;
});
const html = `<html><body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${cw * scale}px);gap:3px">${cells.join('')}</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cols * (cw * scale + 3), height: 400 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
