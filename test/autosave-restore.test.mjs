import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';
import fs from 'fs';
import path from 'path';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);

const load = async () => {
  await page.setInputFiles('#dirInput', FIX);
  await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 15000 });
};
await load();
console.log('FIRST LOAD:', await page.evaluate(() => ({ segs: S.segs.length, pad: S.set.pad, est: document.getElementById('sizeEst').textContent })));

// tweak: padding slider, zoom hold slider (regen), add a manual zoom, trim
await page.evaluate(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); };
  set('pad', 12); set('zHold', 3.0);
  addZoomAt(0.8);
  S.trimIn = 0.5;
});
await page.waitForTimeout(2200); // let autosave fire
const before = await page.evaluate(() => ({ segs: S.segs.length, hold: S.set.zoomHold, pad: S.set.pad, trimIn: S.trimIn }));
console.log('AFTER TWEAKS:', JSON.stringify(before));

// reload the page entirely and re-drop the same folder
await page.reload();
await load();
const after = await page.evaluate(() => ({
  segs: S.segs.length, hold: S.set.zoomHold, pad: S.set.pad, trimIn: S.trimIn,
  padSlider: document.getElementById('pad').value,
  holdSlider: document.getElementById('zHold').value,
  toast: document.getElementById('toast').textContent,
  est: document.getElementById('sizeEst').textContent,
  manualKept: S.segs.some(s => !s.auto)
}));
console.log('AFTER RELOAD:', JSON.stringify(after, null, 1));
const ok = after.pad === 12 && after.hold === 3 && after.segs === before.segs && after.trimIn === 0.5 && after.manualKept;
console.log(ok ? 'RESTORE TEST PASSED' : 'RESTORE TEST FAILED');
await page.screenshot({ path: OUT + '/08-restored.png' });

// legacy-prefix migration: pre-rename 'openstudio:' saves must still open
await page.evaluate(() => {
  const k = Object.keys(localStorage).find(k => k.startsWith('retake:'));
  localStorage.setItem('openstudio:' + k.slice('retake:'.length), localStorage.getItem(k));
  localStorage.removeItem(k);
});
await page.reload();
await load();
const legacy = await page.evaluate(() => ({ pad: S.set.pad, trimIn: S.trimIn, manualKept: S.segs.some(s => !s.auto) }));
const mok = legacy.pad === 12 && legacy.trimIn === 0.5 && legacy.manualKept;
console.log(mok ? 'LEGACY MIGRATION PASSED' : 'LEGACY MIGRATION FAILED: ' + JSON.stringify(legacy));
await browser.close();
if (!ok || !mok) process.exit(1);
