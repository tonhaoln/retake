// Gate: the timeline hint strip reads the current selection (Friction 002,
// item 4b). Four states — none, zoom, piece, cut — and it must reset through
// the two deleteSelection branches that skip updateZoomPanel, because a
// status line that lies is worse than a faint one.
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

const strip = () => page.evaluate(() => ({
  state: document.getElementById('tlHelp').dataset.state || 'none',
  text: document.getElementById('tlHelp').textContent,
  kbds: document.querySelectorAll('#tlHelp kbd').length,
}));

let s = await strip();
check('boots in the none state', s.text.includes('split') && s.text.includes('shortcuts'));
check('kbd chips survive as children', s.kbds >= 2);

// zoom selected → aim guidance
await page.evaluate(() => addZoomAt(2));
s = await strip();
check('zoom selected reads delete + aim', s.state === 'seg' && s.text.includes('aim'));

// deselect → back to none
await page.evaluate(() => { S.selSeg = -1; updateZoomPanel(); });
s = await strip();
check('deselect reverts to none', s.state === 'none');

// piece selected → the destructive ⌫ is named
await page.evaluate(() => { pause(); seekTo(2.5); });
await page.waitForTimeout(200);
await page.evaluate(() => { splitAtPlayhead(); S.selPiece = 0; S.selSeg = -1; S.selCut = -1; updateZoomPanel(); });
s = await strip();
check('piece selected reads cut this section', s.state === 'piece' && s.text.includes('cut this section'));

// deleting the piece goes through the branch that skips updateZoomPanel —
// the strip must still reset
await page.evaluate(() => deleteSelection());
s = await strip();
check('strip resets after cutting a piece', s.state === 'none');

// cut selected → restore
await page.evaluate(() => { S.selCut = 0; S.selSeg = -1; S.selPiece = -1; updateZoomPanel(); });
s = await strip();
check('cut selected reads restore', s.state === 'cut' && s.text.includes('restore'));

// restoring the cut exercises the other skipped branch
await page.evaluate(() => deleteSelection());
s = await strip();
check('strip resets after restoring a cut', s.state === 'none');

await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE-HELPSTRIP');
