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

// ==== look history (last three saved defaults, click promotes) ====
let pageErr = null;
page.on('pageerror', e => { pageErr = e.message; });

// ---- 6. history grew on the first save; labels self-derive from the blob
let hist = await page.evaluate(() => JSON.parse(localStorage.getItem('retake:lookHistory')));
check('history holds the first save', hist.length === 1 && hist[0].pad === 12 && !!hist[0].savedAt);
let rows = await page.evaluate(() => [...document.querySelectorAll('#lookHistory .look-row')].map(b => b.textContent));
check('row labels self-derive from the blob', rows.length === 1 && rows[0].startsWith('Orchid · Halo'));

// ---- 7. save adds a row; an unchanged re-save deduplicates (this is the
// assertion a naive savedAt-inclusive compare fails)
await page.click('#saveLook');
await page.click('#saveLook');
hist = await page.evaluate(() => JSON.parse(localStorage.getItem('retake:lookHistory')));
check('save adds a row; unchanged re-save deduplicates', hist.length === 2 && hist[0].pad === 5 && hist[1].pad === 12);

// ---- 8. cap at three, oldest evicted
await page.evaluate(() => { const p = $('pad'); p.value = 8; p.dispatchEvent(new Event('input')); });
await page.click('#saveLook');
await page.evaluate(() => { const p = $('pad'); p.value = 9; p.dispatchEvent(new Event('input')); });
await page.click('#saveLook');
hist = await page.evaluate(() => JSON.parse(localStorage.getItem('retake:lookHistory')));
check('cap holds at three, oldest evicted', hist.length === 3 && hist.map(h => h.pad).join() === '9,8,5');

// ---- 9. promoting the MIDDLE row: [9,8,5] → [8,9,5], no duplicate, no
// innocent eviction (the landmine the review caught in the naive design)
await page.evaluate(() => document.querySelectorAll('#lookHistory .look-row')[1].click());
const promoted = await page.evaluate(() => ({
  hist: JSON.parse(localStorage.getItem('retake:lookHistory')).map(h => h.pad),
  def: JSON.parse(localStorage.getItem('retake:defaultLook')),
  pad: S.set.pad,
}));
check('promoting the middle row reorders without duplicating', promoted.hist.join() === '8,9,5');
check('promoted blob becomes the default without savedAt', promoted.def.pad === 8 && !('savedAt' in promoted.def));
check('promoting applies to the current recording', promoted.pad === 8);

// ---- 10. incumbent rescue: a pre-history default enters history untimed
await page.evaluate(() => {
  localStorage.removeItem('retake:lookHistory');
  const p = $('pad'); p.value = 3; p.dispatchEvent(new Event('input'));
});
await page.click('#saveLook');
hist = await page.evaluate(() => JSON.parse(localStorage.getItem('retake:lookHistory')));
check('incumbent rescued into history without a timestamp', hist.length === 2 && hist[0].pad === 3 && hist[1].pad === 8 && !hist[1].savedAt);
rows = await page.evaluate(() => [...document.querySelectorAll('#lookHistory .look-row')].map(b => b.textContent));
check('rescued row renders without a time segment', rows[1].split(' · ').length === 2);

// ---- 11. deliberate-edit semantics on a fresh recording: promoting the look
// it already wears writes nothing; promoting a different one pins it
await page.evaluate(k => localStorage.removeItem(k), saveKey);
await page.reload();
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
await page.evaluate(() => document.querySelectorAll('#lookHistory .look-row')[0].click());
await page.waitForTimeout(2200);
check('promoting the look you already wear writes no autosave', await page.evaluate(k => localStorage.getItem(k) === null, saveKey));
await page.evaluate(() => document.querySelectorAll('#lookHistory .look-row')[1].click());
await page.waitForTimeout(2200);
check('promoting a different look pins the recording', await page.evaluate(k => localStorage.getItem(k) !== null, saveKey));

// ---- 12. corrupt history renders as empty and never throws; saving rebuilds
await page.evaluate(() => localStorage.setItem('retake:lookHistory', '{nope'));
await page.reload();
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const corrupt = await page.evaluate(() => ({
  rows: document.querySelectorAll('#lookHistory .look-row').length,
  hidden: document.getElementById('lookHistory').style.display === 'none',
}));
check('corrupt history renders as empty, no crash', corrupt.rows === 0 && corrupt.hidden && !pageErr);
await page.click('#saveLook');
const rebuilt = await page.evaluate(() => JSON.parse(localStorage.getItem('retake:lookHistory')));
check('next save rebuilds the corrupt key', Array.isArray(rebuilt) && rebuilt.length >= 1);

await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE-DEFAULTLOOK');
