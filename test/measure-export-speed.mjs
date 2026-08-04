// One-off measurement, not a gate: how long does an MP4 export actually take
// relative to the footage's duration? Feeds the README's speed claim with a
// number instead of a guess. Run: node measure-export-speed.mjs
import { chromium } from 'playwright';
import { EDITOR_URL, FIX, OUT } from './paths.mjs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
await page.click('#autoZoom');   // zooms + motion blur = the realistic (expensive) path
const dur = await page.evaluate(() => outDuration());
const dl = page.waitForEvent('download', { timeout: 300000 });
const t0 = Date.now();
await page.click('#exportBtn');
const download = await dl;
const wall = (Date.now() - t0) / 1000;
await download.saveAs(OUT + '/speed-test.mp4');
console.log(`footage ${dur.toFixed(1)}s → export ${wall.toFixed(1)}s wall = ${(wall / dur).toFixed(2)}x real-time (1080p30, zooms + motion blur, VP9 in headless Chromium)`);
await browser.close();
