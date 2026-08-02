// Gate: aim on the map, not through the telescope (Friction 002, item 6).
// The press must not teleport the aim, the drag must map pointer deltas to
// source units under a constant mapping (the old zoomed-in drag was a
// feedback loop with gain over 1), and the camera override must exist only
// between press and release.
import { chromium } from 'playwright';
import { EDITOR_URL, FIX } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });

// one zoom, selected, playhead inside it → the live camera is genuinely zoomed
await page.evaluate(() => { pause(); addZoomAt(2.0); seekTo(2.0); });
await page.waitForTimeout(400);
const camBefore = await page.evaluate(() => cameraAt(S.video.currentTime));
check('live camera is zoomed before the drag', camBefore.z > 1.2);

const box = await page.locator('#preview').boundingBox();
const px = box.x + box.width / 2, py = box.y + box.height / 2;

// ---- press alone must not move the aim (the old code teleported here)
const s0 = await page.evaluate(() => ({ x: S.segs[S.selSeg].x, y: S.segs[S.selSeg].y }));
await page.mouse.move(px, py);
await page.mouse.down();
let s = await page.evaluate(() => ({ x: S.segs[S.selSeg].x, y: S.segs[S.selSeg].y }));
check('pointerdown does not move the aim', s.x === s0.x && s.y === s0.y);

// ---- while held, the render camera is the full-frame fit
const camDuring = await page.evaluate(() => cameraAt(S.video.currentTime));
const cr = await page.evaluate(() => cropRect());
check('camera drops to the full cropped frame during the drag',
  camDuring.z === 1 && camDuring.cx === cr.x + cr.w / 2 && camDuring.cy === cr.y + cr.h / 2);

// ---- a pointer delta moves the aim by the matching source-unit delta.
// source px per css px at z=1: css → canvas px, canvas → source through the
// full-frame content rect (same maths as aimSrcPoint, computed independently)
const factor = await page.evaluate(() => {
  const rect = preview.getBoundingClientRect();
  const W = preview.width, H = preview.height;
  const c = cropRect();
  const pad = S.set.pad / 100 * Math.min(W, H);
  const scale = Math.min((W - pad * 2) / c.w, (H - pad * 2) / c.h);
  return (W / rect.width) * (c.w / (c.w * scale));
});
const DX = 60, DY = 30;
await page.mouse.move(px + DX, py + DY, { steps: 8 });
s = await page.evaluate(() => ({ x: S.segs[S.selSeg].x, y: S.segs[S.selSeg].y }));
const ex = s0.x + DX * factor, ey = s0.y + DY * factor;
console.log(`moved (${DX},${DY}) css px · factor ${factor.toFixed(3)} · aim ${s.x.toFixed(1)},${s.y.toFixed(1)} · expected ${ex.toFixed(1)},${ey.toFixed(1)}`);
check('drag maps pointer deltas to source units', Math.abs(s.x - ex) < 2 && Math.abs(s.y - ey) < 2);

// ---- release restores the live camera (a stuck override would leave z=1
// here — and would also fail crop.test.mjs, which calls cameraAt directly)
await page.mouse.up();
const camAfter = await page.evaluate(() => cameraAt(S.video.currentTime));
check('release returns the live camera', camAfter.z > 1.2);
check('the camera now aims at the dragged target', Math.abs(camAfter.cx - (await page.evaluate(() => S.segs[S.selSeg].x))) < 60);

await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE-AIMDRAG');
