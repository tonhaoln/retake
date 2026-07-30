import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';
import fs from 'fs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const r = await page.evaluate(() => {
  pause();
  document.querySelector('#cursorStyle button[data-v="ring"]').click();
  const i0 = Math.floor(0.9 * 120), i1 = Math.floor(1.1 * 120);
  for (let i = i0; i <= i1; i++) {
    const f = (i - i0) / (i1 - i0);
    S.track.xs[i] = 200 + f * 700; S.track.ys[i] = 300;
  }
  const dt = 0.02, a = cursorAt(1.0 - dt), b = cursorAt(1.0 + dt);
  seekTo(1.0);
  return { v: Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (2 * dt)), x: Math.round(cursorAt(1.0).x) };
});
console.log('halo flick:', JSON.stringify(r));
check('halo flick exceeds blur threshold', r.v > 2000);
check('halo mid-flick near x=550', Math.abs(r.x - 550) < 40);
await page.waitForTimeout(600);
const shot = await page.screenshot({ clip: { x: 120, y: 120, width: 900, height: 380 } });
fs.writeFileSync(OUT + '/21-halo-blur-fixed.png', shot);
check('halo blur frame captured', fs.statSync(OUT + '/21-halo-blur-fixed.png').size > 5000);
await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE11');
