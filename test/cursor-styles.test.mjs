import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
await page.evaluate(() => { pause(); document.querySelector('#cursorStyle button[data-v="ring"]').click(); seekTo(1.0); });
await page.waitForTimeout(600);
const ring = await page.evaluate(() => ({
  spotShown: document.getElementById('spotUI').style.display !== 'none',
  colorsShown: document.getElementById('spotColors').style.display !== 'none',
  label: document.getElementById('spotOp').closest('label').firstChild.textContent,
  dimGone: !document.querySelector('#cursorStyle button[data-v="dim"]'),
  styleCount: document.querySelectorAll('#cursorStyle button').length
}));
console.log('RING:', JSON.stringify(ring));
check('halo shows spot panel', ring.spotShown);
check('halo shows tint swatches', ring.colorsShown);
check('halo slider label is Glow', ring.label === 'Glow');
check('Spotlight button is gone', ring.dimGone);
check('four cursor styles remain', ring.styleCount === 4);
await page.screenshot({ path: OUT + '/16-halo.png' });

// legacy saves carrying the retired 'dim' style migrate to Halo on load
await page.evaluate(() => {
  const k = 'retake:' + S.fileKey;
  const data = { v: 2, set: Object.assign({}, S.set, { cursorStyle: 'dim' }), segs: S.segs, trimIn: S.trimIn, trimOut: S.trimOut, splits: S.splits, cuts: S.cuts };
  localStorage.setItem(k, JSON.stringify(data));
});
await page.reload();
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });
const migrated = await page.evaluate(() => ({
  style: S.set.cursorStyle,
  selExists: !!document.querySelector('#cursorStyle button.sel')
}));
console.log('MIGRATED:', JSON.stringify(migrated));
check('saved dim migrates to ring', migrated.style === 'ring');
check('a style button is selected after migration', migrated.selExists);
await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE7');
