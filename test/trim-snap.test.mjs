// Gate: trim brackets snap to splits and the playhead within 8 screen px,
// snap-then-clamp, Alt bypasses (Friction 002, item 10). Driven through real
// pointer events on the timeline canvas — the same path a user's drag takes.
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

// a split at ~2.5 and the playhead parked at ~1.0
await page.evaluate(() => { pause(); seekTo(2.5); });
await page.waitForTimeout(300);
await page.evaluate(() => splitAtPlayhead());
const split = await page.evaluate(() => S.splits[0]);
await page.evaluate(() => seekTo(1.0));
await page.waitForTimeout(300);
const ph = await page.evaluate(() => S.video.currentTime);
const dur = await page.evaluate(() => S.duration);
const box = await page.locator('#timeline').boundingBox();
const tx = t => box.x + 10 + (box.width - 20) * (t / dur);   // same mapping as T2X
const ty = box.y + 45;

const drag = async (fromT, toT) => {
  await page.mouse.move(tx(fromT), ty);
  await page.mouse.down();
  await page.mouse.move(tx(toT), ty, { steps: 15 });
  await page.mouse.up();
};

// px-per-second sanity: the near-miss offsets below must sit inside 8 px
const pps = (box.width - 20) / dur;
console.log(`split=${split.toFixed(3)} playhead=${ph.toFixed(3)} px/s=${pps.toFixed(1)}`);

// ---- trimIn snaps to the split
await drag(0, split - 0.02);
let v = await page.evaluate(() => S.trimIn);
check('trimIn snaps to the split exactly', v === split);
await page.evaluate(() => { S.trimIn = 0; drawTimeline(); });

// ---- trimOut snaps to the split from the other side
await drag(dur, split + 0.02);
v = await page.evaluate(() => S.trimOut);
check('trimOut snaps to the split exactly', v === split);
await page.evaluate(() => { S.trimOut = S.duration; drawTimeline(); });

// ---- Alt bypasses the snap
await page.keyboard.down('Alt');
await drag(0, split - 0.02);
await page.keyboard.up('Alt');
v = await page.evaluate(() => S.trimIn);
console.log('alt-drag landed at', v.toFixed(4));
check('Alt bypasses the snap', v !== split && Math.abs(v - (split - 0.02)) < 0.01);
await page.evaluate(() => { S.trimIn = 0; drawTimeline(); });

// ---- the playhead is a snap target too
await drag(0, ph + 0.02);
v = await page.evaluate(() => S.trimIn);
check('trimIn snaps to the playhead exactly', v === ph);
await page.evaluate(() => { S.trimIn = 0; drawTimeline(); });

// ---- snap-then-clamp: a snap target inside the 0.5s minimum span loses
await page.evaluate(() => { S.trimOut = S.splits[0] + 0.3; drawTimeline(); });  // split now 0.3s from trimOut
await drag(0, split - 0.02);
v = await page.evaluate(() => S.trimIn);
check('the 0.5s minimum span beats the snap', Math.abs(v - (await page.evaluate(() => S.trimOut)) + 0.5) < 0.001);

await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE-TRIMSNAP');
