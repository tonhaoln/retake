// Screenshot helper for design-critique sessions: captures the key UI states
// plus an empirical keyboard-focus probe. Not a gate.
import { chromium } from 'playwright';
import { EDITOR_URL, FIX, OUT } from './paths.mjs';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

await page.goto(EDITOR_URL);
await page.waitForTimeout(700);   // let the empty-state steps finish rising
await page.screenshot({ path: OUT + '/c1-empty.png' });

await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
await page.evaluate(() => { pause(); seekTo(2.2); });
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '/c2-main.png' });

await page.evaluate(() => { S.selSeg = 0; updateZoomPanel(); drawTimeline(); requestRender(); });
await page.waitForTimeout(250);
await page.screenshot({ path: OUT + '/c3-zoom-selected.png' });

await page.click('#exportChip');
await page.waitForTimeout(450);
await page.screenshot({ path: OUT + '/c4-popover.png' });
await page.keyboard.press('Escape');

await page.evaluate(() => toggleShortcuts());
await page.waitForTimeout(350);
await page.screenshot({ path: OUT + '/c5-shortcuts.png' });
await page.evaluate(() => toggleShortcuts());

await page.evaluate(() => enterCropMode());
await page.waitForTimeout(350);
await page.screenshot({ path: OUT + '/c6-crop.png' });
await page.evaluate(() => exitCropMode(false));

await page.evaluate(() => { seekTo(1.5); splitAtPlayhead(); });
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/c7-split-toast.png' });

// Empirical probe: with the export popover CLOSED, does Tab walk into it?
await page.evaluate(() => document.getElementById('exportChip').focus());
const trail = [];
for (let i = 0; i < 7; i++) {
  await page.keyboard.press('Tab');
  trail.push(await page.evaluate(() =>
    document.activeElement.id || document.activeElement.tagName));
}
console.log('TAB TRAIL from closed chip:', trail.join(' > '));

await browser.close();
console.log('DONE-CRITIQUE');
