import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';

const fails = [];
const check = (n, ok) => { console.log((ok ? 'ok   ' : 'FAIL ') + n); if (!ok) fails.push(n); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
// plain video, no bundle
await page.setInputFiles('#filesInput', FIX + '/screen.mp4');
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 15000 });
const st = await page.evaluate(() => ({ dur: S.duration.toFixed(1), cursor: !!S.cursor, segs: S.segs.length }));
console.log('PLAIN VIDEO:', JSON.stringify(st));
check('duration ~5s', Math.abs(+st.dur - 5) < 0.2);
check('no cursor data on plain video', st.cursor === false);
check('no zooms on plain load', st.segs === 0);
// add a manual zoom via the playhead path, then screenshot
await page.evaluate(() => { seekTo(2.5); addZoomAt(2.5); });
await page.waitForTimeout(600);
const seg = await page.evaluate(() => S.segs[0]);
console.log('MANUAL SEG:', JSON.stringify(seg));
check('manual zoom exists around 2.5', !!seg && seg.t0 < 2.5 && seg.t1 > 2.5 && seg.z === 2);
await page.screenshot({ path: OUT + '/07-plain-video-manual-zoom.png' });

// ---- absent capabilities fade + disable, never hide
const side = await page.evaluate(() => ({
  camAbsent: document.getElementById('secWebcam').classList.contains('absent'),
  camInert: document.getElementById('secWebcam').inert,
  camShown: getComputedStyle(document.getElementById('secWebcam')).display !== 'none',
  micAbsent: document.getElementById('micRow').classList.contains('absent') && document.getElementById('micRow').inert,
  micShown: getComputedStyle(document.getElementById('micRow')).display !== 'none',
  sysLive: !document.getElementById('sysRow').inert,   // the video's own audio stays usable
  keysInert: document.getElementById('keysRow').inert,
  camHint: document.getElementById('camHint').textContent,
  keysHintShown: getComputedStyle(document.getElementById('keysHint')).display !== 'none',
  camFocusable: (() => { const el = document.getElementById('camShow'); el.focus(); return document.activeElement === el; })(),
}));
console.log('SIDEBAR:', JSON.stringify(side));
check('webcam section faded + inert, not hidden', side.camAbsent && side.camInert && side.camShown);
check('mic row faded + inert, not hidden', side.micAbsent && side.micShown);
check('system audio row stays live', side.sysLive);
check('keystrokes row inert', side.keysInert);
check('hint wording is generic for a plain video', !side.camHint.includes('--webcam'));
check('no flag hint for keystrokes on a plain video', !side.keysHintShown);
check('inert controls are not focusable', !side.camFocusable);

// ---- a recorder bundle missing the same capabilities names its flags
// (meta.json + screen.mp4 only: provenance says recording, contents say bare)
await page.reload();
await page.setInputFiles('#filesInput', [FIX + '/meta.json', FIX + '/screen.mp4']);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 15000 });
const flags = await page.evaluate(() => ({
  camHint: document.getElementById('camHint').textContent,
  keysHintShown: getComputedStyle(document.getElementById('keysHint')).display !== 'none',
  audioHint: document.getElementById('audioHint').textContent,
}));
console.log('FLAGS:', JSON.stringify(flags));
check('bare bundle names --webcam', flags.camHint.includes('--webcam'));
check('bare bundle names --keys', flags.keysHintShown);
check('bare bundle names --mic', flags.audioHint.includes('--mic'));

await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE2');
