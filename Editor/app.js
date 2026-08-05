/* Retake Editor — Screen Studio-style compositor
   Loads a .take bundle (screen.mp4 + cursor.json + meta.json [+ webcam.mov]),
   a legacy .osrec bundle, or any plain video, and renders zoom/cursor/framing/
   webcam effects. */

// ------------------------------------------------------------------ state
const $ = id => document.getElementById(id);

const S = {
  loaded: false,
  video: null,          // screen <video>
  webcam: null,         // webcam <video> or null
  webcamOffset: 0,      // webcam start time relative to video start (s)
  micFile: null,        // File carrying the microphone track (webcam.mov / audio.mov)
  micEl: null,          // media element used to hear the mic in preview
  sysFile: null,        // File carrying system audio (screen.mp4 when recorded, or a plain video)
  bgImg: null,          // custom background Image (not persisted)
  tickPCM: null,        // synthesized click sound (Float32Array @48k)
  meta: null,
  cursor: null,         // {samples:[[t,x,y]..], clicks:[{t,x,y,button,down}], keys:[t..]}
  pointScale: 1,        // video px per cursor point
  duration: 0,
  // smoothed cursor track (uniform rate)
  track: null, trackRate: 120,
  // zoom segments {t0,t1,x,y,z} in video seconds / video px
  segs: [],
  selSeg: -1,
  // video-track edits (all in source time)
  splits: [],           // user split points
  cuts: [],             // removed ranges [{t0,t1}]
  selPiece: -1, selCut: -1,
  cropMode: false, cropDraft: null, cropAspect: null,
  trimIn: 0, trimOut: 0,
  playing: false,
  exporting: false,
  fileKey: null,        // identifies this recording for autosave
  set: {                // user settings
    bg: 2, pad: 7, radius: 14, shadow: 55,
    cursorStyle: 'arrow', curSize: 1.4, curSmooth: 60, ripples: true,
    camShow: true, camPos: 'br', camShape: 'circle', camSize: 19,
    micOn: true, micVol: 100, sysOn: true, sysVol: 100,
    clickSnd: false, mblur: true, keysOn: true, quality: 'std',
    zoomLead: 0.35, zoomHold: 1.9, zoomTrans: 0.75,
    spotColor: '#ffffff', spotOpacity: 35,
    hideIdle: true, idleAfter: 2,  // hide the cursor when it hasn't moved for N s
    crop: null,                    // {x,y,w,h} in video px, or null = full frame
    aspect: { v: 'free' },         // the crop ratio choice, so reopening crop keeps its lock
  }
};

// ------------------------------------------------------------------ utils
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
const fmtT = t => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};
function toast(msg, ms = 3200, kind = '') {
  const el = $('toast');
  $('toastMsg').textContent = msg;
  el.classList.remove('ok', 'warn');
  if (kind) el.classList.add(kind);
  el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), ms);
}
// ---------------------------------------------------------------- tooltips
// One element, delegated hover, controls opt in with data-tip. Native title
// was ~1s and OS-drawn; 350ms is under the threshold where a hover feels
// ignored. Grouping matters as much as the delay: once a tip has been up
// recently, the next shows instantly, so scanning six crop-align icons in a
// row doesn't stutter through six separate waits.
const TIP_DELAY = 350, TIP_GRACE = 2000;
let tipTimer = null, tipLastHidden = -Infinity, tipEl = null;
function showTip(el) {
  const txt = el.dataset.tip;
  if (!txt) return;
  tipEl = tipEl || $('tip');
  tipEl.textContent = txt;
  tipEl.classList.add('show');
  // measure only after the text is in, or the width is last tip's
  const r = el.getBoundingClientRect(), t = tipEl.getBoundingClientRect();
  tipEl.style.left = clamp(r.left + r.width / 2 - t.width / 2, 8, innerWidth - t.width - 8) + 'px';
  tipEl.style.top  = Math.max(8, r.top - t.height - 8) + 'px';
}
function hideTip() {
  clearTimeout(tipTimer);
  tipEl = tipEl || $('tip');
  if (tipEl.classList.contains('show')) tipLastHidden = performance.now();
  tipEl.classList.remove('show');
}
document.addEventListener('pointerover', e => {
  const el = e.target.closest?.('[data-tip]');
  if (!el) return;
  clearTimeout(tipTimer);
  const warm = performance.now() - tipLastHidden < TIP_GRACE;
  tipTimer = setTimeout(() => showTip(el), warm ? 0 : TIP_DELAY);
});
document.addEventListener('pointerout', e => { if (e.target.closest?.('[data-tip]')) hideTip(); });
// A tip left hanging over a control you just clicked reads as a stuck overlay.
document.addEventListener('pointerdown', hideTip);
window.addEventListener('scroll', hideTip, true);

// aurora fill for range inputs — called on every value change
function setFill(el) {
  const min = parseFloat(el.min || 0), max = parseFloat(el.max || 100);
  const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
  el.style.setProperty('--track',
    `linear-gradient(90deg,#4fd1c5,#8b7cff ${pct}%,#222633 ${pct}%)`);
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------------ backgrounds
const BGS = [
  { n: 'Midnight', s: ['#0f1023', '#2b1e55', '#0d2440'] },
  { n: 'Aurora',   s: ['#0b2b26', '#134e4a', '#1e3a5f'] },
  { n: 'Orchid',   s: ['#3b1f5e', '#7b2d8b', '#c73e6b'] },
  { n: 'Sunset',   s: ['#ff9966', '#ff5e62', '#8f3a84'] },
  { n: 'Ocean',    s: ['#2193b0', '#3b5bdb', '#20265c'] },
  { n: 'Peach',    s: ['#ffecd2', '#fcb69f', '#f88f8f'] },
  { n: 'Slate',    s: ['#1c1f26', '#2a2f3a', '#171a21'] },
  { n: 'Snow',     s: ['#e8ecf4', '#cfd8ea', '#aebadd'] },
  { n: 'Lime',     s: ['#a8e063', '#56ab2f', '#1e5631'] },
  { n: 'Candy',    s: ['#a18cd1', '#fbc2eb', '#f6d365'] },
  { n: 'Graphite', s: ['#000000', '#15171c', '#000000'] },
  { n: 'Blurple',  s: ['#4e54c8', '#8f94fb', '#4e54c8'] },
];
function bgGradient(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  const stops = (BGS[S.set.bg] || BGS[0]).s;
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

// ------------------------------------------------------------------ loading
async function loadFromFiles(fileList) {
  // The export loop yields between frames (a seek and a setTimeout each), so a
  // drop or an Open mid-export lands inside a running encode and swaps the
  // video, duration and cuts under it — what downloads is then a splice of two
  // recordings. Every other mutating handler guards on S.exporting; this is the
  // load path's copy of that guard, and it covers drop and both file inputs.
  if (S.exporting) {
    toast('Export in progress — let it finish or cancel it before opening another recording.', 4200, 'warn');
    return;
  }
  const files = {};
  for (const f of fileList) files[f.name.toLowerCase()] = f;

  // A damaged data file costs its own feature, never the whole take: the editor
  // already runs meta-less and cursor-less (that is the plain-video path), so a
  // half-copied bundle opens as a video with less polish. Unguarded, these two
  // parses threw inside a promise whose only handler was console.error, and the
  // drop looked like it had done nothing at all.
  let meta = null, cursor = null;
  const damaged = [];
  if (files['meta.json'])   { try { meta   = JSON.parse(await files['meta.json'].text()); }   catch (e) { damaged.push('meta.json'); } }
  if (files['cursor.json']) { try { cursor = JSON.parse(await files['cursor.json'].text()); } catch (e) { damaged.push('cursor.json'); } }

  // pick the screen video
  let screenFile = null;
  if (meta && files[(meta.screen || '').toLowerCase()]) screenFile = files[meta.screen.toLowerCase()];
  if (!screenFile) {
    const vids = Object.values(files).filter(f => /\.(mp4|mov|webm|m4v)$/i.test(f.name));
    // skip the webcam only when there is something else to pick: a lone file
    // called webcam.mov is just a video someone dropped in
    const notCam = vids.filter(f => !/webcam/i.test(f.name));
    screenFile = (notCam.length ? notCam : vids).sort((a, b) => b.size - a.size)[0] || null;
  }
  if (!screenFile) { toast('No video found — drop a .take folder or a video file.'); return; }

  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.preload = 'auto';
  video.src = URL.createObjectURL(screenFile);
  await new Promise((res, rej) => {
    video.onloadedmetadata = res;
    video.onerror = () => rej(new Error('Could not decode ' + screenFile.name));
  }).catch(e => { URL.revokeObjectURL(video.src); toast(e.message); throw e; });

  // webcam / audio side-files
  let webcam = null, webcamOffset = 0, micFile = null, micEl = null, sysFile = null;
  const camName = meta && meta.webcam ? meta.webcam.toLowerCase() : 'webcam.mov';
  const audName = meta && meta.audio ? meta.audio.toLowerCase() : 'audio.mov';
  if (files[camName]) {
    webcam = document.createElement('video');
    webcam.muted = true; webcam.playsInline = true; webcam.preload = 'auto';
    webcam.src = URL.createObjectURL(files[camName]);
    const ok = await new Promise(res => { webcam.onloadedmetadata = () => res(true); webcam.onerror = () => res(false); });
    if (!ok) { URL.revokeObjectURL(webcam.src); toast('Webcam file could not be decoded — continuing without it.'); webcam = null; }
    else { webcamOffset = (meta && meta.webcamOffset) || 0; micFile = files[camName]; micEl = webcam; }
  }
  if (!micFile && files[audName]) {
    micFile = files[audName];
    webcamOffset = (meta && meta.webcamOffset) || 0;
    micEl = new Audio(URL.createObjectURL(micFile));   // hear the mic in preview
    micEl.preload = 'auto';
  }
  // system audio lives inside screen.mp4 (recorded bundles) or the video's own track (plain videos)
  if ((meta && meta.systemAudio) || !meta) sysFile = screenFile;

  // commit state (revoke every previous object URL — each pins a file in memory)
  if (S.video) URL.revokeObjectURL(S.video.src);
  if (S.webcam) URL.revokeObjectURL(S.webcam.src);
  if (S.micEl && S.micEl !== S.webcam) URL.revokeObjectURL(S.micEl.src);
  S.video = video; S.webcam = webcam; S.webcamOffset = webcamOffset;
  S.micFile = micFile; S.micEl = micEl; S.sysFile = sysFile;
  S.meta = meta; S.cursor = cursor;
  S.duration = video.duration;
  S.trimIn = 0; S.trimOut = video.duration;
  S.pointScale = meta && meta.pointWidth ? video.videoWidth / meta.pointWidth : 1;
  S.segs = []; S.selSeg = -1; S.loaded = true;
  S.splits = []; S.cuts = []; S.selPiece = -1; S.selCut = -1;
  S.cropMode = false;
  // Geometry belongs to the recording it was drawn on, never to the app: a crop
  // carried into a different video is measured in the WRONG source pixels, and
  // one that lands outside the frame renders — and exports — pure black.
  // Cleared before the restore below, which re-applies this recording's own crop.
  S.set.crop = null; S.set.aspect = { v: 'free' };
  S.fileKey = `${screenFile.name}|${screenFile.size}|${Math.round(video.duration * 10)}`;

  // restore previous edits for this recording, if any
  let restored = false;
  try {
    let raw = localStorage.getItem('retake:' + S.fileKey);
    if (!raw) raw = localStorage.getItem('openstudio:' + S.fileKey);   // pre-rename edits still open
    if (raw) {
      const p = JSON.parse(raw);
      Object.assign(S.set, p.set || {});
      if (S.set.bg === -1) S.set.bg = 0;   // background images aren't persisted
      if (S.set.cursorStyle === 'dim') S.set.cursorStyle = 'ring';   // Spotlight retired; Halo is its heir
      S.segs = (p.segs || []).map(s => ({
        ...s,
        t0: clamp(s.t0, 0, S.duration), t1: clamp(s.t1, 0, S.duration)
      })).filter(s => s.t1 - s.t0 > 0.2);
      S.trimIn = clamp(p.trimIn ?? 0, 0, S.duration);
      S.trimOut = clamp(p.trimOut ?? S.duration, S.trimIn + 0.5, S.duration);
      S.splits = (p.splits || []).map(t => clamp(t, 0, S.duration));
      S.cuts = (p.cuts || []).map(c => ({ t0: clamp(c.t0, 0, S.duration), t1: clamp(c.t1, 0, S.duration) }));
      lastSaved = raw;
      restored = true;
    }
  } catch (e) {}

  buildTrack();
  if (restored) syncUIFromSettings();
  else {
    // Every recording that opens without existing edits gets the latest look
    // applied on arrival; recordings with an autosave keep their own.
    applyDefaultLook();
    // syncUIFromSettings owns these two lines when restoring; nothing else does
    $('cropInfo').style.display = 'none';
    $('cropAspects').querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.v === 'free'));
    // Seed lastSaved with the exact serialisation the interval produces, so
    // "has an autosave" means "has edits": merely opening a recording — or
    // receiving the default look — writes nothing. Without this, the editor
    // autosaved within 1.5s of opening, and previewing five takes to pick one
    // would have locked the other four to their arrival look forever.
    lastSaved = serializeEdits();
  }
  // auto-zoom is opt-in: loading never creates zooms, the Auto button does

  // UI
  $('dropHint').classList.add('hidden');
  $('exportBtn').disabled = false;
  // Absent capability = faded + inert, never hidden: the dead section is
  // documentation for the recorder, delivered at the exact moment the user
  // wishes they had the feature. Hidden sections make the tool look smaller
  // than it is. inert, not bare pointer-events — faded controls must not
  // stay Tab-reachable.
  const absent = (id, off) => { const el = $(id); el.classList.toggle('absent', off); el.inert = off; };
  const hasKeys = !!(cursor && cursor.keystrokes && cursor.keystrokes.length);
  absent('secWebcam', !webcam);
  absent('micRow', !micFile);
  absent('sysRow', !sysFile);
  absent('keysRow', !hasKeys);
  // hint wording follows provenance: a recorder bundle names the flag that
  // lights the section up; a plain OBS/QuickTime video is not a "recording
  // without --webcam", it never had one to begin with
  $('camHint').style.display = webcam ? 'none' : '';
  $('camHint').textContent = meta ? 'Recorded without --webcam.' : 'This video has no webcam track.';
  $('keysHint').style.display = (!hasKeys && meta) ? '' : 'none';
  const audioBits = [];
  if (micFile) audioBits.push('microphone');
  if (sysFile) audioBits.push(meta ? 'system audio' : "the video's own audio");
  let audioTxt = audioBits.length
    ? 'Tracks: ' + audioBits.join(' + ') + '.' : 'No audio tracks in this recording.';
  if (meta && !micFile) audioTxt += ' Recorded without --mic.';
  if (meta && !sysFile) audioTxt += ' Recorded with --no-system-audio.';
  $('audioHint').textContent = audioTxt;
  buildTick();
  applyAudioPrefs();
  fitPreviewCanvas();
  sizeTimeline();
  seekTo(0);
  updateZoomPanel();
  // undo baseline: whatever state the recording opened with is the floor
  undoStack.length = 0; redoStack.length = 0; undoReady = true;
  updateSizeEst();
  // Damage rides in the load toast rather than its own: a second toast would
  // simply overwrite the first, and the summary is what tells you the take
  // survived. Naming the file and what it cost beats a console error nobody opens.
  const dmg = damaged.length
    ? ' ' + damaged.map(n => n === 'meta.json'
        ? 'meta.json is damaged, so this opened as a plain video.'
        : 'cursor.json is damaged, so there is no auto-zoom or smoothed cursor.').join(' ')
    : '';
  if (restored) toast('Welcome back — restored your previous edits for this recording.' + dmg, dmg ? 6000 : 3200, dmg ? 'warn' : '');
  else {
    const bits = [`${video.videoWidth}×${video.videoHeight}`, fmtT(video.duration)];
    const nClicks = cursor ? (cursor.clicks || []).filter(c => c.down).length : 0;
    if (cursor) bits.push(`${nClicks} click${nClicks === 1 ? '' : 's'}`);
    if (webcam) bits.push('webcam');
    toast('Loaded — ' + bits.join(' · ') + (nClicks ? '. Auto can zoom your clicks.' : '') + dmg,
      dmg ? 6000 : (nClicks ? 4500 : 3200), dmg ? 'warn' : '');
  }
}

