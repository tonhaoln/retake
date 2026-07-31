import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';
import fs from 'fs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
// zooms are opt-in now: without this the whole gate runs at z=1 and the
// crop x zoom x cut coordinate maths — the riskiest code here — goes untested
await page.click('#autoZoom');

// ---- 1. halo cursor render frame
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
check('crop applied exactly', cropState.crop && cropState.crop.x === 160 && cropState.crop.y === 100 && cropState.crop.w === 800 && cropState.crop.h === 450);
check('canvas follows crop aspect', Math.abs(cropState.canvas[0] / cropState.canvas[1] - 800 / 450) < 0.01);
check('camera is actually zoomed (else the clamp below is vacuous)', cropState.cam.z > 1.2);
check('camera clamped inside crop', cropState.cam.cx >= 160 && cropState.cam.cx <= 960 && cropState.cam.cy >= 100 && cropState.cam.cy <= 550);
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
check('one cut recorded', cutState.cuts.length === 1);
check('output duration ~3s', Math.abs(+cutState.outDur - 3.0) < 0.2);
check('out2src(0) maps past the cut', Math.abs(+cutState.map0 - 2.0) < 0.05);
check('out2src(1) maps to 3s', Math.abs(+cutState.map1 - 3.0) < 0.05);
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/15-timeline-cut.png' });

// ---- 4. export with crop + cut (should be ~3s of output)
const dl = page.waitForEvent('download', { timeout: 300000 });
await page.click('#exportBtn');
const download = await dl;
await download.saveAs(OUT + '/export3.mp4');
console.log('EXPORTED:', fs.statSync(OUT + '/export3.mp4').size, 'bytes');
check('cropped export non-trivial', fs.statSync(OUT + '/export3.mp4').size > 30000);

// ---- 5. restore keeps cuts + crop
await page.reload();
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const restored = await page.evaluate(() => ({
  cuts: S.cuts.length, crop: !!S.set.crop, outDur: outDuration().toFixed(2)
}));
console.log('RESTORED:', JSON.stringify(restored));
check('restore kept the cut', restored.cuts === 1);
check('restore kept the crop', restored.crop);
check('restore kept output duration', Math.abs(+restored.outDur - 3.0) < 0.2);

// ---- 6. a crop must NOT follow you into a different recording.
// It is geometry in source pixels: carried over it is measured against the wrong
// frame, and a crop larger than the new video renders (and exports) pure black.
// a genuinely different file: same-file reloads share a fingerprint and restore
// their own saved crop, which is correct and would mask this
await page.setInputFiles('#filesInput', FIX + '/webcam.webm');
await page.waitForTimeout(1500);
const fresh = await page.evaluate(() => ({
  crop: S.set.crop,
  aspect: S.set.aspect && S.set.aspect.v,
  canvas: [preview.width, preview.height],
  cropInfoShown: document.getElementById('cropInfo').style.display !== 'none',
  centre: (() => { const c = preview.getContext('2d'); const d = c.getImageData(preview.width >> 1, preview.height >> 1, 1, 1).data; return d[0] + d[1] + d[2]; })(),
}));
console.log('FRESH LOAD:', JSON.stringify(fresh));
check('a new recording starts uncropped', fresh.crop === null);
check('the ratio lock does not follow either', fresh.aspect === 'free');
check('the crop notice is cleared', !fresh.cropInfoShown);
check('canvas matches the new video, not the old crop', fresh.canvas[0] === 640 && fresh.canvas[1] === 480);
check('the frame is not black', fresh.centre > 0);

await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE5');
