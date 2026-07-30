import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';
import fs from 'fs';
import path from 'path';


const browser = await chromium.launch({
  
  args: ['--enable-gpu-rasterization', '--use-fake-ui-for-media-stream']
}).catch(async e => {
  console.log('fallback launch:', e.message.split('\n')[0]);
  return chromium.launch();
});

const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

await page.goto('file://' + EDITOR);
await page.screenshot({ path: OUT + '/01-empty.png' });

// load the fixture bundle via the directory input
const files = fs.readdirSync(FIX).map(f => path.join(FIX, f));
await page.setInputFiles('#dirInput', files).catch(async e => {
  console.log('multi-file set failed, trying dir:', e.message.split('\n')[0]);
  await page.setInputFiles('#dirInput', FIX);
});

await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const state1 = await page.evaluate(() => ({
  duration: S.duration.toFixed(2),
  segs: S.segs.map(s => ({ t0: +s.t0.toFixed(2), t1: +s.t1.toFixed(2), x: Math.round(s.x), y: Math.round(s.y), z: s.z })),
  hasTrack: !!S.track,
  hasWebcam: !!S.webcam,
  videoSize: [S.video.videoWidth, S.video.videoHeight],
}));
console.log('STATE:', JSON.stringify(state1, null, 1));

// frame at t=1 (no zoom)
await page.evaluate(() => { pause(); seekTo(1.0); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + '/02-t1-nozoom.png' });

// frame at t=2.6 (inside first auto-zoom, right after clicks+typing)
await page.evaluate(() => seekTo(2.6));
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + '/03-t2.6-zoomed.png' });

// zoom factor sanity: camera at 2.6 should be > 1
const cam = await page.evaluate(() => cameraAt(2.6));
console.log('CAMERA@2.6:', JSON.stringify(cam));

// click ripple frame at t=2.05
await page.evaluate(() => seekTo(2.05));
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + '/04-t2.05-ripple.png' });

// select first segment to see aim ring; change cursor to spotlight
await page.evaluate(() => { S.selSeg = 0; updateZoomPanel(); S.set.cursorStyle = 'ring'; requestRender(); drawTimeline(); });
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '/05-aim-ring.png' });
await page.evaluate(() => { S.selSeg = -1; updateZoomPanel(); S.set.cursorStyle = 'arrow'; requestRender(); });

// EXPORT
const codecInfo = await page.evaluate(async () => {
  const v = await VideoEncoder.isConfigSupported({ codec: 'avc1.640033', width: 1728, height: 1080 });
  let a = null;
  try { a = (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 1, bitrate: 128000 })).supported; } catch (e) { a = 'err:' + e.message; }
  return { h264: v.supported, aac: a };
});
console.log('CODECS:', JSON.stringify(codecInfo));

const dl = page.waitForEvent('download', { timeout: 300000 });
await page.click('#exportBtn');
const download = await dl;
const outFile = OUT + '/export.mp4';
await download.saveAs(outFile);
console.log('EXPORTED:', fs.statSync(outFile).size, 'bytes');
await page.screenshot({ path: OUT + '/06-after-export.png' });

await browser.close();
console.log('DONE');
