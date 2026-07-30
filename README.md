# Retake — your own Screen Studio

A free, two-part replacement for Screen Studio:

1. **Recorder** (`retake`) — a tiny native macOS tool that records your screen
   *without* the cursor, logs every cursor movement and click, and can record your
   webcam + microphone at the same time. Everything lands in one `.take` folder.
2. **Editor** (`retake-editor.html`) — a single HTML file that runs in Chrome.
   Drop the `.take` folder in and it auto-creates zoom-ins from your clicks, redraws
   a buttery-smooth cursor, adds the gradient framing / rounded corners / shadow,
   overlays your webcam bubble, and exports a polished MP4. No install, no server,
   no account, works offline.

The editor also accepts **any plain video** (QuickTime recordings, OBS captures…) —
you just won't get auto-zoom or the redrawn cursor, since those need the recorder's data.

---

## One-time setup (about 2 minutes)

You need Apple's command line tools (free). If you don't have them:

    xcode-select --install

Then build the recorder:

    cd Recorder
    swift build -c release
    sudo mkdir -p /usr/local/bin
    sudo cp .build/release/retake /usr/local/bin/

**Permissions** — the first time you record, macOS will ask (or silently block) until
you grant your terminal app (Terminal / iTerm / Warp) these, under
**System Settings → Privacy & Security**:

- **Screen Recording** — required, for the capture itself
- **Accessibility** — recommended, lets it see your clicks (that's what powers auto-zoom)
- **Camera / Microphone** — only if you use `--webcam` / `--mic`

After granting Screen Recording you must quit and reopen the terminal app once.

## Recording

    retake                    # main display + system audio
    retake --webcam           # + webcam bubble + mic
    retake --mic              # + mic voiceover, no webcam
    retake --window safari    # record one window (see --list for names)
    retake --area 100,80,1280,720   # record a region (points, from top-left)
    retake --display 1        # record your second display
    retake --list             # show displays and windows
    retake --keys             # ALSO record which keys you press (see below)
    retake --no-system-audio  # skip app/system sound
    retake --fps 30           # lighter files

Stop with **Ctrl+C** in the terminal — or **⌃⎋ (Control+Escape)** from any app.
You get a folder like `~/Desktop/Retake/2026-07-29 14.03.12.take` containing
the raw video (with system audio), cursor data, and webcam/mic track.

One thing about `--window`: the cursor is logged against the window's starting
position, so don't move the window mid-recording.

Privacy note: by default the recorder logs *when* keys are pressed but never
*which* keys — it is not a keylogger, and nothing ever leaves your Mac. The
`--keys` flag is the explicit opt-in that records actual keys, for the editor's
on-screen keystroke display. Don't use it while typing passwords.

## Editing

1. Open `retake-editor.html` in **Chrome** (or Edge/Arc — anything Chromium).
   Tip: keep it in your Dock — it's just a file.
2. Drag the `.take` folder into the window. (Recordings made before the
   rename — `.osrec` folders — open exactly the same, edits included.)
3. It auto-creates zooms from your clicks. Then:
   - **Timeline**: drag zoom blocks to move them, drag their edges to resize,
     double-click empty space to add one, ⌫ deletes the selected one.
   - **Selected zoom**: drag the dashed ring on the preview to aim it, use the
     Level slider for intensity.
   - **Zoom timing**: the Lead-in / Hold / Speed sliders control how early a zoom
     starts before each click, how long it lingers after, and how fast the camera
     moves. Adjusting them re-generates the auto zooms live (your manually added
     zooms are left alone).
   - **Sidebar**: background gradients or your own image; padding, corner radius,
     shadow; cursor style (arrow / dot / halo), size, smoothing and click
     ripples; hide-when-idle (cursor fades out after a configurable pause and
     returns the instant it moves — clicks count as activity); motion blur on
     camera moves; keystroke display (if recorded with `--keys`); webcam corner,
     shape and size.
   - **Audio**: separate microphone and system-audio toggles + volumes, and
     optional click sounds mixed into the export.
   - **Crop**: Frame → Crop… — drag a box (or snap to 16:9 / 4:3 / 1:1 / 9:16, or type a custom ratio like 21:9)
     to trim away the dock, menu bar, or anything else. Zooms and the cursor
     follow the crop automatically.
   - **Cut sections**: press ✂ Split (or S) at the playhead, click a piece,
     press ⌫ to remove it. Click a hatched cut to select it and ⌫ restores it.
     Audio, zooms and click sounds all stay in sync across cuts.
   - **Halo cursor**: a clearly-visible tinted disc around the cursor (white by
     default; tints + glow strength in the Cursor panel), no arrow on top.
   - **Trim**: drag the ⟨ ⟩ brackets on the timeline.
   - **Undo**: ⌘Z / ⇧⌘Z walks every timeline and crop edit back and forward.
   - Press **?** for all keyboard shortcuts.
4. The chip next to **Export** shows your settings (format · resolution · fps ·
   ≈ size) — click it to change format (MP4/GIF), quality, resolution and frame
   rate. Hit **Export**; rendering runs in the browser at roughly real-time
   speed and the file downloads when done. (GIFs render at up to 960px / 15 fps
   — right for READMEs and PRs.)

Your edits are **saved automatically** (in the browser, per recording) — close the
tab, come back tomorrow, drop the same `.take` folder in, and everything is where
you left it.

## How it works (the trick)

Screen Studio's polish comes from *not* baking the cursor into the recording.
Retake does the same: the screen is captured cursor-free, the cursor path is
recorded as data, and the editor re-renders a smoothed, resizable cursor on top —
which is also why zooming stays tack-sharp on the pointer.

## Troubleshooting

- **"Could not listen for clicks"** → grant Accessibility to your terminal, rerun.
  Recordings still work; you'd just add zooms manually.
- **Black recording / permission error** → grant Screen Recording, then fully quit
  and reopen the terminal app.
- **Webcam file won't play in the editor** → convert it once:
  `ffmpeg -i webcam.mov -c copy webcam.mp4` and re-drop the folder.
- **Export has no audio** → your browser lacks an AAC/Opus encoder (rare in Chrome
  on a Mac); update Chrome.
- **4K export refuses to start** → try 1440p; some machines cap the hardware encoder.

## Third-party

The editor bundles two MIT-licensed libraries, inlined by the build so the
shipped file stays a single self-contained HTML document:
[mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (c) Vanilagy, and
[gifenc](https://github.com/mattdesl/gifenc) (c) Matt DesLauriers.
Full notices in [NOTICE](NOTICE).

Everything here is yours — MIT ([LICENSE](LICENSE)). Enjoy not paying a subscription.
