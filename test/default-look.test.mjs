// Gate: the default look, and the autosave-semantics change underneath it
// (Friction 002, item 9 + the review's landmine). The invariant: every
// recording that opens without existing edits gets the latest look applied
// on arrival — which only holds if "has an autosave" means "has edits", so
// merely opening a recording must write nothing.
import { chromium } from 'playwright';
import { EDITOR_URL, FIX } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const saveKey = await page.evaluate(() => 'retake:' + S.fileKey);

// ---- 1. opening is not an edit: zero-edit sessions write nothing
// (fails against autosave-on-sight, which wrote within 1.5s of opening)
await page.waitForTimeout(2200);
check('zero-edit open writes no autosave', await page.evaluate(k => localStorage.getItem(k) === null, saveKey));

// ---- 2. first edit still triggers the save (the semantics change must not
// break saving itself). Style it while we're here, plus a crop for step 3.
await page.evaluate(() => {
  const pad = document.getElementById('pad');
  pad.value = 12; pad.dispatchEvent(new Event('input'));
  enterCropMode(); S.cropDraft = { x: 160, y: 100, w: 800, h: 450 }; exitCropMode(true);
});
await page.click('#cursorStyle button[data-v="ring"]');
await page.selectOption('#exportRes', '1440');
await page.waitForTimeout(2200);
check('first edit writes the autosave', await page.evaluate(k => localStorage.getItem(k) !== null, saveKey));

// ---- 3. capture: strict allowlist — style in, geometry out
await page.click('#saveLook');
const blob = await page.evaluate(() => JSON.parse(localStorage.getItem('retake:defaultLook')));
console.log('LOOK BLOB:', JSON.stringify(blob));
check('look carries the style', blob.pad === 12 && blob.cursorStyle === 'ring' && blob.res === '1440');
check('look carries no geometry or per-take keys',
  !('crop' in blob) && !('aspect' in blob) && !('camShow' in blob) && !('micVol' in blob) && !('keysOn' in blob));

// ---- 4. a fresh recording (no autosave) receives the look on arrival —
// and receiving it is still not an edit
await page.evaluate(k => localStorage.removeItem(k), saveKey);
await page.reload();
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const applied = await page.evaluate(() => ({
  pad: S.set.pad, style: S.set.cursorStyle, res: document.getElementById('exportRes').value,
  padDom: document.getElementById('pad').value, crop: S.set.crop,
}));
console.log('APPLIED:', JSON.stringify(applied));
check('fresh open arrives in the default look', applied.pad === 12 && applied.style === 'ring' && applied.res === '1440');
check('the look reaches the controls too', applied.padDom === '12');
check('geometry never travels', applied.crop === null);
await page.waitForTimeout(2200);
check('receiving the look writes no autosave', await page.evaluate(k => localStorage.getItem(k) === null, saveKey));

// ---- 5. a recording with its own edits keeps them: autosave beats default
await page.evaluate(() => {
  const pad = document.getElementById('pad');
  pad.value = 5; pad.dispatchEvent(new Event('input'));
});
await page.waitForTimeout(2200);
await page.reload();
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const kept = await page.evaluate(() => S.set.pad);
check('an edited recording keeps its own look', kept === 5);

await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE-DEFAULTLOOK');