// drag & drop (supports folders)
async function readEntry(entry, out) {
  if (entry.isFile) {
    await new Promise(res => entry.file(f => { out.push(f); res(); }, res));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise(res => reader.readEntries(res, () => res([])));
      for (const e of batch) await readEntry(e, out);
    } while (batch.length);
  }
}
document.body.addEventListener('dragover', e => e.preventDefault());
document.body.addEventListener('drop', async e => {
  e.preventDefault();
  const out = [];
  const items = [...e.dataTransfer.items];
  for (const it of items) {
    const entry = it.webkitGetAsEntry && it.webkitGetAsEntry();
    if (entry) await readEntry(entry, out);
    else { const f = it.getAsFile(); if (f) out.push(f); }
  }
  if (out.length) loadFromFiles(out).catch(console.error);
});
$('openBtn').onclick = $('openBtn2').onclick = () => $('dirInput').click();
$('openFiles').onclick = () => $('filesInput').click();
$('dirInput').onchange = e => { if (e.target.files.length) loadFromFiles(e.target.files).catch(console.error); };
$('filesInput').onchange = e => { if (e.target.files.length) loadFromFiles(e.target.files).catch(console.error); };

// ------------------------------------------------------------------ cursor track (smoothing)
function buildTrack() {
  if (!S.cursor || !S.cursor.samples || S.cursor.samples.length < 2) { S.track = null; return; }
  const raw = S.cursor.samples, rate = S.trackRate, n = Math.ceil(S.duration * rate) + 1;
  const xs = new Float32Array(n), ys = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    while (j < raw.length - 2 && raw[j + 1][0] <= t) j++;
    const a = raw[j], b = raw[Math.min(j + 1, raw.length - 1)];
    const f = b[0] > a[0] ? clamp((t - a[0]) / (b[0] - a[0]), 0, 1) : 0;
    xs[i] = lerp(a[1], b[1], f) * S.pointScale;
    ys[i] = lerp(a[2], b[2], f) * S.pointScale;
  }
  // zero-phase exponential smoothing (forward + backward)
  const tau = (S.set.curSmooth / 100) * 0.22;           // seconds of smoothing
  if (tau > 0.001) {
    const alpha = (1 / rate) / (tau + 1 / rate);
    for (const arr of [xs, ys]) {
      for (let i = 1; i < n; i++) arr[i] = arr[i - 1] + alpha * (arr[i] - arr[i - 1]);
      for (let i = n - 2; i >= 0; i--) arr[i] = arr[i + 1] + alpha * (arr[i] - arr[i + 1]);
    }
  }
  // idle detection: for each sample, when did the cursor last move (or click)?
  const last = new Float32Array(n);
  const TH = 60 / rate;                       // ~60 video-px/sec counts as movement
  let lastMove = -1e9;
  for (let i = 0; i < n; i++) {
    if (i > 0 && Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]) > TH) lastMove = i / rate;
    last[i] = lastMove;
  }
  for (const c of S.cursor.clicks || []) {    // clicks reset the idle clock too
    if (!c.down) continue;
    for (let i = Math.max(0, Math.floor(c.t * rate)); i < n && last[i] < c.t; i++) last[i] = c.t;
  }
  S.track = { xs, ys, n, last };
}

// 1 = fully visible, 0 = hidden; fades out over 0.25s once idle for `idleAfter`
function cursorAlpha(t) {
  if (!S.set.hideIdle || !S.track || !S.track.last) return 1;
  const i = clamp(Math.floor(t * S.trackRate), 0, S.track.n - 1);
  const idle = t - S.track.last[i];
  return clamp(1 - (idle - S.set.idleAfter) / 0.25, 0, 1);
}
function cursorAt(t) {
  if (!S.track) return null;
  const f = clamp(t * S.trackRate, 0, S.track.n - 1.001);
  const i = Math.floor(f), fr = f - i;
  return {
    x: lerp(S.track.xs[i], S.track.xs[i + 1], fr),
    y: lerp(S.track.ys[i], S.track.ys[i + 1], fr)
  };
}

// ------------------------------------------------------------------ zoom segments
function autoZoomFromClicks(quiet = false) {
  pushUndo();   // no-op before undoReady (initial load)
  const downs = (S.cursor.clicks || []).filter(c => c.down && c.button === 0);
  const segs = [];
  const LEAD = S.set.zoomLead, HOLD = S.set.zoomHold, GAP = Math.max(1.0, S.set.zoomHold * 0.75);
  const cr = cropRect();   // aims clamp into the crop like addZoomAt's — a click can land where the crop isn't
  for (const c of downs) {
    const x = clamp(c.x * S.pointScale, cr.x, cr.x + cr.w), y = clamp(c.y * S.pointScale, cr.y, cr.y + cr.h);
    const last = segs[segs.length - 1];
    if (last && c.t - last.t1 < GAP) {
      last.t1 = Math.min(S.duration, c.t + HOLD);
      last.x = lerp(last.x, x, 0.6); last.y = lerp(last.y, y, 0.6);  // drift toward newest click
      last.nc++;
    } else {
      segs.push({ t0: Math.max(0, c.t - LEAD), t1: Math.min(S.duration, c.t + HOLD), x, y, z: 2, nc: 1, auto: true });
    }
  }
  // replace auto-generated zooms; keep manually added ones
  const auto = segs.filter(s => s.t1 - s.t0 > 0.5);
  S.segs = S.segs.filter(s => !s.auto).concat(auto).sort((a, b) => a.t0 - b.t0);
  S.selSeg = -1;
  updateZoomPanel(); drawTimeline(); requestRender();
  if (!quiet) toast(`Auto-zoom: ${auto.length} zoom${auto.length === 1 ? '' : 's'} created from your clicks.`);
}

function addZoomAt(t) {
  pushUndo();
  const cur = cursorAt(t);
  const cr = cropRect();
  const seg = {
    t0: clamp(t - 0.2, 0, Math.max(0, S.duration - 0.6)),
    t1: clamp(t + 1.8, 0.6, S.duration),
    x: clamp(cur ? cur.x : cr.x + cr.w / 2, cr.x, cr.x + cr.w),
    y: clamp(cur ? cur.y : cr.y + cr.h / 2, cr.y, cr.y + cr.h),
    z: 2
  };
  S.segs.push(seg);
  S.segs.sort((a, b) => a.t0 - b.t0);
  S.selSeg = S.segs.indexOf(seg);
  updateZoomPanel(); drawTimeline(); requestRender();
}

function updateZoomPanel() {
  const sel = S.segs[S.selSeg];
  $('zoomSel').style.display = sel ? '' : 'none';
  if (sel) { $('zLevel').value = sel.z; $('zLevelV').textContent = sel.z.toFixed(1) + '×'; setFill($('zLevel')); }
  $('zoomCount').textContent = S.segs.length
    ? `${S.segs.length} zoom${S.segs.length === 1 ? '' : 's'} on the timeline.`
    : 'No zooms yet — record with clicks enabled, or add one manually.';
  updateHelpStrip();
}

// The hint strip reads the current selection: the same key does different
// things by state, and the one that destroys footage (⌫ on a piece) must
// never be the silent one. Prebuilt variants — the kbd chips are children,
// so textContent would flatten them. The ? overlay stays the full reference.
const HELP_HTML = {
  none:  '',
  seg:   '<kbd>⌫</kbd> delete this zoom · drag the ring to aim',
  piece: '<kbd>⌫</kbd> cut this section',
  cut:   '<kbd>⌫</kbd> restore',
};
// Only one of these removes footage. Deleting a zoom or restoring a cut are
// both cheap; cutting a piece is the one worth marking. The tint goes on the
// ⌫ chip, not the sentence, following #toast's coloured dot — and because
// everything here is undoable, a red sentence would overstate it.
const HELP_DANGER = { piece: true };
function updateHelpStrip() {
  const k = S.selSeg >= 0 ? 'seg' : S.selCut >= 0 ? 'cut' : S.selPiece >= 0 ? 'piece' : 'none';
  const el = $('tlHelp');
  if (el.dataset.state === k) return;
  el.dataset.state = k;
  el.innerHTML = HELP_HTML[k];
  // Silent when nothing is selected. A line that always says something gets
  // filed by the eye as furniture, and furniture is invisible at any size.
  el.classList.toggle('speaking', k !== 'none');
  el.classList.toggle('danger', !!HELP_DANGER[k]);
}

// ------------------------------------------------------------------ undo / redo (timeline + crop edits only)
const UNDO_MAX = 100;
let undoStack = [], redoStack = [], undoReady = false;

