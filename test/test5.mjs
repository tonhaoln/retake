import { chromium } from 'playwright';
import fs from 'fs';

const FIX = '<repo>/test/fixture.osrec';
const OUT = '<repo>/test/out';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
await page.goto('file://<repo>/Editor/dist-openstudio-editor.html');
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });

// ---- 1. spotlight: white feathered glow, no arrow
await page.evaluate(() => {
  pause(); S.set.cursorStyle = 'ring';
  document.getElementById('spotUI').style.display = '';
  seekTo(2.6);
});
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + '/12-spotlight.png' });

// ---- 2. crop mode UI
await page.evaluate(() => { S.set.cursorStyle = 'arrow'; enterCropMode(); S.cropDraft = { x: 160, y: 100, w: 800, h: 450 }; requestRender(); });
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '/13-crop-mode.png' });
// apply crop
await page.evaluate(() => exitCropMode(true));
await page.waitForTimeout(500);
const cropState = await page.evaluate(() => ({
  crop: S.set.crop,
  canvas: [preview.width, preview.height],
  cam: cameraAt(2.6),
}));
console.log('CROP:', JSON.stringify(cropState));
await page.evaluate(() => seekTo(2.6));
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + '/14-cropped.png' });

// ---- 3. split + delete a piece
const cutState = await page.evaluate(() => {
  seekTo(2.0); splitAtPlayhead();
  S.selPiece = 0;              // piece [trimIn..2.0]
  deleteSelection();           // cut it
  return { cuts: S.cuts, outDur: outDuration().toFixed(2), map0: out2src(0).toFixed(2), map1: out2src(1.0).toFixed(2) };
});
console.log('CUTS:', JSON.stringify(cutState));
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/15-timeline-cut.png' });

// ---- 4. export with crop + cut (should be ~3s of output)
const dl = page.waitForEvent('download', { timeout: 300000 });
await page.click('#exportBtn');
const download = await dl;
await download.saveAs(OUT + '/export3.mp4');
console.log('EXPORTED:', fs.statSync(OUT + '/export3.mp4').size, 'bytes');

// ---- 5. restore keeps cuts + crop
await page.reload();
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const restored = await page.evaluate(() => ({
  cuts: S.cuts.length, crop: !!S.set.crop, outDur: outDuration().toFixed(2)
}));
console.log('RESTORED:', JSON.stringify(restored));

await browser.close();
console.log('DONE5');
