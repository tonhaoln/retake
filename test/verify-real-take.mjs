// Loads a real .take bundle in REAL Google Chrome and proves the editor can
// decode, seek across and export it.
//
// Not a gate: it needs a real recording, which can't be committed (the fixture
// is VP9/Opus precisely because Playwright's bundled Chromium has no H.264).
// This is how you check the codec path users actually hit:
//
//     node verify-real-take.mjs ~/Desktop/Retake/2026-07-31\ 09.27.49.take
//
// Worth running after any recorder change, and against a bundle from a killed
// process to confirm crash recovery still works.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BUNDLE = process.argv[2];
const EDITOR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'retake-editor.html');
const OUT = path.dirname(BUNDLE) + '/../export-' + path.basename(BUNDLE).replace(/\W+/g, '-') + '.mp4';

const fails = [];
const check = (n, ok, extra = '') => { console.log((ok ? 'ok   ' : 'FAIL ') + n + (extra ? '  ' + extra : '')); if (!ok) fails.push(n); };

const browser = await chromium.launch({ channel: 'chrome' });   // the real thing
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERROR:', m.text()); });

await page.goto('file://' + EDITOR);
await page.setInputFiles('#dirInput', BUNDLE);   // real Chrome wants the directory itself
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 30000 });

const st = await page.evaluate(() => ({
  dur: +S.duration.toFixed(2),
  w: S.video.videoWidth, h: S.video.videoHeight,
  ready: S.video.readyState,
  samples: S.cursor ? S.cursor.samples.length : 0,
  scale: +S.pointScale.toFixed(3),
}));
console.log('LOADED:', JSON.stringify(st));
check('video decoded in real Chrome', st.w > 0 && st.h > 0, `${st.w}x${st.h}`);
check('duration is real', st.dur > 1, st.dur + 's');
check('cursor data present', st.samples > 100, st.samples + ' samples');
check('meta.json was read (not the plain-video fallback)', st.samples > 0 && st.scale > 0, 'scale ' + st.scale);

// seek across the file — fragmented files fail here if the index is bad
const seeks = await page.evaluate(async () => {
  const at = [];
  for (const frac of [0.1, 0.5, 0.9, 0.35]) {
    const t = S.duration * frac;
    await new Promise(res => {
      const done = () => { S.video.removeEventListener('seeked', done); res(); };
      S.video.addEventListener('seeked', done);
      S.video.currentTime = t;
      setTimeout(done, 3000);
    });
    at.push(+S.video.currentTime.toFixed(2));
  }
  return at;
});
console.log('SEEKED TO:', JSON.stringify(seeks));
check('seeks land where asked', seeks.every((v, i) => Math.abs(v - st.dur * [0.1, 0.5, 0.9, 0.35][i]) < 0.5));

// full export: the hardest exercise of frame-accurate seeking across the file
await page.evaluate(() => { S.trimOut = Math.min(S.duration, S.trimIn + 4); });   // keep it to ~4s
const dl = page.waitForEvent('download', { timeout: 300000 });
await page.click('#exportBtn');
const download = await dl;
await download.saveAs(OUT);
const size = fs.statSync(OUT).size;
console.log('EXPORTED:', size, 'bytes →', OUT);
check('export produced a real file', size > 20000);

await browser.close();
if (fails.length) { console.log('\nFAILED:', fails.join(' | ')); process.exit(1); }
console.log('\nALL CHECKS PASSED');
