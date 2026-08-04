// The load path is the last mutating entry point that had no guard on it.
// Two defects, both found in the pre-ship review (4 Aug):
//   1. a drop or Open mid-export swapped the video under the running encoder
//   2. a damaged meta.json/cursor.json threw inside a promise whose only
//      handler was console.error, so the drop looked like it did nothing
// Both are about the same thing: a load that should refuse, or degrade, loudly.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { EDITOR_URL, FIX, OUT } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

// scratch files: corrupt JSON, and a renamed copy of the fixture video so a
// mid-export load would produce a DIFFERENT fileKey if it were allowed through
const SCRATCH = path.join(OUT, 'load-guards');
fs.mkdirSync(SCRATCH, { recursive: true });
fs.writeFileSync(path.join(SCRATCH, 'cursor.json'), '{nope');
const BROKEN_CURSOR = path.join(SCRATCH, 'cursor.json');
const metaDir = path.join(SCRATCH, 'meta');
fs.mkdirSync(metaDir, { recursive: true });
fs.writeFileSync(path.join(metaDir, 'meta.json'), '{"screen": "screen.mp4",,,');
const BROKEN_META = path.join(metaDir, 'meta.json');
const OTHER_VIDEO = path.join(SCRATCH, 'other.mp4');
fs.copyFileSync(path.join(FIX, 'screen.mp4'), OTHER_VIDEO);
// a second distinct name: re-setting the SAME file on an input fires no change
// event, which would make the after-export check pass for the wrong reason
const AFTER_VIDEO = path.join(SCRATCH, 'after.mp4');
fs.copyFileSync(path.join(FIX, 'screen.mp4'), AFTER_VIDEO);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => { console.log('PAGE EXCEPTION:', e.message); fails.push('page exception: ' + e.message); });
const toastText = () => page.evaluate(() => document.getElementById('toastMsg').textContent);

// ---- 1. damaged cursor.json costs auto-zoom, not the recording
await page.goto(EDITOR_URL);
await page.setInputFiles('#filesInput', [FIX + '/meta.json', BROKEN_CURSOR, FIX + '/screen.mp4']);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 15000 });
const c = await page.evaluate(() => ({ dur: +S.duration.toFixed(1), cursor: S.cursor, meta: !!S.meta }));
const cMsg = await toastText();
console.log('BROKEN CURSOR:', JSON.stringify(c), '|', cMsg);
check('video still loads with a damaged cursor.json', c.dur > 4.8 && c.dur < 5.2);
check('cursor data is dropped, not half-parsed', c.cursor === null);
check('meta.json still parsed', c.meta === true);
check('the toast names cursor.json', /cursor\.json is damaged/.test(cMsg));
check('the toast still reports the load', /Loaded/.test(cMsg));

// ---- 2. damaged meta.json falls back to the plain-video path
await page.reload();
await page.setInputFiles('#filesInput', [BROKEN_META, FIX + '/cursor.json', FIX + '/screen.mp4']);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 15000 });
const m = await page.evaluate(() => ({ dur: +S.duration.toFixed(1), meta: S.meta, cursor: !!S.cursor }));
const mMsg = await toastText();
console.log('BROKEN META:', JSON.stringify(m), '|', mMsg);
check('video still loads with a damaged meta.json', m.dur > 4.8 && m.dur < 5.2);
check('meta is dropped, not half-parsed', m.meta === null);
check('cursor.json still parsed', m.cursor === true);
check('the toast names meta.json', /meta\.json is damaged/.test(mMsg));

// ---- 3. a load mid-export is refused, and the export survives it
await page.reload();
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 15000 });
const keyBefore = await page.evaluate(() => S.fileKey);
const download = page.waitForEvent('download', { timeout: 300000 });
await page.click('#exportBtn');
await page.waitForFunction(() => S.exporting === true, { timeout: 20000 });
// the encode is running and yields between frames: this is exactly the window
await page.setInputFiles('#filesInput', OTHER_VIDEO);
await page.waitForTimeout(700);
const mid = await page.evaluate(() => ({ key: S.fileKey, exporting: S.exporting, src: S.video.src }));
const midMsg = await toastText();
console.log('MID-EXPORT:', JSON.stringify({ same: mid.key === keyBefore, exporting: mid.exporting }), '|', midMsg);
check('the recording was not swapped mid-export', mid.key === keyBefore);
check('the export is still running', mid.exporting === true);
check('the refusal is visible, not silent', /Export in progress/.test(midMsg));
const file = await download;
const done = await page.evaluate(() => ({ exporting: S.exporting, key: S.fileKey }));
check('the export completed', !!(await file.path()));
check('it finished on the original recording', done.key === keyBefore && done.exporting === false);

// ---- 4. the guard lifts once the export is done
await page.setInputFiles('#filesInput', AFTER_VIDEO);
await page.waitForFunction(() => S.fileKey && S.fileKey.startsWith('after.mp4'), { timeout: 15000 })
  .then(() => check('loading works again once the export is done', true))
  .catch(() => check('loading works again once the export is done', false));

await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE2');