function editSnapshot() {
  return structuredClone({
    segs: S.segs, splits: S.splits, cuts: S.cuts,
    trimIn: S.trimIn, trimOut: S.trimOut, crop: S.set.crop
  });
}
function pushUndo() {
  if (!undoReady) return;
  undoStack.push(editSnapshot());
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0;
}
// one serialiser for the interval, flushSave AND the non-restored seed below —
// if the seed were built by hand and drifted a byte, the first tick would
// write an autosave for a recording nobody edited
function serializeEdits() {
  return JSON.stringify({ v: 2, set: S.set, segs: S.segs, trimIn: S.trimIn, trimOut: S.trimOut, splits: S.splits, cuts: S.cuts });
}
function flushSave() {   // force the autosave write NOW (undo/redo must survive instant reload)
  if (!S.fileKey) return;
  try {
    const data = serializeEdits();
    localStorage.setItem('retake:' + S.fileKey, data);
    lastSaved = data;
  } catch (e) {}
}
function applySnapshot(snap) {
  const cropChanged = JSON.stringify(S.set.crop) !== JSON.stringify(snap.crop);
  S.segs = snap.segs; S.splits = snap.splits; S.cuts = snap.cuts;
  S.trimIn = snap.trimIn; S.trimOut = snap.trimOut; S.set.crop = snap.crop;
  S.selSeg = -1; S.selPiece = -1; S.selCut = -1;   // stale indexes are landmines
  if (cropChanged) fitPreviewCanvas();
  $('cropInfo').style.display = S.set.crop ? '' : 'none';
  if (S.set.crop) $('cropInfo').textContent = `Cropped to ${S.set.crop.w}×${S.set.crop.h} — Crop… to change.`;
  updateZoomPanel(); drawTimeline(); updateSizeEst(); updateTimeUI(); requestRender();
  flushSave();
}
function undo() {
  if (!undoStack.length) { toast('Nothing to undo.', 1200); return; }
  redoStack.push(editSnapshot());
  applySnapshot(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(editSnapshot());
  applySnapshot(redoStack.pop());
}

// ------------------------------------------------------------------ cuts (source-time ranges removed from the output)
function cutsNorm() {
  const cs = S.cuts
    .map(c => ({ t0: clamp(Math.min(c.t0, c.t1), 0, S.duration), t1: clamp(Math.max(c.t0, c.t1), 0, S.duration) }))
    .filter(c => c.t1 - c.t0 > 0.01)
    .sort((a, b) => a.t0 - b.t0);
  const out = [];
  for (const c of cs) {
    const last = out[out.length - 1];
    if (last && c.t0 <= last.t1 + 0.001) last.t1 = Math.max(last.t1, c.t1);
    else out.push({ ...c });
  }
  return out;
}
// intervals of source time that survive trim + cuts
function keepIntervals() {
  const keep = [];
  let a = S.trimIn;
  for (const c of cutsNorm()) {
    if (c.t1 <= S.trimIn || c.t0 >= S.trimOut) continue;
    if (c.t0 > a) keep.push({ a, b: Math.min(c.t0, S.trimOut) });
    a = Math.max(a, c.t1);
  }
  if (a < S.trimOut) keep.push({ a, b: S.trimOut });
  return keep.filter(k => k.b - k.a > 0.005);
}
function outDuration() {
  return keepIntervals().reduce((s, k) => s + (k.b - k.a), 0);
}
function out2src(ot) {
  let rem = ot;
  const keep = keepIntervals();
  for (const k of keep) {
    const len = k.b - k.a;
    if (rem <= len) return k.a + rem;
    rem -= len;
  }
  return keep.length ? keep[keep.length - 1].b : S.trimIn;
}
function src2out(st) {
  let acc = 0;
  for (const k of keepIntervals()) {
    if (st <= k.a) return acc;
    if (st <= k.b) return acc + (st - k.a);
    acc += k.b - k.a;
  }
  return acc;
}
// pieces of the video track between splits (excluding cut ranges)
function pieces() {
  const cuts = cutsNorm();
  const bounds = [S.trimIn,
    ...S.splits.filter(t => t > S.trimIn + 0.01 && t < S.trimOut - 0.01
      && !cuts.some(c => t >= c.t0 && t <= c.t1)).sort((a, b) => a - b),
    S.trimOut];
  const out = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    let a = bounds[i], b = bounds[i + 1];
    // subtract cut ranges from this piece
    let segs = [{ a, b }];
    for (const c of cuts) {
      segs = segs.flatMap(s => {
        if (c.t1 <= s.a || c.t0 >= s.b) return [s];
        const r = [];
        if (c.t0 > s.a) r.push({ a: s.a, b: c.t0 });
        if (c.t1 < s.b) r.push({ a: c.t1, b: s.b });
        return r;
      });
    }
    for (const s of segs) if (s.b - s.a > 0.05) out.push({ t0: s.a, t1: s.b });
  }
  return out;
}
function splitAtPlayhead() {
  if (!S.loaded || S.cropMode) return;
  const t = S.video.currentTime;
  if (t <= S.trimIn + 0.05 || t >= S.trimOut - 0.05) return;
  if (S.splits.some(s => Math.abs(s - t) < 0.05)) return;
  if (cutsNorm().some(c => t >= c.t0 && t <= c.t1)) return;
  pushUndo();
  S.splits.push(t);
  S.splits.sort((a, b) => a - b);
  drawTimeline();
  toast('Split — click a piece and press ⌫ to remove it.', 2200);
}
function deleteSelection() {
  if (S.selSeg >= 0) {
    pushUndo();
    S.segs.splice(S.selSeg, 1); S.selSeg = -1;
    updateZoomPanel(); drawTimeline(); requestRender();
    return;
  }
  if (S.selCut >= 0) {                       // restore a cut section
    const c = cutsNorm()[S.selCut];
    if (c) { pushUndo(); S.cuts = cutsNorm().filter((_, i) => i !== S.selCut); }
    S.selCut = -1;
    drawTimeline(); updateSizeEst(); updateTimeUI(); updateHelpStrip();
    return;
  }
  if (S.selPiece >= 0) {                     // cut a piece out
    const p = pieces()[S.selPiece];
    if (p) {
      if (outDuration() - (p.t1 - p.t0) < 0.5) { toast("Can't remove the last half-second of video."); return; }
      pushUndo();
      S.cuts.push({ t0: p.t0, t1: p.t1 });
      // keep the playhead out of the removed range
      if (S.video.currentTime >= p.t0 && S.video.currentTime <= p.t1) seekTo(p.t1 + 0.01);
    }
    S.selPiece = -1;
    drawTimeline(); updateSizeEst(); updateTimeUI(); updateHelpStrip();
  }
}

// the "virtual recording": the crop rect, or the full frame
function cropRect() {
  return S.set.crop || { x: 0, y: 0, w: S.video.videoWidth, h: S.video.videoHeight };
}

// camera state at time t — blends all segment influences for buttery overlaps
let aimOverride = false;   // true while the aim ring is dragged (preview pointerdown)
function cameraAt(t) {
  const TRANS = S.set.zoomTrans;
  const cr = cropRect();
  const ccx = cr.x + cr.w / 2, ccy = cr.y + cr.h / 2;
  // During an aim drag the preview drops to the full cropped frame: aim on
  // the map, not through the telescope. The old zoomed-in drag was a feedback
  // loop — aim moves camera, camera shifts content, same pointer maps to a
  // new point. The override lives HERE, not in draw: motion blur samples
  // cameraAt up to ten times a frame, and a draw-level override would tear
  // between camera models.
  if (aimOverride) return { z: 1, cx: ccx, cy: ccy };
  let wsum = 0, zx = 0, zy = 0, zz = 0;
  for (const s of S.segs) {
    let w = 0;
    if (t >= s.t0 && t <= s.t1) w = 1;
    else if (t > s.t0 - TRANS && t < s.t0) w = ease((t - (s.t0 - TRANS)) / TRANS);
    else if (t > s.t1 && t < s.t1 + TRANS) w = 1 - ease((t - s.t1) / TRANS);
    if (w > 0) { wsum += w; zx += w * s.x; zy += w * s.y; zz += w * s.z; }
  }
  if (wsum <= 0) return { z: 1, cx: ccx, cy: ccy };
  const nx = zx / wsum, ny = zy / wsum, nz = zz / wsum;
  const w = Math.min(1, wsum);
  const z = lerp(1, nz, w);
  let cx = lerp(ccx, nx, w), cy = lerp(ccy, ny, w);
  // clamp so the viewport stays inside the (cropped) frame
  const hw = cr.w / z / 2, hh = cr.h / z / 2;
  cx = clamp(cx, cr.x + hw, cr.x + cr.w - hw);
  cy = clamp(cy, cr.y + hh, cr.y + cr.h - hh);
  return { z, cx, cy };
}

// ------------------------------------------------------------------ rendering
const preview = $('preview');
const pctx = preview.getContext('2d');

function fitPreviewCanvas() {
  const cr = S.cropMode
    ? { w: S.video.videoWidth, h: S.video.videoHeight }
    : cropRect();
  const h = Math.min(cr.h, 900);
  preview.height = Math.round(h);
  preview.width = Math.round(h * cr.w / cr.h);
}

// draw the classic macOS arrow cursor
function drawArrow(ctx, x, y, s) {
  const P = [[0,0],[0,16.9],[4.2,13.2],[7.1,19.6],[9.7,18.4],[6.9,12.2],[12.4,12.2]];
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  ctx.beginPath();
  P.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 2.4; ctx.stroke();
  ctx.fillStyle = 'rgba(20,20,24,.98)'; ctx.fill();
  ctx.restore();
}

function draw(ctx, W, H, t, opts = {}) {
  const cr = cropRect();
  const vw = cr.w, vh = cr.h;      // virtual (cropped) recording dimensions
  // background
  if (S.set.bg === -1 && S.bgImg) {
    const iw = S.bgImg.width, ih = S.bgImg.height;
    const s = Math.max(W / iw, H / ih);
    ctx.drawImage(S.bgImg, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = bgGradient(ctx, W, H);
    ctx.fillRect(0, 0, W, H);
  }
  // subtle vignette
  const vg = ctx.createRadialGradient(W/2, H/2, Math.min(W,H)*.35, W/2, H/2, Math.max(W,H)*.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  // content rect (video keeps its aspect; padding is % of min dimension)
  const pad = S.set.pad / 100 * Math.min(W, H);
  const scale = Math.min((W - pad * 2) / vw, (H - pad * 2) / vh);
  const rw = vw * scale, rh = vh * scale;
  const rx = (W - rw) / 2, ry = (H - rh) / 2;
  const rad = S.set.radius / 100 * Math.min(rw, rh) * 0.5;

  // camera
  const cam = cameraAt(t);
  const sw = vw / cam.z, sh = vh / cam.z;
  const sx = cam.cx - sw / 2, sy = cam.cy - sh / 2;

  // shadow
  if (S.set.shadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${0.28 + S.set.shadow / 100 * 0.45})`;
    ctx.shadowBlur = S.set.shadow / 100 * Math.min(W, H) * 0.09;
    ctx.shadowOffsetY = S.set.shadow / 100 * Math.min(W, H) * 0.028;
    roundRectPath(ctx, rx, ry, rw, rh, rad);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.restore();
  }

  // video (zoomed viewport → rounded rect), with motion blur on fast camera moves
  ctx.save();
  roundRectPath(ctx, rx, ry, rw, rh, rad);
  ctx.clip();
  let passes = [[sx, sy, sw, sh]];
  if (S.set.mblur) {
    const dt = 0.03;
    const c0 = cameraAt(t - dt), c1 = cameraAt(t + dt);
    const speed = Math.hypot(c1.cx - c0.cx, c1.cy - c0.cy) / (2 * dt) / sw
                + Math.abs(c1.z - c0.z) / (2 * dt) * 0.8;   // viewports/sec + zoom rate
    if (speed > 0.5) {
      const n = Math.min(7, 2 + Math.floor(speed * 2));
      const shutter = 0.024;
      passes = [];
      for (let i = 0; i < n; i++) {
        const ci = cameraAt(t + (i / (n - 1) - 0.5) * shutter);
        const swi = vw / ci.z, shi = vh / ci.z;
        passes.push([ci.cx - swi / 2, ci.cy - shi / 2, swi, shi]);
      }
    }
  }
  passes.forEach((p, i) => {
    ctx.globalAlpha = 1 / (i + 1);   // iterative averaging → fully opaque result
    ctx.drawImage(S.video, p[0], p[1], p[2], p[3], rx, ry, rw, rh);
  });
  ctx.globalAlpha = 1;

  const toCanvas = (px, py) => [rx + (px - sx) / sw * rw, ry + (py - sy) / sh * rh];
  const zscale = rw / sw;   // canvas px per video px (includes zoom)

  // click ripples
  if (S.set.ripples && S.cursor) {
    for (const c of S.cursor.clicks || []) {
      if (!c.down) continue;
      const age = t - c.t;
      if (age < 0 || age > 0.55) continue;
      const k = age / 0.55;
      const [cxp, cyp] = toCanvas(c.x * S.pointScale, c.y * S.pointScale);
      const r = (10 + 46 * ease(k)) * zscale * (S.set.curSize * 0.7 + 0.3);
      ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, 7);
      ctx.strokeStyle = `rgba(255,255,255,${0.65 * (1 - k)})`;
      ctx.lineWidth = 3 * zscale * (1 - k) + 0.5;
      ctx.stroke();
    }
  }

  // synthetic cursor (with a subtle squeeze on each click; fades out when idle)
  const cur = cursorAt(t);
  const curA = cur ? cursorAlpha(t) : 0;
  if (cur && curA > 0 && S.set.cursorStyle !== 'none') {
    ctx.save();
    ctx.globalAlpha = curA;
    const [cx, cy] = toCanvas(cur.x, cur.y);
    let squeeze = 1;
    if (S.cursor) for (const c of S.cursor.clicks || []) {
      if (!c.down) continue;
      const age = t - c.t;
      if (age >= 0 && age < 0.22) { squeeze = 1 - 0.22 * Math.sin(Math.PI * age / 0.22); break; }
    }
    const cs = S.set.curSize * zscale * squeeze;
    const style = S.set.cursorStyle;

    const glyph = (gx, gy) => {
      if (style === 'ring') {
        // halo: clearly-visible translucent disc, uniform fill, soft only at the rim
        const r = 32 * cs;
        const [cr2, cg2, cb] = hexToRgb(S.set.spotColor);
        const op = S.set.spotOpacity / 100;
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        g.addColorStop(0, `rgba(${cr2},${cg2},${cb},${op})`);
        g.addColorStop(0.78, `rgba(${cr2},${cg2},${cb},${op})`);   // flat body
        g.addColorStop(1, `rgba(${cr2},${cg2},${cb},0)`);          // feather only the edge
        ctx.beginPath(); ctx.arc(gx, gy, r, 0, 7);
        ctx.fillStyle = g; ctx.fill();
        // soft inner shadow hugging the edge — contrast on any background
        const sh = Math.min(0.5, op * 0.9);
        const ig = ctx.createRadialGradient(gx, gy, r * 0.6, gx, gy, r);
        ig.addColorStop(0, 'rgba(0,0,0,0)');
        ig.addColorStop(0.82, `rgba(0,0,0,${sh})`);
        ig.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath(); ctx.arc(gx, gy, r, 0, 7);
        ctx.fillStyle = ig; ctx.fill();
      } else if (style === 'dot') {
        ctx.beginPath(); ctx.arc(gx, gy, 7 * cs, 0, 7);
        ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
        ctx.beginPath(); ctx.arc(gx, gy, 7 * cs, 0, 7);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5 * cs; ctx.stroke();
      } else {
        drawArrow(ctx, gx, gy, cs);
      }
    };

    // motion blur on the cursor itself when it's moving fast
    let cpasses = [[cx, cy]];
    if (S.set.mblur) {
      const dt = 0.02;
      const a = cursorAt(t - dt), b = cursorAt(t + dt);
      const v = Math.hypot(b.x - a.x, b.y - a.y) / (2 * dt);   // video px/s
      if (v > 500) {
        const n = Math.min(12, 3 + Math.floor(v / 450));
        cpasses = [];
        for (let i = 0; i < n; i++) {
          const ci = cursorAt(t + (i / (n - 1) - 0.5) * 0.02);
          cpasses.push(toCanvas(ci.x, ci.y));
        }
      }
    }
    // uniform 1/n weighting: unlike the opaque video layer, the glyph is
    // semi-transparent — iterative averaging would stack shadows darker in
    // overlaps, so each pass gets equal weight and overlaps converge to the
    // single-pass opacity instead.
    cpasses.forEach(p => {
      ctx.globalAlpha = curA / cpasses.length;
      glyph(p[0], p[1]);
    });
    ctx.restore();   // end cursor alpha
  }
  ctx.restore(); // end video clip

  // keystroke pills (screen-space, only when recorded with --keys)
  if (S.set.keysOn && S.cursor && S.cursor.keystrokes && S.cursor.keystrokes.length) {
    const recent = S.cursor.keystrokes.filter(k => k[0] <= t && t - k[0] < 1.4).slice(-4);
    if (recent.length) {
      const alpha = clamp((1.4 - (t - recent[recent.length - 1][0])) / 0.4, 0, 1);
      const text = recent.map(k => k[1]).join('  ');
      const fs = Math.max(13, rh * 0.05);
      ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, sans-serif`;
      const tw = ctx.measureText(text).width;
      const phW = tw + fs * 1.6, phH = fs * 1.9;
      const py = ry + rh - phH - rh * 0.045;
      ctx.globalAlpha = alpha;
      roundRectPath(ctx, W / 2 - phW / 2, py, phW, phH, phH * 0.3);
      ctx.fillStyle = 'rgba(16,18,24,0.82)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, W / 2, py + phH / 2);
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
    }
  }

  // webcam bubble (screen-space, unaffected by zoom)
  if (S.webcam && S.set.camShow && S.webcam.readyState >= 2) {
    const d = S.set.camSize / 100 * Math.min(W, H);
    const m = Math.max(pad * 0.55, Math.min(W, H) * 0.022);
    const x = S.set.camPos.includes('l') ? m : W - m - d;
    const y = S.set.camPos.includes('t') ? m : H - m - d;
    const r = S.set.camShape === 'circle' ? d / 2 : d * 0.18;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = d * 0.18; ctx.shadowOffsetY = d * 0.05;
    roundRectPath(ctx, x, y, d, d, r);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.restore();
    ctx.save();
    roundRectPath(ctx, x, y, d, d, r);
    ctx.clip();
    const cw = S.webcam.videoWidth, ch = S.webcam.videoHeight;
    const cscale = Math.max(d / cw, d / ch);   // cover
    ctx.drawImage(S.webcam, x + d / 2 - cw * cscale / 2, y + d / 2 - ch * cscale / 2, cw * cscale, ch * cscale);
    ctx.restore();
    roundRectPath(ctx, x, y, d, d, r);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1.5, d * 0.012); ctx.stroke();
  }

  // zoom-aim overlay (preview only)
  if (!opts.export && S.selSeg >= 0 && S.segs[S.selSeg]) {
    const s = S.segs[S.selSeg];
    const [ax, ay] = toCanvas(s.x, s.y);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.arc(ax, ay, 34, 0, 7);
    ctx.strokeStyle = 'rgba(124,140,255,0.95)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(ax, ay, 4, 0, 7);
    ctx.fillStyle = 'rgba(124,140,255,0.95)'; ctx.fill();
    ctx.restore();
  }
}

