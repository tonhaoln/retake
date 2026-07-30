import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto('file://<repo>/Editor/dist-openstudio-editor.html');
await page.setInputFiles('#dirInput', '<repo>/test/fixture.osrec');
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
await page.evaluate(() => enterCropMode());
// click Custom, type 21:9, Enter
await page.click('#cropAspects button[data-v="custom"]');
await page.fill('#cropCustom', '21:9');
await page.press('#cropCustom', 'Enter');
const r1 = await page.evaluate(() => ({ aspect: S.cropAspect.toFixed(4), ratio: (S.cropDraft.w / S.cropDraft.h).toFixed(4) }));
console.log('21:9 →', JSON.stringify(r1));
// decimal form
await page.fill('#cropCustom', '2.35:1');
await page.press('#cropCustom', 'Enter');
const r2 = await page.evaluate(() => (S.cropDraft.w / S.cropDraft.h).toFixed(3));
console.log('2.35:1 → draft ratio', r2);
// invalid input marks the field, doesn't change aspect
await page.fill('#cropCustom', 'banana');
await page.press('#cropCustom', 'Enter');
const r3 = await page.evaluate(() => S.cropAspect.toFixed(3));
console.log('after invalid, aspect still', r3);
// apply and verify export dims follow
await page.evaluate(() => exitCropMode(true));
const dims = await page.evaluate(() => exportDims());
console.log('export dims', JSON.stringify(dims), 'ratio', (dims[0] / dims[1]).toFixed(3));
await browser.close();
console.log('DONE6');
