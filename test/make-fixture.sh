#!/usr/bin/env bash
# Regenerates test/fixture.take from scratch (ffmpeg + python3 required).
# VP9/Opus on purpose: Playwright's Chromium lacks H.264/AAC; the editor has fallbacks.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fixture.take
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x800:rate=30:duration=5,drawbox=x=380:y=280:w=200:h=120:color=white@0.8:t=6" \
  -f lavfi -i "sine=frequency=300:duration=5" \
  -pix_fmt yuv420p -c:v libvpx-vp9 -b:v 2M -c:a libopus -shortest fixture.take/screen.mp4
ffmpeg -y -loglevel error -f lavfi -i "smptebars=size=640x480:rate=30:duration=5" \
  -f lavfi -i "sine=frequency=440:duration=5" \
  -pix_fmt yuv420p -c:v libvpx-vp9 -c:a libopus -shortest fixture.take/webcam.webm
python3 - <<'PY'
import json, math
samples = []
for i in range(0, 5*120):
    t = i/120
    if t < 2:   x, y = 200 + (280*t/2) + 8*math.sin(t*20), 200 + (140*t/2) + 8*math.cos(t*17)
    elif t < 4: f=(t-2)/2; x, y = 480 + 420*f + 6*math.sin(t*22), 340 + 160*f + 6*math.cos(t*15)
    else:       x, y = 900 + 5*math.sin(t*10), 500 + 5*math.cos(t*10)
    samples.append([round(t,4), round(x,2), round(y,2)])
clicks = [
    {"t":2.0,"x":480,"y":340,"button":0,"down":True},
    {"t":2.12,"x":480,"y":340,"button":0,"down":False},
    {"t":4.0,"x":900,"y":500,"button":0,"down":True},
    {"t":4.1,"x":900,"y":500,"button":0,"down":False},
]
json.dump({"samples":samples,"clicks":clicks,"keys":[2.5,2.6,2.7],
           "keystrokes":[[2.45,"⌘"],[2.6,"⇧⌘P"],[2.8,"H"],[2.95,"I"],[3.1,"⏎"]],
           "clicksCaptured":True}, open("fixture.take/cursor.json","w"))
json.dump({"version":2,"screen":"screen.mp4","cursor":"cursor.json","webcam":"webcam.webm",
           "webcamOffset":0.1,"pointWidth":1280,"pointHeight":800,
           "pixelWidth":1280,"pixelHeight":800,"fps":30,"systemAudio":True,
           "capture":{"mode":"display","index":0}}, open("fixture.take/meta.json","w"))
print("fixture regenerated")
PY
