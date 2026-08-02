// Gate: crop keyboard nudge + align six-pack (Friction 002, items 1+2).
// Arrows move the box in source px (Shift ×10), Alt+arrow resizes anchored
// top-left, a locked ratio survives edge clamps via back-derivation, arrows
// typed into the ratio fields never nudge, and the six align buttons land the
// box exactly without touching w/h.
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
await page.evaluate(() => enterCropMode());

const draft = () => page.evaluate(() => ({ ...S.cropDraft, r: S.cropDraft.w / S.cropDraft.h }));
const setDraft = d => page.evaluate(d => { S.cropDraft = { ...d }; requestRender(); }, d);

// ---- plain arrows: position only
await setDraft({ x: 100, y: 100, w: 600, h: 400 });
await page.keyboard.press('ArrowRight');
let d = await draft();
check('arrow moves x by 1 source px', d.x === 101 && d.y === 100);
check('arrow leaves w/h untouched', d.w === 600 && d.h === 400);
await page.keyboard.press('Shift+ArrowDown');
d = await draft();
check('Shift multiplies the step by ten', d.y === 110 && d.x === 101);

// ---- Alt resize, Free: one dimension only
await setDraft({ x: 100, y: 100, w: 600, h: 400 });
await page.keyboard.press('Alt+ArrowRight');
d = await draft();
check('Alt+Right grows width only (Free)', d.w === 601 && d.h === 400 && d.x === 100 && d.y === 100);
await page.keyboard.press('Alt+ArrowUp');
d = await draft();
check('Alt+Up shrinks height only (Free)', d.h === 399 && d.w === 601);

// ---- Alt resize with a ratio locked: the pair moves together
await page.click('#cropAspects button[data-v="1.77778"]');   // 16:9, refits the draft
await setDraft({ x: 100, y: 100, w: 640, h: 360 });
await page.evaluate(() => { S.cropAspect = 1.77778; });
await page.keyboard.press('Alt+Shift+ArrowRight');
d = await draft();
check('Alt+arrow with lock keeps the ratio (w-driven)', Math.abs(d.w - d.h * 1.77778) < 1 && d.w === 650);
await page.keyboard.press('Alt+Shift+ArrowDown');
d = await draft();
check('Alt+arrow with lock keeps the ratio (h-driven)', Math.abs(d.w - d.h * 1.77778) < 1 && Math.abs(d.h - 375.6) < 0.5);

// ---- the 284×120 catcher: growth driven into an edge still holds the ratio.
// From y=600 the height ceiling is 200, so a growing width must back-derive
// from the clamped height instead of letting the lock break silently.
await setDraft({ x: 100, y: 600, w: 320, h: 180 });
for (let i = 0; i < 12; i++) await page.keyboard.press('Alt+Shift+ArrowRight');
d = await draft();
console.log('edge-driven →', JSON.stringify(d));
check('edge clamp holds the ratio', Math.abs(d.w - d.h * 1.77778) < 1);
check('edge clamp stays inside the frame', d.y + d.h <= 800 + 0.001 && d.x + d.w <= 1280 + 0.001);

// ---- arrows while a ratio field has focus must not nudge
await page.click('#cropAspects button[data-v="custom"]');
await page.fill('#cropW', '16');
await page.fill('#cropH', '9');
const before = await draft();
await page.focus('#cropW');
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowRight');
d = await draft();
check('arrows inside the ratio field do not nudge', d.x === before.x && d.y === before.y && d.w === before.w);

// ---- customBase refreshes on nudge: retyping the ratio must not snap the
// box back to where it sat when Custom was clicked
await page.evaluate(() => document.activeElement.blur());
await page.keyboard.press('Shift+ArrowRight');
const nudged = await draft();
await page.fill('#cropW', '16');   // re-fires applyCustomRatio
d = await draft();
check('ratio refit keeps the nudged position', Math.abs(d.x - nudged.x) < 0.5);

// ---- six-pack: exact landings, w/h untouched by all six
await page.click('#cropAspects button[data-v="free"]');
await setDraft({ x: 100, y: 100, w: 600, h: 400 });
const landings = [
  ['l',  d => d.x === 0],
  ['ch', d => Math.abs(d.x - 340) < 0.5],
  ['r',  d => d.x === 680],
  ['t',  d => d.y === 0],
  ['cv', d => Math.abs(d.y - 200) < 0.5],
  ['b',  d => d.y === 400],
];
for (const [a, ok] of landings) {
  await page.click(`[data-a="${a}"]`);
  d = await draft();
  check(`align ${a} lands exactly`, ok(d));
  check(`align ${a} leaves w/h untouched`, d.w === 600 && d.h === 400);
}
check('align buttons carry no .sel state', await page.evaluate(() =>
  !document.querySelector('#cropAlignH button.sel, #cropAlignV button.sel')));

await page.evaluate(() => exitCropMode(false));
await browser.close();
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
console.log('DONE-CROPKEYS');
