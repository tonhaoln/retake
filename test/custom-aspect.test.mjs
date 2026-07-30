import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
await page.evaluate(() => enterCropMode());
// click Custom, set 21 : 9 via the two ratio fields
await page.click('#cropAspects button[data-v="custom"]');
await page.fill('#cropW', '21');
await page.fill('#cropH', '9');
const r1 = await page.evaluate(() => ({ aspect: S.cropAspect.toFixed(4), ratio: (S.cropDraft.w / S.cropDraft.h).toFixed(4) }));
console.log('21:9 →', JSON.stringify(r1));
check('21:9 sets aspect 2.3333', Math.abs(+r1.aspect - 21 / 9) < 0.001);
check('draft follows 21:9', Math.abs(+r1.ratio - 21 / 9) < 0.001);
// decimal form
await page.fill('#cropW', '2.35');
await page.fill('#cropH', '1');
const r2 = await page.evaluate(() => (S.cropDraft.w / S.cropDraft.h).toFixed(3));
console.log('2.35:1 → draft ratio', r2);
check('2.35:1 accepted', Math.abs(+r2 - 2.35) < 0.005);
// an emptied field changes nothing
await page.fill('#cropH', '');
const r3 = await page.evaluate(() => S.cropAspect.toFixed(3));
console.log('after emptied field, aspect still', r3);
check('empty field ignored', Math.abs(+r3 - 2.35) < 0.005);
// apply and verify export dims follow
await page.evaluate(() => exitCropMode(true));
const dims = await page.evaluate(() => exportDims());
console.log('export dims', JSON.stringify(dims), 'ratio', (dims[0] / dims[1]).toFixed(3));
check('export dims follow the ratio', Math.abs(dims[0] / dims[1] - 2.35) < 0.01);
await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE6');
