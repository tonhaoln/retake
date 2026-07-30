# CLAUDE.md — Retake

Open source Screen Studio alternative. Two parts: a native macOS recorder
(Swift CLI) and a one-file browser editor (canvas compositor + WebCodecs).
Named 2026-07-30 ("Record once. Retake forever."). The code rename is not
yet executed: files, the binary and the `.osrec` bundle extension still carry
the old working name. That rename is the next scheduled job.

## Layout

- `Recorder/` — Swift Package CLI (`openstudio-record`). ScreenCaptureKit,
  cursor logged as DATA (never baked into pixels), system audio, --window/
  --area/--keys. Builds only on macOS: `swift build -c release`, then
  `sudo cp .build/release/openstudio-record /usr/local/bin/ && hash -r`.
- `openstudio-editor.html` — the SHIPPED editor (single self-contained file).
  Built from source: `Editor/openstudio-editor.html` (markup/CSS) +
  `Editor/app.js` (logic) + inlined mp4-muxer.js/gifenc.js via
  `cd Editor && node build.js` → `Editor/dist-openstudio-editor.html`,
  then copy dist over the root file to ship.
  ⚠️ ALWAYS run build.js before testing — tests load the dist file.
  Never hand-edit the root file or the dist; edit the sources.
- `test/` — Playwright suite (test.mjs, test2–test12; shot-*.mjs are
  screenshot helpers, not gates). Setup once: `npm install` and
  `npx playwright install chromium`. Run: `npm test` from `test/`.
  Fixture: `test/fixture.osrec` (VP9/Opus because Playwright's Chromium
  lacks H.264/AAC — real Chrome uses H.264/AAC; the editor has fallbacks).
  Regenerate with `./make-fixture.sh`. Run ALL test files after any editor
  change.

## Hard rules

1. **Edits are data; the source video is sacred.** Cuts/zooms/crop are state
   mapped at render time (`out2src`/`src2out`, `cropRect()`, camera blending).
   Never mutate or re-encode source media in edit operations.
2. **Privacy default**: key *timings* only; actual keys ONLY behind `--keys`.
   Nothing ever leaves the machine. No analytics, no network calls.
3. **Single-file editor**: no external deps, fonts, or CDNs. New libs must be
   inlined via build.js.
4. **Test contract**: element ids (exportBtn, exportFmt, exportQ, exportRes,
   exportFps, sizeEst, dirInput, timeline, splitBtn, cursorStyle data-v
   buttons…) and global functions (pause, seekTo, addZoomAt, splitAtPlayhead,
   deleteSelection, undo, cameraAt, outDuration, out2src, enterCropMode…) are
   load-bearing. Keep native <input> elements native (tests drive them with
   value + dispatchEvent('input')).
5. **Popover/overlays**: hide with opacity/pointer-events, NEVER display:none
   (Playwright actionability). backdrop-filter only while `.open` (perf).
6. **Design system (Aurora-hybrid)**: gradient = interactive, everything
   static stays graphite; elevation by luminance (4 surface tokens); one
   spring (300ms), one ease (150ms); nothing animates during playback/export.
7. **Undo**: structuredClone snapshots via pushUndo() BEFORE mutations; one
   push per drag (pointerdown); baseline seeded after load (undoReady).
   Any new edit operation must call pushUndo().
8. Text nodes JS writes to (toastMsg, sizeEst, time, .lab spans, exportBtn
   label) — check before restructuring markup around them.
