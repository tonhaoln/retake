import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
await page.evaluate(() => { pause(); document.querySelector('#cursorStyle button[data-v="ring"]').click(); seekTo(1.0); });
await page.waitForTimeout(600);
// zoom into the halo area for a close look
const shot = await page.screenshot({ clip: { x: 250, y: 180, width: 420, height: 320 } });
await import('fs').then(fs => fs.default.writeFileSync(OUT + '/18-halo-inner-shadow.png', shot));
await browser.close();
console.log('DONE8');
