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
page.on('pageerror', e => { console.log('PAGE EXCEPTION:', e.message); fails.push('page exception: ' + e.message); });
await page.goto(EDITOR_URL);

// ------------------------- 0. the guard, before a recording exists at all
// #startBtn is visible and hit-testable from first paint and reaches the same
// function the Home key does. The key was guarded by the keydown handler and
// the button was not, so pre-load it dereferenced a null S.video. The guard
// belongs in the shared function or the two paths were never really one.
await page.locator('#startBtn').click();
await page.waitForTimeout(250);
check('skip-to-start before any recording is inert, not a crash',
  !fails.some(f => f.startsWith('page exception')));

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

// ------------------------------- 7. the button and the key are the same action
// The friction that produced this gate was discovery, not behaviour: the key
// existed and could not be found. If the button ever stops matching the key,
// the discoverable path becomes the wrong one, which is worse than no button.
await page.evaluate(([a, b, c]) => {
  S.cuts = [{ t0: a, t1: b }]; S.trimIn = a; S.trimOut = c;
}, [A, B, C]);
await page.evaluate(p => { pause(); seekTo(p); }, park);
await page.waitForTimeout(250);
await page.locator('#startBtn').click();
await page.waitForTimeout(350);
const viaButton = await page.evaluate(() => S.video.currentTime);
await page.evaluate(p => seekTo(p), park);
await page.waitForTimeout(250);
await page.keyboard.press('Home');
await page.waitForTimeout(350);
const viaKey = await page.evaluate(() => S.video.currentTime);
check(`skip-to-start button agrees with Home (${viaButton.toFixed(2)} = ${viaKey.toFixed(2)}, both skip the cut to ${B.toFixed(2)})`,
  near(viaButton, viaKey, 0.05) && near(viaButton, B));

// -------------------------------------- 8. the help sheet has a mouse route in
const openBefore = await page.evaluate(() => document.getElementById('shortcuts').classList.contains('open'));
await page.locator('#helpBtn').click();
await page.waitForTimeout(250);
const openAfter = await page.evaluate(() => document.getElementById('shortcuts').classList.contains('open'));
check(`help button opens the shortcuts sheet (${openBefore} -> ${openAfter})`, !openBefore && openAfter);
const listsHome = await page.evaluate(() =>
  document.getElementById('shortcuts').textContent.includes('Home'));
check('the sheet documents Home for anyone who wants the key', listsHome);
// Close it before anything else clicks: #shortcuts is inset:0 z-index:80, so
// while it is open it swallows every pointer event on the page.
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

// ---------------------------------- 9. the button refuses mid-export
// The export loop yields between frames (`await seekBoth`), so a seek landing
// in that gap resolves the encoder's own wait early and draws frame i from the
// wrong source time — rule 10's defect, reachable by one click on a control
// this work added. Seven mutating handlers guard on S.exporting; this one
// reached the shared function around them.
await page.evaluate(p => { pause(); seekTo(p); }, park);
await page.waitForTimeout(250);
await page.evaluate(() => { S.exporting = true; });
const beforeExp = await page.evaluate(() => S.video.currentTime);
await page.locator('#startBtn').click();
await page.waitForTimeout(350);
const afterExp = await page.evaluate(() => S.video.currentTime);
check(`the button refuses mid-export (${beforeExp.toFixed(2)} -> ${afterExp.toFixed(2)}, unmoved)`,
  near(beforeExp, afterExp, 0.05));

// Re-park first: measured against the same start, this assertion would fail
// merely because the button above already moved the playhead. Each path has
// to be tested from a clean position or the second one is just an echo.
await page.evaluate(() => { S.exporting = false; });
await page.evaluate(p => seekTo(p), park);
await page.waitForTimeout(300);
await page.evaluate(() => { S.exporting = true; });
const beforeKey = await page.evaluate(() => S.video.currentTime);
await page.keyboard.press('Home');
await page.waitForTimeout(350);
const afterKey = await page.evaluate(() => S.video.currentTime);
check(`and the key refuses too, independently (${beforeKey.toFixed(2)} -> ${afterKey.toFixed(2)})`,
  near(beforeKey, afterKey, 0.05));
await page.evaluate(() => { S.exporting = false; });

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall transport-bounds assertions passed');
process.exit(fails.length ? 1 : 0);