// preview render loop
let renderQueued = false;
function requestRender() {
  if (renderQueued || !S.loaded) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderFrame(); });
}
function renderFrame() {
  if (!S.loaded || S.exporting) return;
  if (S.cropMode) drawCropUI();
  else draw(pctx, preview.width, preview.height, S.video.currentTime);
  updateTimeUI();
}

// ---- crop mode: full-frame view with a draggable rect
const CROP_MIN = 120;   // smallest crop dimension, shared by pointer and keyboard paths
function cropFit() {   // full video → preview mapping
  const W = preview.width, H = preview.height;
  const fvw = S.video.videoWidth, fvh = S.video.videoHeight;
  const sc = Math.min(W / fvw, H / fvh) * 0.97;
  return { sc, ox: (W - fvw * sc) / 2, oy: (H - fvh * sc) / 2 };
}
function drawCropUI() {
  const ctx = pctx, W = preview.width, H = preview.height;
  const { sc, ox, oy } = cropFit();
  const fvw = S.video.videoWidth, fvh = S.video.videoHeight;
  ctx.fillStyle = '#0a0b0e'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(S.video, ox, oy, fvw * sc, fvh * sc);
  const d = S.cropDraft;
  const dx = ox + d.x * sc, dy = oy + d.y * sc, dw = d.w * sc, dh = d.h * sc;
  // darken outside the crop
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(ox, oy, fvw * sc, dy - oy);
  ctx.fillRect(ox, dy + dh, fvw * sc, oy + fvh * sc - dy - dh);
  ctx.fillRect(ox, dy, dx - ox, dh);
  ctx.fillRect(dx + dw, dy, ox + fvw * sc - dx - dw, dh);
  // rule-of-thirds grid, dual-stroked — same lesson as the size label below:
  // white alone disappears over light content, so a dark underlay carries it
  const gridLines = () => {
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(dx + dw * i / 3, dy); ctx.lineTo(dx + dw * i / 3, dy + dh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(dx, dy + dh * i / 3); ctx.lineTo(dx + dw, dy + dh * i / 3); ctx.stroke();
    }
  };
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 3; gridLines();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; gridLines();
  // border + handles
  ctx.strokeStyle = '#7c8cff'; ctx.lineWidth = 2;
  ctx.strokeRect(dx, dy, dw, dh);
  ctx.fillStyle = '#fff';
  for (const [hx, hy] of cropHandles(dx, dy, dw, dh)) {
    ctx.beginPath(); ctx.arc(hx, hy, 6, 0, 7); ctx.fill();
  }
  // size label on a plate — white text alone disappears over light content
  const label = `${Math.round(d.w)} × ${Math.round(d.h)}`;
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
  const lw = ctx.measureText(label).width + 16, lh = 22;
  const lx = clamp(dx + 10, ox + 4, ox + fvw * sc - lw - 4);
  const ly = clamp(dy + 10, oy + 4, oy + fvh * sc - lh - 4);
  roundRectPath(ctx, lx, ly, lw, lh, 6);
  ctx.fillStyle = 'rgba(10,11,14,0.74)'; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, lx + 8, ly + lh / 2);
  ctx.textBaseline = 'alphabetic';
}
function cropHandles(x, y, w, h) {
  return [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2],
          [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]];
}
function enterCropMode() {
  if (!S.loaded) return;
  pause();
  const fvw = S.video.videoWidth, fvh = S.video.videoHeight;
  S.cropDraft = S.set.crop ? { ...S.set.crop } : { x: 0, y: 0, w: fvw, h: fvh };
  S.cropMode = true;
  $('cropUI').style.display = '';
  $('cropBtn').style.display = 'none';
  $('side').classList.add('cropping');   // one mode at a time
  // Reopening a crop restores its ratio lock, not just its rectangle: the rect
  // came back at 21:9, so dragging a corner has to keep it there. Only a crop
  // that actually exists carries a lock (Reset clears both).
  aspectDraft = S.set.crop ? { ...(S.set.aspect || { v: 'free' }) } : { v: 'free' };
  const custom = aspectDraft.v === 'custom';
  $('cropAspects').querySelectorAll('button').forEach(b => b.classList.toggle('sel', b.dataset.v === aspectDraft.v));
  $('cropCustomRow').style.display = custom ? '' : 'none';
  $('cropCustomHint').style.display = custom ? '' : 'none';
  if (custom) { $('cropW').value = aspectDraft.w ?? ''; $('cropH').value = aspectDraft.h ?? ''; }
  // set the lock directly — applyCropAspect would refit the draft we just restored
  S.cropAspect = aspectDraft.v === 'free' ? null
    : custom ? (aspectDraft.w > 0 && aspectDraft.h > 0 ? aspectDraft.w / aspectDraft.h : null)
    : parseFloat(aspectDraft.v);
  customBase = custom ? { ...S.cropDraft } : null;
  fitPreviewCanvas();
  requestRender();
}
function exitCropMode(apply) {
  if (apply) {
    S.set.aspect = { ...aspectDraft };   // only Apply commits the choice; Cancel leaves it untouched
    pushUndo();
    const d = S.cropDraft, fvw = S.video.videoWidth, fvh = S.video.videoHeight;
    const full = d.x < 2 && d.y < 2 && d.w > fvw - 4 && d.h > fvh - 4;
    S.set.crop = full ? null : {
      x: Math.round(d.x), y: Math.round(d.y), w: Math.round(d.w) & ~1, h: Math.round(d.h) & ~1
    };
  }
  S.cropMode = false;
  $('cropUI').style.display = 'none';
  $('cropBtn').style.display = '';
  $('side').classList.remove('cropping');
  $('cropInfo').style.display = S.set.crop ? '' : 'none';
  if (S.set.crop) $('cropInfo').textContent = `Cropped to ${S.set.crop.w}×${S.set.crop.h} — Crop… to change.`;
  fitPreviewCanvas();
  updateSizeEst();
  requestRender();
}
$('cropBtn').onclick = enterCropMode;
$('cropApply').onclick = () => exitCropMode(true);
$('cropCancel').onclick = () => exitCropMode(false);
$('cropReset').onclick = () => {
  if (S.set.crop) pushUndo();
  S.set.crop = null; S.set.aspect = { v: 'free' };   // no crop, no lock
  exitCropMode(false);
};
function applyCropAspect(ratio) {
  S.cropAspect = ratio;
  if (ratio) {
    // fit the largest rect of this aspect inside the current draft, centered
    const d = S.cropDraft;
    let w = d.w, h = w / ratio;
    if (h > d.h) { h = d.h; w = h * ratio; }
    S.cropDraft = { x: d.x + (d.w - w) / 2, y: d.y + (d.h - h) / 2, w, h };
  }
  requestRender();
}
$('cropAspects').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  $('cropAspects').querySelectorAll('button').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel');
  const v = b.dataset.v;
  const custom = v === 'custom';
  $('cropCustomRow').style.display = custom ? '' : 'none';
  $('cropCustomHint').style.display = custom ? '' : 'none';
  if (custom) {
    customBase = { ...S.cropDraft };
    const cw = parseFloat($('cropW').value) || null, ch = parseFloat($('cropH').value) || null;
    aspectDraft = { v: 'custom', w: cw, h: ch };
    // empty fields define no ratio, so the previous lock must go — otherwise the
    // button says Custom while corners still snap to the ratio before it
    if (!(cw > 0 && ch > 0)) S.cropAspect = null;
    $('cropW').focus(); applyCustomRatio(); return;
  }
  customBase = null;
  aspectDraft = { v };
  applyCropAspect(v === 'free' ? null : parseFloat(v));
}));
// two numeric fields, w : h — an empty field or a ratio outside 0.2–5 changes nothing.
// Every keystroke refits from the draft as it was when Custom was clicked, so
// typing "2" then "21" can't progressively shrink the box.
let customBase = null, aspectDraft = { v: 'free' };
const applyCustomRatio = () => {
  const w = parseFloat($('cropW').value), h = parseFloat($('cropH').value);
  const r = w > 0 && h > 0 ? w / h : null;
  if (!(r && isFinite(r) && r >= 0.2 && r <= 5)) return;
  aspectDraft = { v: 'custom', w, h };
  if (customBase) S.cropDraft = { ...customBase };
  applyCropAspect(r);
};
$('cropW').addEventListener('input', applyCustomRatio);
$('cropH').addEventListener('input', applyCustomRatio);
// crop is keyboard-operable: arrows nudge the box in source px (Shift ×10),
// Alt+arrow resizes it anchored top-left. No undo per keypress — the crop
// commits at Apply, same as the pointer path.
function cropKey(e) {
  if (e.key === 'Escape') { exitCropMode(false); return; }
  if (e.metaKey || e.ctrlKey) return;
  if (e.target.tagName === 'INPUT') return;   // typing a custom ratio must not nudge
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!dir) return;
  e.preventDefault();   // an unconsumed arrow scrolls #side
  const d = S.cropDraft, fvw = S.video.videoWidth, fvh = S.video.videoHeight;
  const step = e.shiftKey ? 10 : 1;
  if (e.altKey) {
    // Resize: Right/Down grow, Left/Up shrink. Both dimensions are derived
    // directly from the target — never via applyCropAspect, whose re-centring
    // refit collapses an already-refit draft (the 284×120 class of bug). When
    // growth hits an edge, the clamped dimension back-derives the other, so a
    // locked ratio survives the clamp.
    if (dir[0]) {
      let w = clamp(d.w + dir[0] * step, CROP_MIN, fvw - d.x);
      let h = S.cropAspect ? w / S.cropAspect : d.h;
      if (h > fvh - d.y) { h = fvh - d.y; w = S.cropAspect ? h * S.cropAspect : w; }
      d.w = w; d.h = h;
    } else {
      let h = clamp(d.h + dir[1] * step, CROP_MIN, fvh - d.y);
      let w = S.cropAspect ? h * S.cropAspect : d.w;
      if (w > fvw - d.x) { w = fvw - d.x; h = S.cropAspect ? w / S.cropAspect : h; }
      d.w = w; d.h = h;
    }
  } else {
    d.x = clamp(d.x + dir[0] * step, 0, fvw - d.w);
    d.y = clamp(d.y + dir[1] * step, 0, fvh - d.h);
  }
  if (customBase) customBase = { ...S.cropDraft };   // Custom refits from the moved box, not a stale snapshot
  requestRender();
}
// align-to-frame: position only, one-shot. w/h never move, so there is no
// ratio-lock interaction and none of the refit risk above.
function cropAlign(a) {
  const d = S.cropDraft, fvw = S.video.videoWidth, fvh = S.video.videoHeight;
  if (a === 'l') d.x = 0;
  else if (a === 'ch') d.x = (fvw - d.w) / 2;
  else if (a === 'r') d.x = fvw - d.w;
  else if (a === 't') d.y = 0;
  else if (a === 'cv') d.y = (fvh - d.h) / 2;
  else if (a === 'b') d.y = fvh - d.h;
  if (customBase) customBase = { ...S.cropDraft };
  requestRender();
}
document.querySelectorAll('#cropAlignH button, #cropAlignV button').forEach(b =>
  b.addEventListener('click', () => cropAlign(b.dataset.a)));
