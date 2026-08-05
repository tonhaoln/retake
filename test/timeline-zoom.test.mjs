// Gate: the timeline zooms, and zooming is LOOKING, not editing.
//
// Assertion 1 is the reason this file leads where it does. serializeEdits()
// persists S.set, and the autosave interval writes whenever that string
// changes. Put the view window in S.set and merely zooming marks the recording
// as edited — which then feeds rule 9's "has an autosave" predicate and pins
// the take to the factory default look — state written as a side effect of
// looking poisons every predicate built on it.
import { chromium } from 'playwright';
import { EDITOR_URL, FIX } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };
const near = (a, b, tol = 0.05) => Math.abs(a - b) < tol;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => { console.log('PAGE EXCEPTION:', e.message); fails.push('page exception: ' + e.message); });
await page.goto(EDITOR_URL);

// ------------------------------- 0. guards, before a recording exists at all
// Both new entry points. #startBtn was previously found reaching a shared
// function around the guard that protected the key; these are the same shape.
await page.locator('#tlZoom').evaluate(el => { el.value = 60; el.dispatchEvent(new Event('input')); });
await page.locator('#timeline').hover();
await page.mouse.wheel(0, -200);
await page.waitForTimeout(250);
check('zoom slider and wheel are inert before any recording loads',
  !fails.some(f => f.startsWith('page exception')));

await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const dur = await page.evaluate(() => S.duration);
const view = () => page.evaluate(() => ({ t0: S.viewT0, t1: S.viewT1, span: S.viewT1 - S.viewT0 }));

let v = await view();
check(`opens fully zoomed out (${v.t0.toFixed(2)}–${v.t1.toFixed(2)} of ${dur.toFixed(2)})`,
  near(v.t0, 0) && near(v.t1, dur));

// ------------------------------------ 1. ZOOMING WRITES NO AUTOSAVE
// The whole reason this gate exists. Clear any key first, zoom, wait past the
// interval, and assert nothing was written.
await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('retake:') && k !== 'retake:defaultLook') localStorage.removeItem(k);
});
await page.evaluate(d => setView(d * 0.2, d * 0.25), dur);
await page.waitForTimeout(2600);
const wrote = await page.evaluate(() =>
  Object.keys(localStorage).filter(k => k.startsWith('retake:') && k !== 'retake:defaultLook'));
check(`zooming writes no autosave (keys: ${JSON.stringify(wrote)})`, wrote.length === 0);

// --------------------------------------------- 2. and pushes no undo
const undoBefore = await page.evaluate(() => undoStack.length);
await page.evaluate(d => setView(d * 0.4, d * 0.3), dur);
await page.evaluate(d => setView(0, d), dur);
const undoAfter = await page.evaluate(() => undoStack.length);
check(`zooming pushes no undo (${undoBefore} → ${undoAfter})`, undoBefore === undoAfter);

// ------------------------------- 3. the ruler tightens with the visible span
// The discriminating one for the ruler. A view-aware T2X with a duration-based
// step still draws, still looks plausible, and passes everything else here —
// you would just never get a finer label no matter how far you zoomed.
const rulerLabels = () => page.evaluate(() => {
  let n = 0;
  const real = tctx.fillText.bind(tctx);
  tctx.fillText = (...a) => { if (a[2] === 10) n++; return real(...a); };   // ruler row only
  drawTimeline();
  tctx.fillText = real;
  return n;
});
// Measured as the TIME between labels, not the count. The count stays roughly
// constant at any zoom — that is what a working ruler does, it keeps labels a
// readable distance apart on screen. The count therefore cannot tell the fix
// from the bug: on this 5s fixture both give 11 at fit. The time each gap
// represents is the thing that has to shrink.
const gapAt = async (t0, span) => {
  await page.evaluate(([a, b]) => setView(a, b), [t0, span]);
  const n = await rulerLabels();
  const real = await page.evaluate(() => S.viewT1 - S.viewT0);   // setView clamps
  return n > 1 ? real / (n - 1) : real;
};
const wideGap = await gapAt(0, dur);
const tightGap = await gapAt(dur * 0.4, dur * 0.2);
check(`ruler steps down with the visible span (${wideGap.toFixed(2)}s between labels at fit → ${tightGap.toFixed(2)}s zoomed)`,
  tightGap < wideGap - 0.001);

