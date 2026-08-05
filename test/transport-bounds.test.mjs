// Gate: Home/End land on the edges of the OUTPUT, not the source (friction
// from the 4 Aug export night: "return the scrubber to the trim start, not
// 0:00:00"). The discriminating case is a cut sitting AT trimIn — without it a
// naive seekTo(S.trimIn) passes every assertion identically, because with no
// cuts out2src(0) === S.trimIn. That case is assertion 2 and it is the only
// reason this file exists.
import { chromium } from 'playwright';
import { EDITOR_URL, FIX } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };
const near = (a, b, tol = 0.15) => Math.abs(a - b) < tol;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });

const dur = await page.evaluate(() => S.duration);
console.log(`fixture duration = ${dur.toFixed(3)}s`);

// Geometry as fractions of the real duration, so this survives a new fixture.
const A = dur * 0.20;   // trimIn
const B = dur * 0.40;   // end of the cut that starts exactly at trimIn
const C = dur * 0.85;   // trimOut
const park = dur * 0.60; // somewhere in the middle to jump away from

// ---------------------------------------------------------------- 1. plain trim
await page.evaluate(([a, c]) => { S.cuts = []; S.trimIn = a; S.trimOut = c; }, [A, C]);
await page.evaluate(p => { pause(); seekTo(p); }, park);
await page.waitForTimeout(250);
await page.keyboard.press('Home');
await page.waitForTimeout(350);
let t = await page.evaluate(() => S.video.currentTime);
check(`Home goes to trimIn when nothing is cut (${t.toFixed(2)} ≈ ${A.toFixed(2)})`, near(t, A));

await page.evaluate(p => seekTo(p), park);
await page.waitForTimeout(250);
await page.keyboard.press('End');
await page.waitForTimeout(350);
t = await page.evaluate(() => S.video.currentTime);
check(`End goes to trimOut when nothing is cut (${t.toFixed(2)} ≈ ${C.toFixed(2)})`, near(t, C));

// ------------------------------------------- 2. THE DISCRIMINATING CASE: cut at trimIn
// trimIn sits at A, but the first A→B is cut away. The first frame a viewer
// ever sees is B. A naive seekTo(S.trimIn) lands on A and is wrong.
await page.evaluate(([a, b, c]) => {
  S.cuts = [{ t0: a, t1: b }]; S.trimIn = a; S.trimOut = c;
}, [A, B, C]);
await page.evaluate(p => { pause(); seekTo(p); }, park);
await page.waitForTimeout(250);
await page.keyboard.press('Home');
await page.waitForTimeout(350);
t = await page.evaluate(() => S.video.currentTime);
check(`Home skips a cut sitting at trimIn: lands on ${t.toFixed(2)} ≈ ${B.toFixed(2)}, NOT trimIn ${A.toFixed(2)}`,
  near(t, B) && !near(t, A));

// ---------------------------------- 3. mirror: a cut running to trimOut
await page.evaluate(([a, b, c]) => {
  S.cuts = [{ t0: b, t1: c }]; S.trimIn = a; S.trimOut = c;
}, [A, dur * 0.70, C]);
await page.evaluate(p => { pause(); seekTo(p); }, dur * 0.30);
await page.waitForTimeout(250);
await page.keyboard.press('End');
await page.waitForTimeout(350);
t = await page.evaluate(() => S.video.currentTime);
check(`End stops at the last surviving frame, not trimOut (${t.toFixed(2)} ≈ ${(dur * 0.70).toFixed(2)})`,
  near(t, dur * 0.70) && !near(t, C));

// ---------------------------------------------- 4. Home is inert inside an input
await page.evaluate(([a, c]) => { S.cuts = []; S.trimIn = a; S.trimOut = c; }, [A, C]);
await page.evaluate(p => { pause(); seekTo(p); }, park);
await page.waitForTimeout(250);
await page.locator('#pad').focus();
await page.keyboard.press('Home');
await page.waitForTimeout(300);
t = await page.evaluate(() => S.video.currentTime);
check(`Home in a slider does not seek (${t.toFixed(2)} still ≈ ${park.toFixed(2)})`, near(t, park));
await page.evaluate(() => document.activeElement.blur());

// ------------------------------------------------- 5. seeking is not an edit
const before = await page.evaluate(() => undoStack.length);
await page.keyboard.press('Home');
await page.waitForTimeout(300);
await page.keyboard.press('End');
await page.waitForTimeout(300);
const after = await page.evaluate(() => undoStack.length);
check(`Home/End push no undo (${before} → ${after})`, before === after);

// ------------------- 6. Home rescues a playhead parked in the shaded dead zone
// This is the friction verbatim: the mouse can scrub into trimmed-away footage
// (deliberately — that is how you choose where the bracket goes), and Home is
// the way back. Starts OUTSIDE the window so it fails without the feature.
await page.evaluate(d => { pause(); seekTo(d * 0.05); }, dur);
await page.waitForTimeout(250);
const stranded = await page.evaluate(() => S.video.currentTime);
await page.keyboard.press('Home');
await page.waitForTimeout(350);
const rescued = await page.evaluate(() => S.video.currentTime);
check(`Home returns from the shaded zone (${stranded.toFixed(2)} → ${rescued.toFixed(2)}, trimIn ${A.toFixed(2)})`,
  stranded < A && rescued >= A - 0.15);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall transport-bounds assertions passed');
process.exit(fails.length ? 1 : 0);