function loop() {
  if (S.playing && !S.exporting) {
    const t = S.video.currentTime;
    const cut = cutsNorm().find(c => t >= c.t0 && t < c.t1);
    if (t >= S.trimOut - 0.001) pause(), seekTo(S.trimIn);
    else if (cut) {
      if (cut.t1 >= S.trimOut - 0.01) { pause(); seekTo(S.trimIn); }
      else seekTo(cut.t1 + 0.001);
    }
    else { renderFrame(); drawTimeline(); syncWebcamSoft(); tickCheck(); }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function syncWebcamSoft() {
  for (const el of [S.webcam, S.micEl === S.webcam ? null : S.micEl]) {
    if (!el) continue;
    const want = S.video.currentTime - S.webcamOffset;
    if (want < 0 || want > el.duration) { if (!el.paused) el.pause(); continue; }
    if (el.paused) el.play().catch(() => {});
    if (Math.abs(el.currentTime - want) > 0.12) el.currentTime = want;
  }
}

// preview volumes/mutes follow the audio settings
function applyAudioPrefs() {
  if (!S.video) return;
  S.video.muted = !(S.sysFile && S.set.sysOn);
  S.video.volume = clamp(S.set.sysVol / 100, 0, 1);
  if (S.micEl) {
    S.micEl.muted = !(S.micFile && S.set.micOn);
    S.micEl.volume = clamp(S.set.micVol / 100, 0, 1);
  }
}

// synthesized click tick (48 kHz), used in preview and mixed into exports
function buildTick() {
  const rate = 48000, n = Math.floor(rate * 0.06);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.exp(-t * 90);
    a[i] = (Math.sin(2 * Math.PI * 1250 * t) * 0.6 +
            Math.sin(2 * Math.PI * 2400 * t) * 0.25 +
            (Math.random() * 2 - 1) * 0.15 * Math.exp(-t * 300)) * env * 0.5;
  }
  S.tickPCM = a;
}
let actx = null, prevTickT = 0;
function playTick() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = actx.createBuffer(1, S.tickPCM.length, 48000);
    buf.copyToChannel(S.tickPCM, 0);
    const src = actx.createBufferSource();
    src.buffer = buf; src.connect(actx.destination); src.start();
  } catch (e) {}
}
function tickCheck() {
  if (!S.set.clickSnd || !S.cursor || !S.tickPCM) { prevTickT = S.video.currentTime; return; }
  const t = S.video.currentTime;
  for (const c of S.cursor.clicks || []) {
    if (c.down && c.t > prevTickT && c.t <= t) { playTick(); break; }
  }
  prevTickT = t;
}

// ------------------------------------------------------------------ transport
function play() {
  if (!S.loaded || S.exporting) return;
  if (S.video.currentTime >= S.trimOut - 0.01) seekTo(S.trimIn);
  applyAudioPrefs();
  prevTickT = S.video.currentTime;
  S.playing = true;
  $('playBtn').classList.add('playing');
  $('playBtn').setAttribute('aria-pressed', 'true');
  $('playBtn').setAttribute('aria-label', 'Pause');
  S.video.play().catch(() => {});
  syncWebcamSoft();
}
function pause() {
  S.playing = false;
  $('playBtn').classList.remove('playing');
  $('playBtn').setAttribute('aria-pressed', 'false');
  $('playBtn').setAttribute('aria-label', 'Play');
  S.video.pause();
  if (S.webcam) S.webcam.pause();
  if (S.micEl && S.micEl !== S.webcam) S.micEl.pause();
}
function seekTo(t) {
  t = clamp(t, 0, S.duration);
  S.video.currentTime = t;
  prevTickT = t;
  for (const el of [S.webcam, S.micEl === S.webcam ? null : S.micEl]) {
    if (!el) continue;
    const w = t - S.webcamOffset;
    if (w >= 0 && w <= el.duration) el.currentTime = w;
  }
  const once = () => { renderFrame(); drawTimeline(); };
  S.video.readyState >= 2 ? requestAnimationFrame(once) : S.video.addEventListener('seeked', once, { once: true });
  setTimeout(once, 120); // belt & braces
}
$('playBtn').onclick = () => S.playing ? pause() : play();
// "The start" is the first frame that survives trim + cuts, not source 0:00 —
// one definition, shared by the Home/End keys and the transport buttons, so
// the button and the key can never drift apart.
function goToOutStart() { pause(); seekTo(out2src(0)); }
function goToOutEnd()   { pause(); seekTo(out2src(outDuration())); }
$('startBtn').onclick = goToOutStart;
function updateTimeUI() {
  const removed = S.duration - outDuration();
  $('time').textContent = `${fmtT(src2out(S.video.currentTime))} / ${fmtT(outDuration())}` +
    (removed > 0.05 ? ` (−${fmtT(removed)})` : '');
}

// ------------------------------------------------------------------ timeline
const tl = $('timeline');
const tctx = tl.getContext('2d');
function sizeTimeline() {
  const dpr = window.devicePixelRatio || 1;
  tl.width = tl.clientWidth * dpr; tl.height = 84 * dpr;
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawTimeline();
}
window.addEventListener('resize', () => { sizeTimeline(); });

const T2X = t => 10 + (tl.clientWidth - 20) * (t / Math.max(S.duration, 0.001));
const X2T = x => clamp((x - 10) / (tl.clientWidth - 20), 0, 1) * S.duration;

// lanes: ruler 0-12 · video track 14-32 · zooms 36-60 · clicks ~66
const VID_Y = 14, VID_H = 18, ZOOM_Y = 36, ZOOM_H = 24;

function drawTimeline() {
  const W = tl.clientWidth, H = 84;
  tctx.clearRect(0, 0, W, H);
  if (!S.loaded) {
    tctx.fillStyle = '#8b94a8'; tctx.font = '12px sans-serif';
    tctx.fillText('Open a recording to see the timeline.', 12, 46);
    return;
  }
  // trim shading
  tctx.fillStyle = 'rgba(0,0,0,0.42)';
  tctx.fillRect(0, 0, T2X(S.trimIn), H);
  tctx.fillRect(T2X(S.trimOut), 0, W - T2X(S.trimOut), H);

  // ruler
  tctx.strokeStyle = '#343b49'; tctx.fillStyle = '#8b94a8'; tctx.font = '10px sans-serif';
  const step = S.duration > 90 ? 15 : S.duration > 30 ? 5 : 1;
  for (let t = 0; t <= S.duration; t += step) {
    const x = T2X(t);
    tctx.beginPath(); tctx.moveTo(x, 2); tctx.lineTo(x, 8); tctx.stroke();
    if (t % (step * (S.duration > 30 ? 2 : 5)) < 0.01 || step >= 5) tctx.fillText(fmtT(t), x + 3, 10);
  }

  // ---- video track lane: pieces + cuts + splits
  const ps = pieces(), cuts = cutsNorm();
  ps.forEach((p, i) => {
    const x0 = T2X(p.t0), x1 = T2X(p.t1);
    roundRectPath(tctx, x0 + 0.5, VID_Y, Math.max(x1 - x0 - 1, 3), VID_H, 4);
    // the footage is the primary object: the lane reads at the same weight as
    // an unselected zoom segment (~3:1), never below it
    tctx.fillStyle = i === S.selPiece ? '#7683a8' : '#5c6789';
    tctx.fill();
    if (i === S.selPiece) { tctx.strokeStyle = '#fff'; tctx.lineWidth = 1.4; tctx.stroke(); }
  });
  cuts.forEach((c, i) => {
    const x0 = T2X(c.t0), x1 = T2X(c.t1);
    roundRectPath(tctx, x0 + 0.5, VID_Y, Math.max(x1 - x0 - 1, 3), VID_H, 4);
    tctx.fillStyle = i === S.selCut ? 'rgba(255,108,124,0.30)' : 'rgba(0,0,0,0.5)';
    tctx.fill();
    tctx.save(); tctx.clip();
    tctx.strokeStyle = i === S.selCut ? 'rgba(255,108,124,0.8)' : 'rgba(255,255,255,0.22)';
    tctx.lineWidth = 1;
    for (let x = x0 - VID_H; x < x1; x += 6) {
      tctx.beginPath(); tctx.moveTo(x, VID_Y + VID_H); tctx.lineTo(x + VID_H, VID_Y); tctx.stroke();
    }
    tctx.restore();
    if (i === S.selCut) { roundRectPath(tctx, x0 + 0.5, VID_Y, Math.max(x1 - x0 - 1, 3), VID_H, 4); tctx.strokeStyle = '#ff6c7c'; tctx.lineWidth = 1.4; tctx.stroke(); }
  });
  // split ticks
  tctx.strokeStyle = 'rgba(255,255,255,0.7)'; tctx.lineWidth = 1.5;
  for (const t of S.splits) {
    if (t <= S.trimIn || t >= S.trimOut) continue;
    const x = T2X(t);
    tctx.beginPath(); tctx.moveTo(x, VID_Y - 1); tctx.lineTo(x, VID_Y + VID_H + 1); tctx.stroke();
  }

  // ---- zoom lane
  S.segs.forEach((s, i) => {
    const x0 = T2X(s.t0), x1 = T2X(s.t1);
    const seld = i === S.selSeg;
    const g = tctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, seld ? '#4fd1c5' : '#2e8078');
    g.addColorStop(1, seld ? '#b06cff' : '#5a4fa8');
    roundRectPath(tctx, x0, ZOOM_Y, Math.max(x1 - x0, 4), ZOOM_H, 6);
    tctx.fillStyle = g; tctx.fill();
    if (seld) { tctx.strokeStyle = '#fff'; tctx.lineWidth = 1.5; tctx.stroke(); }
    tctx.fillStyle = 'rgba(255,255,255,0.9)'; tctx.font = 'bold 10px sans-serif';
    if (x1 - x0 > 26) tctx.fillText(s.z.toFixed(1) + '×', x0 + 6, ZOOM_Y + 15);
    tctx.fillStyle = 'rgba(255,255,255,0.55)';
    tctx.fillRect(x0 + 1.5, ZOOM_Y + 5, 2.5, ZOOM_H - 10); tctx.fillRect(x1 - 4, ZOOM_Y + 5, 2.5, ZOOM_H - 10);
  });

  // click markers
  if (S.cursor) {
    tctx.fillStyle = 'rgba(255,255,255,0.65)';
    for (const c of S.cursor.clicks || []) {
      if (!c.down) continue;
      tctx.beginPath(); tctx.arc(T2X(c.t), 67, 2.2, 0, 7); tctx.fill();
    }
  }

  // trim brackets — lit while a drag sits exactly on a snap target, and only
  // then: stateless, derived from equality rather than a flag someone forgets
  tctx.lineWidth = 2;
  for (const [t, dir, kind] of [[S.trimIn, 1, 'trimIn'], [S.trimOut, -1, 'trimOut']]) {
    const snapped = tlDrag && tlDrag.kind === kind &&
      (S.splits.includes(t) || t === S.video.currentTime);
    tctx.strokeStyle = snapped ? '#4fd1c5' : '#e8eaf0';
    const x = T2X(t);
    tctx.beginPath();
    tctx.moveTo(x + dir * 5, 13); tctx.lineTo(x, 13); tctx.lineTo(x, 80); tctx.lineTo(x + dir * 5, 80);
    tctx.stroke();
  }

  // playhead
  const px = T2X(S.video.currentTime);
  tctx.strokeStyle = '#ff6c7c'; tctx.lineWidth = 1.5;
  tctx.beginPath(); tctx.moveTo(px, 0); tctx.lineTo(px, H); tctx.stroke();
  tctx.fillStyle = '#ff6c7c';
  tctx.beginPath(); tctx.moveTo(px - 5, 0); tctx.lineTo(px + 5, 0); tctx.lineTo(px, 7); tctx.closePath(); tctx.fill();
}

