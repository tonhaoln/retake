import { chromium } from 'playwright';
import fs from 'fs';

const FIX = '<repo>/test/fixture.osrec';
const OUT = '<repo>/test/out';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
await page.goto('file://<repo>/Editor/dist-openstudio-editor.html');

await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });

const state = await page.evaluate(() => ({
  segs: S.segs.length,
  mic: !!S.micFile, sys: !!S.sysFile,
  keystrokes: S.cursor.keystrokes ? S.cursor.keystrokes.length : 0,
  keysRowShown: document.getElementById('keysRow').style.display !== 'none',
  audioHint: document.getElementById('audioHint').textContent,
  tick: !!S.tickPCM,
}));
console.log('STATE:', JSON.stringify(state));

// motion blur frame: t=1.5 is mid zoom-in transition (segment starts ~1.65, TRANS ramps before)
await page.evaluate(() => { pause(); S.set.clickSnd = true; seekTo(1.45); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + '/10-motion-blur.png' });

// keystroke overlay + squeeze frame
await page.evaluate(() => seekTo(2.85));
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + '/11-keystrokes.png' });

// MP4 export with mic + system + ticks
const dl = page.waitForEvent('download', { timeout: 300000 });
await page.click('#exportBtn');
const download = await dl;
await download.saveAs(OUT + '/export2.mp4');
console.log('MP4 EXPORTED:', fs.statSync(OUT + '/export2.mp4').size, 'bytes');

// GIF export
await page.selectOption('#exportFmt', 'gif');
const dl2 = page.waitForEvent('download', { timeout: 300000 });
await page.click('#exportBtn');
const download2 = await dl2;
await download2.saveAs(OUT + '/export.gif');
console.log('GIF EXPORTED:', fs.statSync(OUT + '/export.gif').size, 'bytes');

await browser.close();
console.log('DONE4');
