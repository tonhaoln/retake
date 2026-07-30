import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';
import fs from 'fs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });
await page.goto(EDITOR_URL);

await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
// exports should carry zooms — apply them via the button (the contract)
await page.click('#autoZoom');

const state = await page.evaluate(() => ({
  segs: S.segs.length,
  mic: !!S.micFile, sys: !!S.sysFile,
  keystrokes: S.cursor.keystrokes ? S.cursor.keystrokes.length : 0,
  keysRowShown: document.getElementById('keysRow').style.display !== 'none',
  audioHint: document.getElementById('audioHint').textContent,
  tick: !!S.tickPCM,
}));
console.log('STATE:', JSON.stringify(state));
check('zooms applied', state.segs >= 1);
check('mic + system tracks found', state.mic && state.sys);
check('keystrokes carried (5)', state.keystrokes === 5);
check('keys row shown', state.keysRowShown);
check('click tick synthesised', state.tick);

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
check('mp4 export non-trivial', fs.statSync(OUT + '/export2.mp4').size > 50000);

// GIF export
await page.selectOption('#exportFmt', 'gif');
const dl2 = page.waitForEvent('download', { timeout: 300000 });
await page.click('#exportBtn');
const download2 = await dl2;
await download2.saveAs(OUT + '/export.gif');
console.log('GIF EXPORTED:', fs.statSync(OUT + '/export.gif').size, 'bytes');
check('gif export non-trivial', fs.statSync(OUT + '/export.gif').size > 20000);

await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE4');