// trim brackets snap to times the user chose deliberately — visible splits
// and the playhead — within 8 screen px (screen px, never time units, so the
// feel is the same at any timeline width). Alt bypasses. Snap first, clamp
// after: the 0.5s minimum span always wins.
function snapT(t, e) {
  if (e.altKey) return t;
  const cands = [S.video.currentTime,
    ...S.splits.filter(s => s > S.trimIn && s < S.trimOut)];
  let best = t, bd = 8;
  for (const c of cands) {
    const d = Math.abs(T2X(t) - T2X(c));
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// timeline interactions
let tlDrag = null;
tl.addEventListener('pointerdown', e => {
  if (!S.loaded || S.cropMode || S.exporting) return;   // a scrub mid-export injects wrong frames
  tl.setPointerCapture(e.pointerId);
  const x = e.offsetX, y = e.offsetY, t = X2T(x);
  // trim handles first
  if (Math.abs(x - T2X(S.trimIn)) < 7)  { pushUndo(); tlDrag = { kind: 'trimIn' }; return; }
  if (Math.abs(x - T2X(S.trimOut)) < 7) { pushUndo(); tlDrag = { kind: 'trimOut' }; return; }
  // zoom lane
  for (let i = S.segs.length - 1; i >= 0; i--) {
    const s = S.segs[i], x0 = T2X(s.t0), x1 = T2X(s.t1);
    if (y >= ZOOM_Y - 3 && y <= ZOOM_Y + ZOOM_H + 3 && x >= x0 - 5 && x <= x1 + 5) {
      S.selSeg = i; S.selPiece = -1; S.selCut = -1;
      updateZoomPanel();
      pushUndo();   // one snapshot per drag, not per move
      if (Math.abs(x - x0) < 7)      tlDrag = { kind: 'segL', i };
      else if (Math.abs(x - x1) < 7) tlDrag = { kind: 'segR', i };
      else                           tlDrag = { kind: 'segM', i, grab: t - s.t0 };
      drawTimeline(); requestRender();
      return;
    }
  }
  // video lane: select a cut (to restore) or a piece (to delete)
  if (y >= VID_Y - 2 && y <= VID_Y + VID_H + 2) {
    const ci = cutsNorm().findIndex(c => t >= c.t0 && t <= c.t1);
    if (ci >= 0) {
      S.selCut = ci; S.selPiece = -1; S.selSeg = -1;
      updateZoomPanel(); drawTimeline();
      // No toast here: the hint strip says "⌫ restore" at this exact moment
      // and keeps saying it for as long as the cut stays selected, where the
      // toast expired after 1.8s. One surface owns this.
      return;
    }
    const pi = pieces().findIndex(p => t >= p.t0 && t <= p.t1);
    if (pi >= 0) {
      S.selPiece = pi; S.selCut = -1; S.selSeg = -1;
      updateZoomPanel(); drawTimeline();
      return;
    }
  }
  S.selSeg = -1; S.selPiece = -1; S.selCut = -1;
  updateZoomPanel(); drawTimeline();
  tlDrag = { kind: 'scrub' };
  pause(); seekTo(t);
});
// hover affordances: honest cursors, no redraws (cheap)
function hoverCursor(e) {
  if (!S.loaded || S.cropMode) { tl.style.cursor = 'default'; return; }
  const x = e.offsetX, y = e.offsetY;
  if (Math.abs(x - T2X(S.trimIn)) < 7 || Math.abs(x - T2X(S.trimOut)) < 7) { tl.style.cursor = 'ew-resize'; return; }
  for (let i = S.segs.length - 1; i >= 0; i--) {
    const s = S.segs[i], x0 = T2X(s.t0), x1 = T2X(s.t1);
    if (y >= ZOOM_Y - 3 && y <= ZOOM_Y + ZOOM_H + 3 && x >= x0 - 5 && x <= x1 + 5) {
      tl.style.cursor = (Math.abs(x - x0) < 7 || Math.abs(x - x1) < 7) ? 'ew-resize' : 'grab';
      return;
    }
  }
  if (y >= VID_Y - 2 && y <= VID_Y + VID_H + 2) { tl.style.cursor = 'pointer'; return; }
  tl.style.cursor = 'default';
}
tl.addEventListener('pointermove', e => {
  if (!tlDrag) { hoverCursor(e); return; }
  const t = X2T(e.offsetX);
  const s = tlDrag.i != null ? S.segs[tlDrag.i] : null;
  switch (tlDrag.kind) {
    case 'scrub':  seekTo(t); break;
    case 'trimIn':  S.trimIn = clamp(snapT(t, e), 0, S.trimOut - 0.5); break;
    case 'trimOut': S.trimOut = clamp(snapT(t, e), S.trimIn + 0.5, S.duration); break;
    case 'segL': s.t0 = clamp(t, 0, s.t1 - 0.3); break;
    case 'segR': s.t1 = clamp(t, s.t0 + 0.3, S.duration); break;
    case 'segM': {
      const d = s.t1 - s.t0;
      s.t0 = clamp(t - tlDrag.grab, 0, S.duration - d); s.t1 = s.t0 + d;
      break;
    }
  }
  drawTimeline(); requestRender();
});
tl.addEventListener('pointerup', () => { tlDrag = null; });
tl.addEventListener('pointercancel', () => { tlDrag = null; });
tl.addEventListener('lostpointercapture', () => { tlDrag = null; });
tl.addEventListener('dblclick', e => {
  if (!S.loaded || S.cropMode) return;
  const t = X2T(e.offsetX);
  if (e.offsetY < ZOOM_Y - 3) return;   // double-click only adds zooms in the zoom lane area
  const hit = S.segs.some(s => t >= s.t0 && t <= s.t1);
  if (!hit) addZoomAt(t);
});

// preview: drag the zoom aim, or the crop rect in crop mode
let aimDrag = false, cropDrag = null, aimGrab = { gx: 0, gy: 0 };
function previewPos(e) {
  const rect = preview.getBoundingClientRect();
  return [(e.clientX - rect.left) / rect.width * preview.width,
          (e.clientY - rect.top) / rect.height * preview.height];
}
preview.addEventListener('pointerdown', e => {
  if (!S.loaded || S.exporting) return;   // a drag mid-export mutates the aim invisibly and dirties every frame after it
  if (S.cropMode) {
    preview.setPointerCapture(e.pointerId);
    const [mx, my] = previewPos(e);
    const { sc, ox, oy } = cropFit();
    const d = S.cropDraft;
    const dx = ox + d.x * sc, dy = oy + d.y * sc, dw = d.w * sc, dh = d.h * sc;
    const hs = cropHandles(dx, dy, dw, dh);
    for (let i = 0; i < hs.length; i++) {
      if (Math.hypot(mx - hs[i][0], my - hs[i][1]) < 12) {
        cropDrag = { kind: 'handle', i, start: { ...d } };
        return;
      }
    }
    if (mx >= dx && mx <= dx + dw && my >= dy && my <= dy + dh) {
      cropDrag = { kind: 'move', gx: (mx - dx) / sc, gy: (my - dy) / sc };
      return;
    }
    return;
  }
  if (S.selSeg < 0) return;
  preview.setPointerCapture(e.pointerId);
  pushUndo();   // aiming a zoom is an edit — one snapshot per drag
  aimDrag = true;
  // relative grab, no teleport: the press records an offset from the aim and
  // moves it by deltas (the cropDrag gx/gy pattern). With the camera overridden
  // to the full frame, every target is reachable in one gesture and the
  // pointer-to-source mapping stays constant for the whole drag.
  aimOverride = true;
  const s = S.segs[S.selSeg];
  const [px, py] = aimSrcPoint(e);
  aimGrab = { gx: px - s.x, gy: py - s.y };
  requestRender();
});
const endPreviewDrag = () => {
  aimDrag = false; cropDrag = null;
  if (aimOverride) { aimOverride = false; requestRender(); }   // back to the live camera
};
preview.addEventListener('pointercancel', endPreviewDrag);
preview.addEventListener('lostpointercapture', endPreviewDrag);
preview.addEventListener('pointermove', e => {
  if (aimDrag) { movAim(e); return; }
  if (!cropDrag || !S.cropMode) return;
  const [mx, my] = previewPos(e);
  const { sc, ox, oy } = cropFit();
  const fvw = S.video.videoWidth, fvh = S.video.videoHeight;
  const vx = clamp((mx - ox) / sc, 0, fvw), vy = clamp((my - oy) / sc, 0, fvh);
  const d = S.cropDraft, MIN = CROP_MIN;
  if (cropDrag.kind === 'move') {
    d.x = clamp(vx - cropDrag.gx, 0, fvw - d.w);
    d.y = clamp(vy - cropDrag.gy, 0, fvh - d.h);
  } else {
    // handles: 0 tl, 1 t, 2 tr, 3 r, 4 br, 5 b, 6 bl, 7 l
    const i = cropDrag.i;
    let x0 = d.x, y0 = d.y, x1 = d.x + d.w, y1 = d.y + d.h;
    if ([0, 6, 7].includes(i)) x0 = clamp(vx, 0, x1 - MIN);
    if ([2, 3, 4].includes(i)) x1 = clamp(vx, x0 + MIN, fvw);
    if ([0, 1, 2].includes(i)) y0 = clamp(vy, 0, y1 - MIN);
    if ([4, 5, 6].includes(i)) y1 = clamp(vy, y0 + MIN, fvh);
    if (S.cropAspect) {
      // keep the ratio: width wins on corners/sides, height follows
      let w = x1 - x0, h = w / S.cropAspect;
      if ([1, 5].includes(i)) { h = y1 - y0; w = h * S.cropAspect; }   // top/bottom: height wins
      if ([0, 1, 2].includes(i)) y0 = y1 - h; else y1 = y0 + h;
      if ([0, 6, 7].includes(i)) x0 = x1 - w; else x1 = x0 + w;
      // keep inside frame
      if (y0 < 0) { y0 = 0; const hh = y1 - y0, ww = hh * S.cropAspect; if ([0, 6, 7].includes(i)) x0 = x1 - ww; else x1 = x0 + ww; }
      if (y1 > fvh) { y1 = fvh; const hh = y1 - y0, ww = hh * S.cropAspect; if ([0, 6, 7].includes(i)) x0 = x1 - ww; else x1 = x0 + ww; }
      x0 = clamp(x0, 0, fvw); x1 = clamp(x1, 0, fvw);
    }
    d.x = x0; d.y = y0; d.w = x1 - x0; d.h = y1 - y0;
  }
  requestRender();
});
preview.addEventListener('pointerup', endPreviewDrag);
// pointer → source px, inverted through the CURRENT camera (constant during a
// drag, because the override above pins it to the full-frame fit)
function aimSrcPoint(e) {
  const rect = preview.getBoundingClientRect();
  const W = preview.width, H = preview.height;
  const mx = (e.clientX - rect.left) / rect.width * W;
  const my = (e.clientY - rect.top) / rect.height * H;
  const cr = cropRect();
  const vw = cr.w, vh = cr.h;
  const pad = S.set.pad / 100 * Math.min(W, H);
  const scale = Math.min((W - pad * 2) / vw, (H - pad * 2) / vh);
  const rw = vw * scale, rh = vh * scale, rx = (W - rw) / 2, ry = (H - rh) / 2;
  const cam = cameraAt(S.video.currentTime);
  const sw = vw / cam.z, sh = vh / cam.z, sx = cam.cx - sw / 2, sy = cam.cy - sh / 2;
  return [sx + (mx - rx) / rw * sw, sy + (my - ry) / rh * sh];
}
function movAim(e) {
  const s = S.segs[S.selSeg]; if (!s) return;
  const cr = cropRect();
  const [px, py] = aimSrcPoint(e);
  s.x = clamp(px - aimGrab.gx, cr.x, cr.x + cr.w);
  s.y = clamp(py - aimGrab.gy, cr.y, cr.y + cr.h);
  requestRender();
}

// keyboard
window.addEventListener('keydown', e => {
  if (!S.loaded || S.exporting) return;
  const mod = e.metaKey || e.ctrlKey;
  // undo/redo work even when a control has focus (post-click focus lands on inputs)
  if (mod && e.code === 'KeyZ') {
    e.preventDefault();
    if (S.cropMode) return;
    e.shiftKey ? redo() : undo();
    return;
  }
  if (S.cropMode) { cropKey(e); return; }
  // Escape before the input guard: the popover holds nothing BUT selects, so a
  // keyboard user who opened it could never dismiss it.
  if (e.key === 'Escape') {
    $('shortcuts').classList.remove('open');
    if ($('exportPop').classList.contains('open')) { closePopover(); $('exportChip').focus(); }
    return;
  }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (mod || e.altKey) return;   // never hijack ⌘S / ⌘R / friends
  if (e.code === 'Space') { e.preventDefault(); S.playing ? pause() : play(); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { deleteSelection(); }
  else if (e.code === 'KeyS') { splitAtPlayhead(); }
  else if (e.key === '?') { toggleShortcuts(); }
  else if (e.key === 'ArrowLeft')  { pause(); seekTo(S.video.currentTime - (e.shiftKey ? 1 : 1/30)); }
  else if (e.key === 'ArrowRight') { pause(); seekTo(S.video.currentTime + (e.shiftKey ? 1 : 1/30)); }
  // Home/End land on the edges of the OUTPUT, not the source. The timeline
  // draws the whole source with the trimmed ends shaded, but the thing being
  // made is what survives trim + cuts — which is why the readout above already
  // counts in output time. out2src(0) is the first surviving frame, so a trim
  // in at 0:05 with a cut running 0:05→0:08 sends Home to 0:08, not either
  // number. preventDefault because both keys otherwise scroll the sidebar.
  // Seeking is not an edit: no pushUndo (rule 7 — editSnapshot holds no playhead).
  else if (e.key === 'Home') { e.preventDefault(); goToOutStart(); }
  else if (e.key === 'End')  { e.preventDefault(); goToOutEnd(); }
});
$('splitBtn').onclick = splitAtPlayhead;
function toggleShortcuts() { $('shortcuts').classList.toggle('open'); }
// The sheet needs a mouse route in. Typing "?" is Shift+/ on a real keyboard,
// so a bare "?" key cap in the hint strip was teaching a chord it didn't name
// — and reading as a button while doing nothing on click. The button is the
// affordance now; the sheet still lists the key for anyone who wants it.
$('helpBtn').onclick = toggleShortcuts;

// ------------------------------------------------------------------ controls
function bindRange(id, key, fmt, after) {
  const el = $(id), lab = $(id + 'V');
  const upd = () => {
    S.set[key] = parseFloat(el.value);
    if (lab) lab.textContent = fmt(S.set[key]);
    setFill(el);
    if (after) after();
    requestRender();
  };
  el.addEventListener('input', upd); upd();
}
bindRange('pad', 'pad', v => v + '%');
bindRange('radius', 'radius', v => v + '');
bindRange('shadow', 'shadow', v => v + '');
bindRange('curSize', 'curSize', v => v.toFixed(1) + '×');
bindRange('curSmooth', 'curSmooth', v => v + '', () => { if (S.loaded) buildTrack(); });
bindRange('camSize', 'camSize', v => v + '%');
// zoom timing — re-run auto-zoom live (manual zooms are preserved)
let regenT = null, syncing = false;   // syncing: restoring a project must never regenerate autos
function regenAuto() {
  if (syncing) return;                // slider events fired by syncUIFromSettings are not user edits
  clearTimeout(regenT);
  regenT = setTimeout(() => {
    // only regenerate zooms the user explicitly asked for (Auto pressed) —
    // never conjure them from a timing tweak alone
    if (S.loaded && S.cursor && (S.cursor.clicks || []).length && S.segs.some(s => s.auto)) autoZoomFromClicks(true);
  }, 200);
}
bindRange('zLead', 'zoomLead', v => v.toFixed(2) + 's', regenAuto);
bindRange('zHold', 'zoomHold', v => v.toFixed(1) + 's', regenAuto);
bindRange('zTrans', 'zoomTrans', v => v.toFixed(2) + 's');
$('zLevel').addEventListener('pointerdown', pushUndo);   // coalesce: one snapshot per slider grab
$('zLevel').addEventListener('input', () => {
  const s = S.segs[S.selSeg]; if (!s) return;
  s.z = parseFloat($('zLevel').value);
  $('zLevelV').textContent = s.z.toFixed(1) + '×';
  setFill($('zLevel'));
  drawTimeline(); requestRender();
});
$('ripples').addEventListener('change', e => { S.set.ripples = e.target.checked; requestRender(); });
$('camShow').addEventListener('change', e => { S.set.camShow = e.target.checked; requestRender(); });
$('mblur').addEventListener('change', e => { S.set.mblur = e.target.checked; requestRender(); });
$('keysOn').addEventListener('change', e => { S.set.keysOn = e.target.checked; requestRender(); });
$('hideIdle').addEventListener('change', e => {
  S.set.hideIdle = e.target.checked;
  $('idleRow').style.display = e.target.checked ? '' : 'none';
  requestRender();
});
bindRange('idleAfter', 'idleAfter', v => v + 's');
$('clickSnd').addEventListener('change', e => { S.set.clickSnd = e.target.checked; updateSizeEst(); });
$('micOn').addEventListener('change', e => { S.set.micOn = e.target.checked; applyAudioPrefs(); updateSizeEst(); });
$('sysOn').addEventListener('change', e => { S.set.sysOn = e.target.checked; applyAudioPrefs(); updateSizeEst(); });
bindRange('micVol', 'micVol', v => v + '%', applyAudioPrefs);
bindRange('sysVol', 'sysVol', v => v + '%', applyAudioPrefs);
// custom background image (kept in memory only — not persisted)
$('bgImgBtn').onclick = () => $('bgImgInput').click();
$('bgImgInput').onchange = e => {
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(img.src);   // decoded bitmap survives; the URL would leak per pick
    S.bgImg = img; S.set.bg = -1;
    document.querySelectorAll('#bgSwatches .swatch').forEach(x => x.classList.remove('sel'));
    $('bgImgHint').style.display = '';
    requestRender();
  };
  img.src = URL.createObjectURL(f);
};
function bindSeg(id, key, after) {
  const box = $(id);
  box.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    box.querySelectorAll('button').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    S.set[key] = b.dataset.v;
    if (after) after();
    requestRender();
  }));
}
function updateSpotUI() {
  const show = S.set.cursorStyle === 'ring' ? '' : 'none';
  $('spotUI').style.display = show;
  $('spotColors').style.display = show;
}
bindSeg('cursorStyle', 'cursorStyle', updateSpotUI);
bindSeg('camPos', 'camPos');
bindSeg('camShape', 'camShape');
// spotlight tint + glow
$('spotColors').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  $('spotColors').querySelectorAll('button').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel');
  S.set.spotColor = b.dataset.v;
  requestRender();
}));
bindRange('spotOp', 'spotOpacity', v => v + '%');
$('autoZoom').onclick = () => {
  if (!S.cursor || !(S.cursor.clicks || []).length) { toast('No click data in this recording — add zooms manually instead.'); return; }
  autoZoomFromClicks();
};
$('addZoom').onclick = () => { if (S.loaded) addZoomAt(S.video.currentTime); };
$('delZoom').onclick = () => { if (S.selSeg >= 0) deleteSelection(); };   // one path, one pushUndo

