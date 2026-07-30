import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
// fixture cursor peaks ~230 px/s — inject a fast synthetic flick to exercise the blur
const r = await page.evaluate(() => {
  pause();
  // splice a fast move into the smoothed track around t=1.0 (120Hz samples)
  const i0 = Math.floor(0.9 * 120), i1 = Math.floor(1.1 * 120);
  for (let i = i0; i <= i1; i++) {
    const f = (i - i0) / (i1 - i0);
    S.track.xs[i] = 200 + f * 700;    // 700px in 0.2s = 3500 px/s
    S.track.ys[i] = 300;
  }
  const dt = 0.02, a = cursorAt(1.0 - dt), b = cursorAt(1.0 + dt);
  const v = Math.hypot(b.x - a.x, b.y - a.y) / (2 * dt);
  seekTo(1.0);
  return { speed: Math.round(v) };
});
console.log('flick speed px/s:', r.speed);
await page.waitForTimeout(600);
const shot = await page.screenshot({ clip: { x: 60, y: 60, width: 1120, height: 500 } });
await import('fs').then(fs => fs.default.writeFileSync(OUT + '/19-cursor-blur.png', shot));
await browser.close();
console.log('DONE10');
