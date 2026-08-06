// Gate: the webcam bubble draws exactly when footage exists for that
// timestamp, and survives a decoder that is mid-seek.
//
// Two real defects, both found by using the editor on real recordings:
//   1. scrubbing made the bubble vanish — the draw guard keyed off
//      readyState, and a fast scrub keeps the decoder below it (measured:
//      no-frame-ready on 29 of 36 samples during a scrub). The screen video
//      never blinked because it has no such guard: drawing a mid-seek
//      element simply repaints its last frame, which is what a viewer wants.
//   2. the camera warm-up leaves the first ~0.9s of a take with no webcam
//      footage at all, and the bubble painted frame 0 across it — in
//      exports as well as preview, since both share draw().
//
// readyState is forced rather than raced for: the fixture's webcam is a
// small VP9 file whose seeks are nearly free, so a timing-based assertion
// would pass without ever reproducing the condition.
import { chromium } from 'playwright';
import { EDITOR_URL, FIX } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => { console.log('PAGE EXCEPTION:', e.message); fails.push('page exception: ' + e.message); });
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });

// Renders the same frame twice — once with the bubble suppressed — and
// reports how much the bubble region differs. Zero means nothing was
// painted there. Implementation-independent: it holds whether the pixels
// come from the video element or from a last-good-frame cache.
await page.evaluate(() => {
  window.__strength = (t, ctx, W, H) => {
    const d = S.set.camSize / 100 * Math.min(W, H);
    const pad = S.set.pad / 100 * Math.min(W, H);
    const m = Math.max(pad * 0.55, Math.min(W, H) * 0.022);
    const x = S.set.camPos.includes('l') ? m : W - m - d;
    const y = S.set.camPos.includes('t') ? m : H - m - d;
    const cx = Math.round(x + d / 2), cy = Math.round(y + d / 2);
    const patch = () => ctx.getImageData(cx - 12, cy - 12, 24, 24).data;
    const show = S.set.camShow;
    S.set.camShow = false; draw(ctx, W, H, t, { export: true }); const a = patch();
    S.set.camShow = show;  draw(ctx, W, H, t, { export: true }); const b = patch();
    let sum = 0, n = 0;
    for (let i = 0; i < a.length; i++) if (i % 4 !== 3) { sum += Math.abs(a[i] - b[i]); n++; }
    return +(sum / n).toFixed(2);
  };
  window.__preview = t => window.__strength(t, pctx, preview.width, preview.height);
  window.__midSeek = on => {
    if (on) Object.defineProperty(S.webcam, 'readyState', { configurable: true, get: () => 1 });
    else delete S.webcam.readyState;
  };
  pause(); seekTo(1.0);
});
await page.waitForTimeout(600);

// ---- 1. baseline: with footage and a ready decoder, the bubble paints
let s = await page.evaluate(() => window.__preview(1.0));
console.log('baseline strength:', s);
check(`the bubble paints normally (strength ${s})`, s > 1);

// ---- 2. THE DISCRIMINATOR: mid-seek must not blank it (old build fails)
const midSeek = await page.evaluate(() => {
  window.__preview(1.0);          // one good render first, so a cache can fill
  window.__midSeek(true);
  const v = window.__preview(1.0);
  window.__midSeek(false);
  return v;
});
console.log('mid-seek strength:', midSeek);
check(`a mid-seek decoder still shows the last good frame (strength ${midSeek})`, midSeek > 1);

// ---- 3. before the footage begins, nothing is painted at all
const gated = await page.evaluate(() => {
  const keep = S.webcamOffset;
  S.webcamOffset = 2.0;
  const before = window.__preview(0.5);      // no footage exists here
  const after = window.__preview(3.0);       // footage exists here
  S.webcamOffset = keep;
  return { before, after };
});
console.log('warm-up gating:', JSON.stringify(gated));
check(`no bubble before its footage begins (strength ${gated.before})`, gated.before === 0);
check(`and it returns once footage exists (strength ${gated.after})`, gated.after > 1);

// ---- 4. staleness cannot leak: the cache must not paint where there is
// no footage, even though it holds a perfectly good frame
const stale = await page.evaluate(() => {
  const keep = S.webcamOffset;
  window.__preview(1.0);          // fill the cache with a real frame
  S.webcamOffset = 2.0;
  window.__midSeek(true);
  const v = window.__preview(0.5);
  window.__midSeek(false);
  S.webcamOffset = keep;
  return v;
});
console.log('stale-leak strength:', stale);
check(`a cached frame never paints where footage does not exist (strength ${stale})`, stale === 0);

// ---- 5. it fades in rather than appearing at full strength
const fade = await page.evaluate(() => {
  const keep = S.webcamOffset;
  S.webcamOffset = 2.0;
  const early = window.__preview(2.05);
  const settled = window.__preview(2.6);
  S.webcamOffset = keep;
  return { early, settled };
});
console.log('fade:', JSON.stringify(fade));
check(`the bubble fades in (${fade.early} → ${fade.settled})`, fade.early < fade.settled);

// ---- 6. exports inherit it — this is what ships in a user's MP4
const exp = await page.evaluate(() => {
  const keep = S.webcamOffset;
  S.webcamOffset = 2.0;
  const c = document.createElement('canvas');
  c.width = 1920; c.height = 1200;
  const cx = c.getContext('2d', { willReadFrequently: true });
  const before = window.__strength(0.5, cx, c.width, c.height);
  const after = window.__strength(3.0, cx, c.width, c.height);
  S.webcamOffset = keep;
  return { before, after };
});
console.log('export frames:', JSON.stringify(exp));
check(`an exported frame carries no bubble before the footage (strength ${exp.before})`, exp.before === 0);
check(`and carries it after (strength ${exp.after})`, exp.after > 1);

await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE-WEBCAMFRAME');