// sync every control to S.set (used after restoring a saved project)
function syncUIFromSettings() {
  syncing = true;
  const ranges = {
    pad: 'pad', radius: 'radius', shadow: 'shadow', curSize: 'curSize',
    curSmooth: 'curSmooth', camSize: 'camSize', micVol: 'micVol', sysVol: 'sysVol',
    zLead: 'zoomLead', zHold: 'zoomHold', zTrans: 'zoomTrans', spotOp: 'spotOpacity',
    idleAfter: 'idleAfter'
  };
  for (const [id, key] of Object.entries(ranges)) {
    const el = $(id);
    el.value = S.set[key];
    el.dispatchEvent(new Event('input'));   // updates label + reruns side effects
  }
  for (const id of ['ripples', 'camShow', 'micOn', 'sysOn', 'clickSnd', 'mblur', 'keysOn', 'hideIdle']) {
    $(id).checked = !!S.set[id];
  }
  $('idleRow').style.display = S.set.hideIdle ? '' : 'none';
  $('exportQ').value = S.set.quality;
  updateSpotUI();
  $('spotColors').querySelectorAll('button').forEach(b =>
    b.classList.toggle('sel', b.dataset.v === S.set.spotColor));
  $('cropInfo').style.display = S.set.crop ? '' : 'none';
  if (S.set.crop) $('cropInfo').textContent = `Cropped to ${S.set.crop.w}×${S.set.crop.h} — Crop… to change.`;
  applyAudioPrefs();
  for (const [id, key] of [['cursorStyle', 'cursorStyle'], ['camPos', 'camPos'], ['camShape', 'camShape']]) {
    $(id).querySelectorAll('button').forEach(b =>
      b.classList.toggle('sel', b.dataset.v === S.set[key]));
  }
  document.querySelectorAll('#bgSwatches .swatch').forEach((el, i) =>
    el.classList.toggle('sel', i === S.set.bg));
  updateZoomPanel(); drawTimeline(); requestRender();
  syncing = false;
}

// ---- autosave (per recording, in this browser) + export size estimate
let lastSaved = '';
const QUALITY = { web: 0.055, std: 0.12, high: 0.2 };   // bits per pixel per frame

function exportDims() {
  const cr = cropRect();
  const resSel = $('exportRes').value;
  let H = resSel === 'native' ? cr.h : parseInt(resSel, 10);
  H = Math.min(H, cr.h * 2);
  let W = Math.round(H * cr.w / cr.h);
  return [W - W % 2, H - H % 2];
}
function exportBitrate(W, H, fps) {
  return clamp(Math.round(W * H * fps * QUALITY[S.set.quality]), 1_000_000, 60_000_000);
}
function updateSizeEst() {
  const fmt = $('exportFmt').value;
  $('exportBtn').textContent = 'Export ' + fmt.toUpperCase();
  if (!S.loaded) { $('sizeEst').textContent = 'MP4 · 1080p'; $('popEst').textContent = ''; return; }
  const fps = parseInt($('exportFps').value, 10);
  if (fmt === 'gif') {
    $('sizeEst').textContent = `GIF · ≤960px · ${Math.min(15, fps)} fps`;
    $('popEst').textContent = 'GIF size varies with content';
    return;
  }
  const [W, H] = exportDims();
  const dur = outDuration();
  const hasAudio = (S.set.micOn && S.micFile) || (S.set.sysOn && S.sysFile) || S.set.clickSnd;
  const bytes = (exportBitrate(W, H, fps) + (hasAudio ? 128000 : 0)) / 8 * dur;
  const size = bytes > 1e9 ? (bytes / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(bytes / 1e6)) + ' MB';
  const resSel = $('exportRes').value;
  $('sizeEst').textContent = `MP4 · ${resSel === 'native' ? H + 'p' : resSel + 'p'} · ${fps} · ≈${size}`;
  $('popEst').textContent = `${W}×${H} · estimated ≈ ${size}`;
}
// export settings popover (the one Glasshouse moment)
// inert tracks .open: a popover hidden by opacity is still tabbable without it
function setPopover(open) {
  $('exportPop').classList.toggle('open', open);
  $('exportPop').inert = !open;
  $('exportChip').setAttribute('aria-expanded', open ? 'true' : 'false');
}
function closePopover() { setPopover(false); }
$('exportChip').addEventListener('click', e => {
  e.stopPropagation();
  setPopover(!$('exportPop').classList.contains('open'));
});
$('exportPop').addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', () => closePopover());
$('shortcuts').addEventListener('click', e => { if (e.target === $('shortcuts')) $('shortcuts').classList.remove('open'); });
$('exportQ').addEventListener('change', e => { S.set.quality = e.target.value; updateSizeEst(); });
$('exportRes').addEventListener('change', updateSizeEst);
$('exportFps').addEventListener('change', updateSizeEst);
$('exportFmt').addEventListener('change', updateSizeEst);

setInterval(() => {
  if (!S.loaded || !S.fileKey) return;
  updateSizeEst();
  try {
    const data = serializeEdits();
    if (data !== lastSaved) { localStorage.setItem('retake:' + S.fileKey, data); lastSaved = data; }
  } catch (e) {}
}, 1500);

// ---- default look: style travels, geometry doesn't.
// A strict ALLOWLIST, never S.set minus a denylist — a denylist re-creates
// the crop-leak exposure the moment anyone adds a key. Settings about YOU
// travel; settings about THIS recording never do: crop, aspect, zooms, cuts,
// trim, volumes, webcam placement and the per-take toggles (camShow, camPos,
// camShape, camSize, micOn, sysOn, keysOn) are out by construction.
const LOOK_KEYS = ['bg', 'pad', 'radius', 'shadow', 'cursorStyle', 'curSize', 'curSmooth',
  'ripples', 'clickSnd', 'mblur', 'hideIdle', 'idleAfter', 'spotColor', 'spotOpacity',
  'zoomLead', 'zoomHold', 'zoomTrans', 'quality'];
// History plumbing. savedAt lives ONLY inside retake:lookHistory entries —
// it never enters retake:defaultLook, and every comparison strips it first,
// or "saved the same look twice" reads as two different looks.
const lookEq = (a, b) => {
  const strip = ({ savedAt, ...rest }) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
};
// One shared mover for save, rescue and promote. Filters ALL matches, never
// just the head: dedup-against-head-only turns [A,B,C] + promote-B into
// [B,A,B] with C evicted.
function pushLook(history, entry) {
  const out = history.filter(h => !lookEq(h, entry));
  out.unshift(entry);
  return out.slice(0, 3);
}
function readLookHistory() {
  try {
    const h = JSON.parse(localStorage.getItem('retake:lookHistory'));
    return Array.isArray(h) ? h : [];
  } catch (e) { return []; }   // corrupt storage renders as empty, never throws
}
function saveDefaultLook() {
  if (!S.loaded) return;
  const look = { v: 1 };
  for (const k of LOOK_KEYS) look[k] = S.set[k];
  if (look.bg === -1) look.bg = 0;   // background images aren't persisted
  // export format/res/fps are DOM-only by design (putting them in S.set would
  // silently make them per-recording); they live in the look blob alone
  look.fmt = $('exportFmt').value; look.res = $('exportRes').value; look.fps = $('exportFps').value;
  // History maintenance happens HERE and in promoteLook only — never at load:
  // rule 9 says opening writes nothing, and autosave-restore.test.mjs assumes
  // the recording autosave is the only retake: key alive during that test.
  let hist = readLookHistory();
  if (!hist.length) {
    // rescue the incumbent: a pre-history default must not vanish silently
    // (no savedAt on it — its row renders without a time segment)
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem('retake:defaultLook')); } catch (e) {}
    if (prev && !lookEq(prev, look)) hist = pushLook(hist, prev);
  }
  hist = pushLook(hist, { ...look, savedAt: Date.now() });
  try {
    localStorage.setItem('retake:defaultLook', JSON.stringify(look));
    localStorage.setItem('retake:lookHistory', JSON.stringify(hist));
  } catch (e) { return; }
  renderLookHistory();
  toast('This look is now the default for new recordings.', 2600, 'ok');
}
// shared apply path: the default at load and a promoted history row both land
// here, so the dim→Halo normalisation covers stored and rescued blobs alike
// (the load-time migration only ever guarded per-recording autosaves)
function applyLookBlob(look) {
  if (look.cursorStyle === 'dim') look.cursorStyle = 'ring';
  for (const k of LOOK_KEYS) if (k in look) S.set[k] = look[k];
  if (look.fmt) $('exportFmt').value = look.fmt;
  if (look.res) $('exportRes').value = look.res;
  if (look.fps) $('exportFps').value = look.fps;
  syncUIFromSettings();
  updateSizeEst();
}
function applyDefaultLook() {
  let look = null;
  try { look = JSON.parse(localStorage.getItem('retake:defaultLook')); } catch (e) {}
  if (!look) return;
  applyLookBlob(look);
}
// Promoting mutates only style keys, which editSnapshot deliberately excludes
// (rule 7 covers timeline/crop edits; style has never been undoable anywhere)
// — no pushUndo here: it would burn a no-op ⌘Z and force a flushSave.
function promoteLook(i) {
  if (!S.loaded) return;   // pre-load rows are silent no-ops, like #saveLook
  const entry = readLookHistory()[i];
  if (!entry) return;
  const { savedAt, ...blob } = entry;   // savedAt never enters retake:defaultLook
  // The list is a RECORD, so promoting must not reorder it: order means when
  // it was saved, the marker means which one is current. A history that
  // shuffles when read stops being a history — MRU-on-click is the classic
  // adaptive-menus failure (positions never stabilise, spatial memory dies).
  // Only saveDefaultLook writes retake:lookHistory; a save is a new event
  // in the timeline, so its unshift is legitimate.
  try { localStorage.setItem('retake:defaultLook', JSON.stringify(blob)); } catch (e) { return; }
  applyLookBlob(blob);
  renderLookHistory();
  toast(`«${(BGS[blob.bg] || BGS[0]).n} · ${CURSOR_NAMES[blob.cursorStyle] || blob.cursorStyle}» is your default again — applied to this recording.`, 3200, 'ok');
}
const CURSOR_NAMES = { arrow: 'Arrow', dot: 'Dot', ring: 'Halo', none: 'Hidden' };
function lookLabel(look) {
  const bits = [(BGS[look.bg] || BGS[0]).n, CURSOR_NAMES[look.cursorStyle] || look.cursorStyle];
  if (look.savedAt) {   // the rescued incumbent has no savedAt: no time segment
    const d = new Date(look.savedAt), now = new Date();
    bits.push(d.toDateString() === now.toDateString()
      ? d.toTimeString().slice(0, 5)
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }));
  }
  return bits.join(' · ');
}
function renderLookHistory() {
  const box = $('lookHistory');
  const hist = readLookHistory();
  let cur = null;
  try { cur = JSON.parse(localStorage.getItem('retake:defaultLook')); } catch (e) {}
  box.style.display = hist.length ? '' : 'none';
  box.innerHTML = '';
  hist.forEach((look, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'look-row';
    if (cur && lookEq(look, cur)) { b.classList.add('current'); b.dataset.tip = 'Your current default'; }
    const chip = document.createElement('span');
    chip.className = 'look-chip';
    chip.style.background = `linear-gradient(135deg, ${(BGS[look.bg] || BGS[0]).s.join(',')})`;
    b.appendChild(chip);
    b.appendChild(document.createTextNode(lookLabel(look)));
    b.onclick = () => promoteLook(i);
    box.appendChild(b);
  });
}
$('saveLook').onclick = saveDefaultLook;

