// Gate: webcam preview sync corrects drift by rate, never by seeking.
// A hard seek on a real H.264 webcam file stalls its decoder long enough to
// re-arm the next correction — a self-sustaining storm (measured on a real
// take: 31 seeks in 6s of playback, each an audible pop and a visible skip).
// Seeks are expensive in this headless environment too (~250ms stall), which
// the assertions lean on rather than fight: what the mechanism guarantees is
// zero seeks for small drift, a clamped corrective rate, and — after the one
// legitimate seek a jump earns — the storm NOT re-arming. The old build
// fails from the first assertion: it seek-stormed even here, unmeasured.
import { chromium } from 'playwright';
import { EDITOR_URL, FIX } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => { console.log('PAGE EXCEPTION:', e.message); fails.push('page exception: ' + e.message); });
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });

// Instrument: count currentTime WRITES on the webcam element, keeping the
// raw prototype setter for drift injection (injections must not count).
await page.evaluate(() => {
  const el = S.webcam;
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
  window.__seekWrites = 0;
  window.__rawSet = v => desc.set.call(el, v);
  Object.defineProperty(el, 'currentTime', {
    get() { return desc.get.call(this); },
    set(v) { window.__seekWrites++; desc.set.call(this, v); }
  });
  pause(); seekTo(0.2);
});
await page.waitForTimeout(400);
await page.evaluate(() => { window.__seekWrites = 0; play(); });
await page.waitForTimeout(700);   // steady-state playback

const state = () => page.evaluate(() => ({
  writes: window.__seekWrites, rate: S.webcam.playbackRate,
  drift: +(S.webcam.currentTime - (S.video.currentTime - S.webcamOffset)).toFixed(3),
  playing: S.playing,
}));

// ---- 1. steady playback: no seeks, and near-aligned means rate 1 (deadband).
// The unfixed build fails HERE: it seek-stormed even on this fixture.
let s = await state();
console.log('steady:', JSON.stringify(s));
check(`steady playback never seeks (writes ${s.writes})`, s.writes === 0 && s.playing);
check(`near-aligned runs at 1x — deadband (rate ${s.rate}, drift ${s.drift})`,
  Math.abs(s.drift) >= 0.02 || s.rate === 1);

// ---- 2. injected drift → clamped rate correction, still zero seeks
await page.evaluate(() => {
  window.__rawSet(Math.max(0, S.video.currentTime - S.webcamOffset - 0.3));
});
await page.waitForTimeout(450);
s = await state();
console.log('after small drift:', JSON.stringify(s));
check(`small drift corrects by rate, not seeks (writes ${s.writes}, rate ${s.rate})`,
  s.writes === 0 && s.rate > 1.001);
check(`the corrective rate is clamped (rate ${s.rate})`, s.rate <= 1.1001);

// ---- 3. and the drift genuinely shrinks
const d0 = s.drift;
await page.waitForTimeout(1600);
s = await state();
console.log('convergence:', d0, '→', s.drift);
check(`drift converges (${d0} → ${s.drift})`, Math.abs(s.drift) < Math.abs(d0) - 0.05);

// ---- 4. a real jump earns exactly one seek, and the storm must NOT re-arm:
// the write count stays at one even though the seek's own stall leaves
// fresh drift behind — that residue is rate's job now, not another seek's.
await page.evaluate(() => {
  window.__seekWrites = 0;
  window.__rawSet(Math.max(0, S.video.currentTime - S.webcamOffset - 1.2));
});
await page.waitForTimeout(450);
s = await state();
console.log('after jump:', JSON.stringify(s));
check(`a jump hard-seeks exactly once (writes ${s.writes})`, s.writes === 1);
await page.waitForTimeout(500);
s = await state();
console.log('storm check:', JSON.stringify(s));
check(`the storm does not re-arm (writes still ${s.writes})`, s.writes === 1);
check(`residual stall drift is rate's job (rate ${s.rate} pulling ${s.drift < 0 ? 'forward' : 'level'})`,
  s.drift >= -0.02 ? true : s.rate > 1);

await page.evaluate(() => pause());
await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE-WEBCAMSYNC');
