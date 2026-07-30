import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const r = await page.evaluate(() => {
  // fixture: cursor moves 0→4s, only jiggles ±5px (≈50 px/s, below 60 threshold) after 4s
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); };
  set('idleAfter', 0.5);
  return {
    moving: cursorAlpha(1.5),          // mid-movement → 1
    justStopped: cursorAlpha(4.3),     // idle 0.3 < 0.5 → 1
    fading: +cursorAlpha(4.75).toFixed(2),   // idle 0.75 → mid-fade
    hidden: cursorAlpha(4.99) < 0.05 ? 'yes' : cursorAlpha(4.99),
    lastMoveAt4: +S.track.last[Math.floor(4.0 * 120)].toFixed(2),
  };
});
console.log(JSON.stringify(r));
check('fully visible while moving', r.moving === 1);
check('still visible just after stopping', r.justStopped === 1);
check('mid-fade at 0.75s idle', r.fading > 0 && r.fading < 1);
check('hidden once idle passes', r.hidden === 'yes');
check('last-move clock pinned at 4s', Math.abs(r.lastMoveAt4 - 4.0) < 0.06);
await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE9');
