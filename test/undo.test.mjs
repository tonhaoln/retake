// Undo/redo end-to-end
import { chromium } from 'playwright';
import { EDITOR, EDITOR_URL, FIX, OUT } from './paths.mjs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));
await page.goto(EDITOR_URL);
await page.setInputFiles('#dirInput', FIX);
await page.waitForFunction(() => !document.getElementById('exportBtn').disabled, { timeout: 20000 });

const r = await page.evaluate(() => {
  const out = {};
  pause();
  out.baselineUndoEmpty = undoStack.length === 0;   // load must not be undoable
  autoZoomFromClicks();                             // zooms are opt-in — apply explicitly
  const seg0 = S.segs.length;                       // auto-zoom baseline (1)

  // 1. split + delete piece, then undo both
  seekTo(2.0); splitAtPlayhead();
  S.selPiece = 0; deleteSelection();
  out.afterCut = { cuts: S.cuts.length, splits: S.splits.length };
  undo();                                            // un-cut
  out.afterUndo1 = { cuts: S.cuts.length, splits: S.splits.length };
  undo();                                            // un-split
  out.afterUndo2 = { cuts: S.cuts.length, splits: S.splits.length };
  redo();                                            // re-split
  out.afterRedo = { splits: S.splits.length };

  // 2. delete a zoom, undo brings it back (deep copy check: mutate then undo)
  S.selSeg = 0; deleteSelection();
  out.zoomGone = S.segs.length === seg0 - 1;
  undo();
  out.zoomBack = S.segs.length === seg0;

  // 3. drag-coalescing: simulate a seg move (pointerdown pushes once)
  const before = S.segs[0].t0;
  pushUndo();                                        // what pointerdown does
  S.segs[0].t0 += 0.4; S.segs[0].t1 += 0.4;          // what pointermove does (in place)
  undo();
  out.dragUndone = Math.abs(S.segs[0].t0 - before) < 0.001;   // structuredClone = no aliasing

  // 4. crop apply + undo
  enterCropMode(); S.cropDraft = { x: 100, y: 100, w: 800, h: 450 }; exitCropMode(true);
  out.cropSet = !!S.set.crop;
  undo();
  out.cropUndone = S.set.crop === null || S.set.crop === undefined;

  // 5. keyboard path
  splitAtPlayhead();
  const n = S.splits.length;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', metaKey: true, bubbles: true }));
  out.keyboardUndo = S.splits.length === n - 1;

  // 6. cmd+S must NOT split
  const n2 = S.splits.length;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', metaKey: true, bubbles: true }));
  out.cmdSGuard = S.splits.length === n2;

  return out;
});
console.log(JSON.stringify(r, null, 1));
const ok = r.baselineUndoEmpty && r.afterUndo1.cuts === 0 && r.afterUndo1.splits === 1
  && r.afterUndo2.splits === 0 && r.afterRedo.splits === 1
  && r.zoomGone && r.zoomBack && r.dragUndone && r.cropSet && r.cropUndone
  && r.keyboardUndo && r.cmdSGuard;
console.log(ok ? 'UNDO TEST PASSED' : 'UNDO TEST FAILED');
await browser.close();
if (!ok) process.exit(1);