// ------------------------- 4. clicking seeks correctly while zoomed
// Proves X2T is view-aware. Under the OLD mapping the same click lands
// somewhere else entirely, so this fails loudly rather than drifting.
await page.evaluate(d => setView(d * 0.5, d * 0.25), dur);
v = await view();
const box = await page.locator('#timeline').boundingBox();
const clickX = box.x + 10 + (box.width - 20) * 0.5;              // halfway across the view
const expect = v.t0 + v.span * 0.5;
const oldMapping = dur * 0.5;                                     // what the pre-zoom code gave
await page.mouse.click(clickX, box.y + 45);
await page.waitForTimeout(350);
const got = await page.evaluate(() => S.video.currentTime);
check(`a click maps through the visible window (${got.toFixed(2)} ≈ ${expect.toFixed(2)}, not ${oldMapping.toFixed(2)})`,
  near(got, expect, 0.1) && !near(got, oldMapping, 0.1));

// ------------------------------------------ 5. panning clamps at both ends
await page.evaluate(d => setView(-999, d * 0.25), dur);
v = await view();
check(`cannot pan before the start (t0 ${v.t0.toFixed(2)})`, near(v.t0, 0));
await page.evaluate(d => setView(999, d * 0.25), dur);
v = await view();
check(`cannot pan past the end (t1 ${v.t1.toFixed(2)} = ${dur.toFixed(2)})`, near(v.t1, dur));

// ------------------------------------------ 6. cannot zoom out past fit
await page.evaluate(d => setView(0, d * 10), dur);
v = await view();
check(`cannot zoom out beyond the whole recording (span ${v.span.toFixed(2)})`, near(v.span, dur));

// ------------------------------------------ 7. the bar shows only when zoomed
const barDrawn = () => page.evaluate(() => {
  let hit = 0;
  const real = roundRectPath;
  window.roundRectPath = (ctx, x, y, w, h, r) => { if (y === BAR_Y) hit++; return real(ctx, x, y, w, h, r); };
  drawTimeline();
  window.roundRectPath = real;
  return hit;
});
await page.evaluate(d => setView(0, d), dur);
const barAtFit = await barDrawn();
await page.evaluate(d => setView(d * 0.3, d * 0.3), dur);
const barZoomed = await barDrawn();
check(`the bar is absent at fit and present when zoomed (${barAtFit} → ${barZoomed})`,
  barAtFit === 0 && barZoomed >= 2);

// ------------------------------- 8. the view follows the playhead in playback
await page.evaluate(d => { setView(0, d * 0.2); seekTo(d * 0.05); }, dur);
await page.waitForTimeout(250);
const beforePlay = await view();
await page.evaluate(() => play());
await page.waitForTimeout(1800);
await page.evaluate(() => pause());
const t = await page.evaluate(() => S.video.currentTime);
v = await view();
check(`the window travels with the playhead (t=${t.toFixed(2)} inside ${v.t0.toFixed(2)}–${v.t1.toFixed(2)}, was ${beforePlay.t0.toFixed(2)}–${beforePlay.t1.toFixed(2)})`,
  t >= v.t0 - 0.05 && t <= v.t1 + 0.05 && v.t0 > beforePlay.t0);

// ------------------------------------------ 9. the slider drives the view
await page.evaluate(d => setView(0, d), dur);
await page.locator('#tlZoom').evaluate(el => { el.value = 100; el.dispatchEvent(new Event('input')); });
v = await view();
check(`the slider zooms in (span ${v.span.toFixed(2)} < ${dur.toFixed(2)})`, v.span < dur - 0.01);
await page.locator('#tlZoom').evaluate(el => { el.value = 0; el.dispatchEvent(new Event('input')); });
v = await view();
check(`and back out to fit (span ${v.span.toFixed(2)})`, near(v.span, dur));

// --------------------------------------- 10. both entry points refuse mid-export
await page.evaluate(d => setView(0, d), dur);
await page.evaluate(() => { S.exporting = true; });
await page.locator('#tlZoom').evaluate(el => { el.value = 80; el.dispatchEvent(new Event('input')); });
await page.locator('#timeline').hover();
await page.mouse.wheel(0, -300);
await page.waitForTimeout(300);
v = await view();
await page.evaluate(() => { S.exporting = false; });
check(`slider and wheel refuse mid-export (span still ${v.span.toFixed(2)})`, near(v.span, dur));

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall timeline-zoom assertions passed');
process.exit(fails.length ? 1 : 0);
