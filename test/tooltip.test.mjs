// Gate: the styled tooltip replaces native `title` everywhere.
//
// Native title is ~1s and OS-drawn, which is the sluggishness this replaces.
// The realistic failure mode here is not the component, it is a
// half-finished migration: one surviving `title` means that control shows the
// slow OS tooltip AND the styled one, in the same window, at different speeds.
// Assertion 2 is the one that catches that, and it is why this file exists.
import { chromium } from 'playwright';
import { EDITOR_URL, FIX } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
// Pushes, not just prints: a handler that only logs lets an uncaught exception
// exit 0, which is how a null-deref on #startBtn walked past the whole suite.
// Idiom copied from load-guards.test.mjs, the one gate that had it right.
page.on('pageerror', e => { console.log('PAGE EXCEPTION:', e.message); fails.push('page exception: ' + e.message); });
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });

const tipState = () => page.evaluate(() => {
  const el = document.getElementById('tip');
  if (!el) return { exists: false };
  const r = el.getBoundingClientRect();
  return {
    exists: true,
    shown: el.classList.contains('show'),
    text: el.textContent,
    pointerEvents: getComputedStyle(el).pointerEvents,
    rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
  };
});

// ------------------------------------------------- 1. hover shows a styled tip
await page.locator('#splitBtn').hover();
await page.waitForTimeout(600);
let t = await tipState();
const splitTip = await page.evaluate(() =>
  document.getElementById('splitBtn').dataset.tip || '(no data-tip)');
check(`hovering Split shows the tip ("${t.exists ? t.text : 'NO #tip ELEMENT'}")`,
  t.exists && t.shown && t.text.length > 0 && t.text === splitTip);

// -------------------------------- 2. THE MIGRATION ASSERTION: no native titles
const titles = await page.evaluate(() =>
  [...document.querySelectorAll('[title]')].map(e => e.getAttribute('title')));
check(`no native title attributes survive (found ${titles.length}${titles.length ? ': ' + titles.slice(0, 3).join(', ') + '…' : ''})`,
  titles.length === 0);

// And the replacement is actually in place. A floor, not an equality: adding a
// control later should not fail this, but losing a tip should. 38 = 26 in the
// markup + 12 background swatches built at runtime. The static grep said 26 and
// this assertion is what caught the other 12 — two of the sites are JS
// assignments (look-history rows, swatches), invisible to a search of the HTML.
const tipCount = await page.evaluate(() => document.querySelectorAll('[data-tip]').length);
check(`controls carry data-tip instead (${tipCount} found, floor 38)`, tipCount >= 38);

// --------------------------------------- 3. the tip is ANCHORED to its control
// Not "sits above": a tip with every positioning line deleted parks at the CSS
// default of 0,0 and satisfies "not below the button" perfectly well. Assert
// attachment instead — a small gap AND horizontal centring — so the assertion
// fails when the positioning does.
const btn = await page.locator('#splitBtn').boundingBox();
t = await tipState();
const gap = t.exists ? btn.y - t.rect.bottom : NaN;
const dx  = t.exists ? Math.abs((t.rect.left + t.rect.width / 2) - (btn.x + btn.width / 2)) : NaN;
check(`tip is anchored above the control (gap ${gap.toFixed(0)}px, centres ${dx.toFixed(0)}px apart)`,
  t.exists && t.shown && gap >= 0 && gap < 24 && dx < 2);

// ----------------------------------------------- 4. it hides when you leave
await page.mouse.move(750, 400);
await page.waitForTimeout(300);
t = await tipState();
check('tip hides on pointer-out', t.exists && !t.shown);

// ------------------------------------------------- 5. it can never eat a click
check(`pointer-events is none (${t.exists ? t.pointerEvents : '?'})`,
  t.exists && t.pointerEvents === 'none');

// -------------------------------------------- 6. grouping: the second is instant
// Scanning a row of six crop-align icons must not stutter through six delays.
await page.locator('#playBtn').hover();
await page.waitForTimeout(600);          // first one pays the delay
await page.mouse.move(750, 400);
await page.waitForTimeout(150);          // hidden, inside the grace window
await page.locator('#splitBtn').hover();
await page.waitForTimeout(150);          // far below the 350ms cold delay
t = await tipState();
check('a second tip inside the grace window shows immediately', t.exists && t.shown);

// ------------------------------- 7. the accessible name did not ride on title
const unnamed = await page.evaluate(() =>
  [...document.querySelectorAll('button[data-tip]')]
    .filter(b => !b.getAttribute('aria-label') && !b.textContent.trim())
    .map(b => b.dataset.tip));
check(`every icon-only button still has an accessible name (${unnamed.length} unnamed)`,
  unnamed.length === 0);

await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nall tooltip assertions passed');
process.exit(fails.length ? 1 : 0);