// background swatches (real buttons: focusable and named for screen readers)
(function () {
  const box = $('bgSwatches');
  BGS.forEach((bg, i) => {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'swatch' + (i === S.set.bg ? ' sel' : '');
    d.dataset.tip = bg.n;
    d.setAttribute('aria-label', bg.n + ' background');
    d.style.background = `linear-gradient(135deg, ${bg.s.join(',')})`;
    d.onclick = () => {
      box.querySelectorAll('.swatch').forEach(x => x.classList.remove('sel'));
      d.classList.add('sel');
      S.set.bg = i; requestRender();
    };
    box.appendChild(d);
  });
})();

// ------------------------------------------------------------------ export
let cancelExport = false;
$('cancelExport').onclick = () => { cancelExport = true; };

async function seekBoth(t) {
  const waits = [];
  const seekOne = (v, tt) => new Promise(res => {
    if (Math.abs(v.currentTime - tt) < 0.0005 && v.readyState >= 2) return res();
    let done = false;
    const fin = () => { if (!done) { done = true; v.removeEventListener('seeked', fin); res(); } };
    v.addEventListener('seeked', fin);
    v.currentTime = tt;
    setTimeout(fin, 800);
  });
  waits.push(seekOne(S.video, t));
  if (S.webcam && S.set.camShow) {
    const w = clamp(t - S.webcamOffset, 0, Math.max(0, S.webcam.duration - 0.01));
    waits.push(seekOne(S.webcam, w));
  }
  await Promise.all(waits);
}

const A_RATE = 48000;
async function decodeSrc(file) {
  if (!file) return null;
  try {
    const ac = new AudioContext({ sampleRate: A_RATE });   // forces resample to 48k
    const audio = await ac.decodeAudioData(await file.arrayBuffer());
    ac.close();
    return audio;
  } catch (e) {
    console.warn('audio decode failed', e);
    return null;
  }
}

$('exportBtn').onclick = async () => {
  if (!S.loaded || S.exporting) return;
  pause();
  if ($('exportFmt').value === 'gif') { await exportGif(); return; }
  const fps = parseInt($('exportFps').value, 10);
  const [W, H] = exportDims();

  if (typeof VideoEncoder === 'undefined') {
    toast('This browser has no WebCodecs — please use Chrome, Edge or Arc.');
    return;
  }

  // pick a supported codec config (H.264 preferred, VP9 fallback)
  const candidates = [
    ['avc1.640033', 'avc'], ['avc1.4d0033', 'avc'], ['avc1.42e01e', 'avc'],
    ['vp09.00.10.08', 'vp9']
  ];
  let codec = null, muxCodec = null;
  for (const [c, mc] of candidates) {
    try {
      const ok = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H });
      if (ok.supported) { codec = c; muxCodec = mc; break; }
    } catch (e) {}
  }
  if (!codec) { toast(`No video encoder available for ${W}×${H} — try a lower resolution.`); return; }

  S.exporting = true; cancelExport = false;
  $('exportProgress').style.display = 'flex';
  $('exportBtn').disabled = true;

  const outDur = outDuration();
  const total = Math.max(1, Math.floor(outDur * fps));

  // audio first (so we know whether to add the track)
  $('exportLabel').textContent = 'Preparing audio…';
  $('exportProgress').style.display = 'flex';
  const sources = [];
  if (S.set.micOn && S.micFile) {
    const b = await decodeSrc(S.micFile);
    if (b) sources.push({ b, off: S.webcamOffset, g: S.set.micVol / 100 });
  }
  if (S.set.sysOn && S.sysFile) {
    const b = await decodeSrc(S.sysFile);
    if (b) sources.push({ b, off: 0, g: S.set.sysVol / 100 });
  }
  const clicksDown = (S.set.clickSnd && S.cursor && S.tickPCM)
    ? (S.cursor.clicks || []).filter(c => c.down) : [];
  const wantAudio = sources.length > 0 || clicksDown.length > 0;
  let aCodec = null, aMux = null;
  const aCh = 2, aRate = A_RATE;
  if (wantAudio && typeof AudioEncoder !== 'undefined') {
    for (const [c, mc] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
      try {
        const ok = await AudioEncoder.isConfigSupported({ codec: c, sampleRate: aRate, numberOfChannels: aCh, bitrate: 128000 });
        if (ok.supported) { aCodec = c; aMux = mc; break; }
      } catch (e) {}
    }
  }

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: muxCodec, width: W, height: H },
    ...(aCodec ? { audio: { codec: aMux, sampleRate: aRate, numberOfChannels: aCh } } : {}),
    fastStart: 'in-memory'
  });

  let encodeError = null, aenc = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { encodeError = e; }
  });
  venc.configure({
    codec, width: W, height: H,
    bitrate: exportBitrate(W, H, fps),
    framerate: fps
  });

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  const startWall = performance.now();
  let done = 0;
  try {
    for (let i = 0; i < total; i++) {
      if (cancelExport) throw new Error('cancelled');
      if (encodeError) throw encodeError;
      const t = out2src(i / fps);
      await seekBoth(t);
      draw(ctx, W, H, t, { export: true });
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      venc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (venc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 4));
      done = i + 1;
      if (i % 3 === 0 || i === total - 1) {
        const pct = done / total;
        const eta = (performance.now() - startWall) / done * (total - done) / 1000;
        $('exportBar').style.width = (pct * 100).toFixed(1) + '%';
        $('exportLabel').textContent = `Rendering ${(pct * 100) | 0}% · ~${Math.ceil(eta)}s left`;
        await new Promise(r => setTimeout(r, 0));
      }
    }
    await venc.flush();

    // audio
    if (aCodec) {
      $('exportLabel').textContent = 'Encoding audio…';
      await new Promise(r => setTimeout(r, 0));
      aenc = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: e => console.warn('audio enc', e)
      });
      aenc.configure({ codec: aCodec, sampleRate: aRate, numberOfChannels: aCh, bitrate: 128000 });
      const CH = 4096;
      const totalSamples = Math.round(outDur * aRate);
      const data = new Float32Array(CH * aCh);
      const tick = S.tickPCM;
      const keeps = keepIntervals();
      const audibleClicks = clicksDown.filter(c => keeps.some(k => c.t >= k.a && c.t <= k.b));
      for (let s0 = 0; s0 < totalSamples; s0 += CH) {
        if (cancelExport) throw new Error('cancelled');
        const n = Math.min(CH, totalSamples - s0);
        data.fill(0);
        // mix every enabled source (mapping output time → source time across cuts)
        for (let ch = 0; ch < aCh; ch++) {
          for (let k = 0; k < n; k++) {
            const vidT = out2src((s0 + k) / aRate);
            let v = 0;
            for (const src of sources) {
              const chan = src.b.getChannelData(Math.min(ch, src.b.numberOfChannels - 1));
              const idx = Math.round((vidT - src.off) * src.b.sampleRate);
              if (idx >= 0 && idx < chan.length) v += chan[idx] * src.g;
            }
            data[ch * n + k] = v;
          }
        }
        // click ticks (placed at output-time positions)
        for (const c of audibleClicks) {
          const start = Math.round(src2out(c.t) * aRate);
          if (start + tick.length < s0 || start > s0 + n) continue;
          for (let k = 0; k < n; k++) {
            const ti = s0 + k - start;
            if (ti >= 0 && ti < tick.length) {
              for (let ch = 0; ch < aCh; ch++) data[ch * n + k] += tick[ti] * 0.8;
            }
          }
        }
        // soft clamp
        for (let i = 0; i < n * aCh; i++) {
          const v = data[i];
          data[i] = v > 1 ? 1 : v < -1 ? -1 : v;
        }
        const ad = new AudioData({
          format: 'f32-planar', sampleRate: aRate, numberOfFrames: n, numberOfChannels: aCh,
          timestamp: Math.round(s0 / aRate * 1e6), data: data.subarray(0, n * aCh)
        });
        aenc.encode(ad); ad.close();
        while (aenc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 4));
      }
      await aenc.flush();
    } else if (wantAudio) {
      toast('Audio encoding not available in this browser — exported without audio.');
    }

    muxer.finalize();
    const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `retake-${W}x${H}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast(`Exported ${W}×${H} MP4 (${(blob.size / 1e6).toFixed(1)} MB).`, 3200, 'ok');
  } catch (e) {
    if (e.message !== 'cancelled') { console.error(e); toast('Export failed: ' + e.message, 4000, 'warn'); }
    else toast('Export cancelled.');
  } finally {
    try { venc.close(); } catch (e) {}
    try { if (aenc) aenc.close(); } catch (e) {}
    S.exporting = false;
    $('exportProgress').style.display = 'none';
    $('exportBtn').disabled = false;
    $('exportBar').style.width = '0%';
    seekTo(clamp(S.video.currentTime, S.trimIn, S.trimOut));
  }
};

// ------------------------------------------------------------------ GIF export
async function exportGif() {
  if (typeof gifenc === 'undefined') { toast('GIF encoder failed to load.'); return; }
  const cr = cropRect();
  const fps = Math.min(15, parseInt($('exportFps').value, 10));
  const W = Math.min(960, cr.w);
  const H = Math.round(W * cr.h / cr.w);
  S.exporting = true; cancelExport = false;
  $('exportProgress').style.display = 'flex';
  $('exportBtn').disabled = true;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const gif = gifenc.GIFEncoder();
  const total = Math.max(1, Math.floor(outDuration() * fps));
  const startWall = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (cancelExport) throw new Error('cancelled');
      const t = out2src(i / fps);
      await seekBoth(t);
      draw(ctx, W, H, t, { export: true });
      const { data } = ctx.getImageData(0, 0, W, H);
      const palette = gifenc.quantize(data, 256);
      const index = gifenc.applyPalette(data, palette);
      gif.writeFrame(index, W, H, { palette, delay: Math.round(1000 / fps) });
      if (i % 3 === 0 || i === total - 1) {
        const pct = (i + 1) / total;
        const eta = (performance.now() - startWall) / (i + 1) * (total - i - 1) / 1000;
        $('exportBar').style.width = (pct * 100).toFixed(1) + '%';
        $('exportLabel').textContent = `GIF ${(pct * 100) | 0}% · ~${Math.ceil(eta)}s left`;
        await new Promise(r => setTimeout(r, 0));
      }
    }
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `retake-${W}x${H}.gif`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast(`Exported GIF (${(blob.size / 1e6).toFixed(1)} MB @ ${fps} fps).`, 3200, 'ok');
  } catch (e) {
    if (e.message !== 'cancelled') { console.error(e); toast('GIF export failed: ' + e.message, 4000, 'warn'); }
    else toast('Export cancelled.');
  } finally {
    S.exporting = false;
    $('exportProgress').style.display = 'none';
    $('exportBtn').disabled = false;
    $('exportBar').style.width = '0%';
    seekTo(clamp(S.video.currentTime, S.trimIn, S.trimOut));
  }
}

// ------------------------------------------------------------------ init
sizeTimeline();
drawTimeline();
updateSizeEst();   // the chip states its defaults before anything is loaded
renderLookHistory();   // reads only — a corrupt key renders as no rows, never a throw
