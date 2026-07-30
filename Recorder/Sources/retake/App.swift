// retake — minimal Screen Studio-style recorder
// Records the screen WITHOUT the cursor, logs cursor positions + clicks to JSON,
// captures system audio into the screen file, and (optionally) records the
// webcam + microphone alongside. The companion editor does the pretty stuff.
//
// Usage:
//   retake [--display N | --window NAME | --area x,y,w,h]
//                     [--fps 60] [--webcam] [--mic] [--keys]
//                     [--no-system-audio] [--out DIR] [--list]
//   Stop with Ctrl+C in the terminal, or ⌃⎋ (Control+Escape) from anywhere.

import Foundation
import AVFoundation
import ScreenCaptureKit
import CoreGraphics
import CoreMedia
import QuartzCore
import AppKit

// ---------------------------------------------------------------- CLI args

struct Options {
    var displayIndex = 0
    var windowQuery: String? = nil
    var area: CGRect? = nil
    var fps = 60
    var webcam = false
    var mic = false
    var keys = false
    var systemAudio = true
    var list = false
    var outDir: String? = nil
}

func parseArgs() -> Options {
    var o = Options()
    var it = CommandLine.arguments.dropFirst().makeIterator()
    while let a = it.next() {
        switch a {
        case "--display": o.displayIndex = Int(it.next() ?? "0") ?? 0
        case "--window":  o.windowQuery = it.next()
        case "--area":
            let parts = (it.next() ?? "").split(separator: ",").compactMap { Double($0) }
            if parts.count == 4 { o.area = CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3]) }
            else { print("Bad --area (want x,y,w,h)"); exit(1) }
        case "--fps":     o.fps = Int(it.next() ?? "60") ?? 60
        case "--webcam":  o.webcam = true
        case "--mic":     o.mic = true
        case "--keys":    o.keys = true
        case "--no-system-audio": o.systemAudio = false
        case "--list":    o.list = true
        case "--out":     o.outDir = it.next()
        case "-h", "--help":
            print("""
            retake [options]
              --display N        record display N (0 = main; default)
              --window NAME      record a single window (matches app/title, case-insensitive)
              --area x,y,w,h     record a region of the display (points, from top-left)
              --list             list displays and windows, then exit
              --fps N            capture frame rate (default 60)
              --webcam           also record webcam (+ mic) to webcam.mov
              --mic              record mic only (no webcam) to audio.mov
              --keys             ALSO record which keys you press (for on-screen keystroke
                                 display in the editor). Off by default — without this flag
                                 only key *timings* are logged, never the keys themselves.
              --no-system-audio  don't capture system/app audio
              --out DIR          output folder (default ~/Desktop/Retake/<timestamp>.take)
            Stop with Ctrl+C, or ⌃⎋ (Control+Escape) from any app.
            Tip: don't move the window during a --window recording — the cursor
            is logged against the window's starting position.
            """)
            exit(0)
        default:
            print("Unknown argument: \(a) (try --help)"); exit(1)
        }
    }
    return o
}

// ---------------------------------------------------------------- Cursor logging

let KEYMAP: [Int64: String] = [
    0:"A",1:"S",2:"D",3:"F",4:"H",5:"G",6:"Z",7:"X",8:"C",9:"V",11:"B",12:"Q",13:"W",14:"E",
    15:"R",16:"Y",17:"T",18:"1",19:"2",20:"3",21:"4",22:"6",23:"5",24:"=",25:"9",26:"7",27:"-",
    28:"8",29:"0",30:"]",31:"O",32:"U",33:"[",34:"I",35:"P",36:"⏎",37:"L",38:"J",39:"'",40:"K",
    41:";",42:"\\",43:",",44:"/",45:"N",46:"M",47:".",48:"⇥",49:"␣",50:"`",51:"⌫",53:"⎋",
    96:"F5",97:"F6",98:"F7",99:"F3",100:"F8",118:"F4",120:"F2",122:"F1",
    123:"←",124:"→",125:"↓",126:"↑"
]

final class CursorLogger {
    struct Click { let t: Double; let x: Double; let y: Double; let button: Int; let down: Bool }
    private(set) var samples: [(Double, Double, Double)] = []   // t, x, y (capture-local points)
    private(set) var clicks: [Click] = []
    private(set) var keyTimes: [Double] = []
    private(set) var keystrokes: [(Double, String)] = []
    var tapWorked = false
    var onHotkey: (() -> Void)? = nil                // ⌃⎋ handler

    private var timer: DispatchSourceTimer?
    private var tap: CFMachPort?
    private let origin: CGPoint                      // top-left of captured region, global coords
    private let captureKeys: Bool
    private let queue = DispatchQueue(label: "cursor.log")

    init(origin: CGPoint, captureKeys: Bool) {
        self.origin = origin
        self.captureKeys = captureKeys
    }

    func start() {
        // 1) Poll cursor position at 120 Hz — needs no permissions at all.
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: .milliseconds(8))
        t.setEventHandler { [weak self] in
            guard let self, let e = CGEvent(source: nil) else { return }
            let p = e.location
            self.samples.append((CACurrentMediaTime(),
                                 Double(p.x - self.origin.x),
                                 Double(p.y - self.origin.y)))
        }
        t.resume()
        timer = t

        // 2) Listen-only event tap for clicks + keys.
        let mask: CGEventMask =
            (1 << CGEventType.leftMouseDown.rawValue)  |
            (1 << CGEventType.leftMouseUp.rawValue)    |
            (1 << CGEventType.rightMouseDown.rawValue) |
            (1 << CGEventType.rightMouseUp.rawValue)   |
            (1 << CGEventType.keyDown.rawValue)

        let callback: CGEventTapCallBack = { _, type, event, refcon in
            let me = Unmanaged<CursorLogger>.fromOpaque(refcon!).takeUnretainedValue()
            let now = CACurrentMediaTime()
            let p = event.location
            let x = Double(p.x - me.origin.x)
            let y = Double(p.y - me.origin.y)
            if type == .keyDown {
                let kc = event.getIntegerValueField(.keyboardEventKeycode)
                let flags = event.flags
                // Global stop hotkey: Control+Escape
                if kc == 53 && flags.contains(.maskControl) {
                    me.onHotkey?()
                    return Unmanaged.passUnretained(event)
                }
                if event.getIntegerValueField(.keyboardEventAutorepeat) == 0 {
                    let stroke: String?
                    if me.captureKeys, let base = KEYMAP[kc] {
                        var mods = ""
                        if flags.contains(.maskControl)   { mods += "⌃" }
                        if flags.contains(.maskAlternate) { mods += "⌥" }
                        if flags.contains(.maskShift)     { mods += "⇧" }
                        if flags.contains(.maskCommand)   { mods += "⌘" }
                        stroke = mods + base
                    } else { stroke = nil }
                    me.queue.async {
                        me.keyTimes.append(now)
                        if let s = stroke { me.keystrokes.append((now, s)) }
                    }
                }
                return Unmanaged.passUnretained(event)
            }
            me.queue.async {
                switch type {
                case .leftMouseDown:  me.clicks.append(Click(t: now, x: x, y: y, button: 0, down: true))
                case .leftMouseUp:    me.clicks.append(Click(t: now, x: x, y: y, button: 0, down: false))
                case .rightMouseDown: me.clicks.append(Click(t: now, x: x, y: y, button: 1, down: true))
                case .rightMouseUp:   me.clicks.append(Click(t: now, x: x, y: y, button: 1, down: false))
                default: break
                }
            }
            return Unmanaged.passUnretained(event)
        }

        let refcon = Unmanaged.passUnretained(self).toOpaque()
        if let tap = CGEvent.tapCreate(tap: .cgSessionEventTap,
                                       place: .headInsertEventTap,
                                       options: .listenOnly,
                                       eventsOfInterest: mask,
                                       callback: callback,
                                       userInfo: refcon) {
            self.tap = tap
            let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
            CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
            CGEvent.tapEnable(tap: tap, enable: true)
            tapWorked = true
        } else {
            fputs("""
            ⚠️  Could not listen for clicks (auto-zoom will need manual zoom points,
                and the ⌃⎋ stop hotkey won't work — use Ctrl+C in the terminal).
                Grant permission in: System Settings → Privacy & Security → Accessibility
                → enable your terminal app, then run again.\n
            """, stderr)
        }
    }

    func stop() { timer?.cancel(); if let tap { CGEvent.tapEnable(tap: tap, enable: false) } }

    func writeJSON(to url: URL, videoStart: Double) throws {
        func rel(_ t: Double) -> Double { (t - videoStart).rounded(toPlaces: 4) }
        var root: [String: Any] = [:]
        root["samples"] = queue.sync { samples.map { [rel($0.0), $0.1.rounded(toPlaces: 2), $0.2.rounded(toPlaces: 2)] } }
        root["clicks"]  = queue.sync { clicks.map { ["t": rel($0.t), "x": $0.x.rounded(toPlaces: 2), "y": $0.y.rounded(toPlaces: 2), "button": $0.button, "down": $0.down] } }
        root["keys"]    = queue.sync { keyTimes.map { rel($0) } }
        if captureKeys {
            root["keystrokes"] = queue.sync { keystrokes.map { [rel($0.0), $0.1] } }
        }
        root["clicksCaptured"] = tapWorked
        let data = try JSONSerialization.data(withJSONObject: root)
        try data.write(to: url)
    }
}

extension Double {
    func rounded(toPlaces p: Int) -> Double {
        let m = pow(10.0, Double(p)); return (self * m).rounded() / m
    }
}

// ---------------------------------------------------------------- Screen capture

final class ScreenRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let audioInput: AVAssetWriterInput?
    private var stream: SCStream?
    private var sessionStarted = false
    private(set) var firstFrameTime: Double = 0
    private let queue = DispatchQueue(label: "screen.capture")
    private let audioQueue = DispatchQueue(label: "screen.audio")

    init(outputURL: URL, width: Int, height: Int, fps: Int, systemAudio: Bool) throws {
        writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        let bitrate = min(max(width * height * 6, 8_000_000), 60_000_000)
        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: bitrate,
                AVVideoExpectedSourceFrameRateKey: fps,
                AVVideoMaxKeyFrameIntervalKey: fps * 2,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
            ]
        ]
        input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        writer.add(input)

        if systemAudio {
            let a = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48000,
                AVNumberOfChannelsKey: 2,
                AVEncoderBitRateKey: 192_000
            ])
            a.expectsMediaDataInRealTime = true
            writer.add(a)
            audioInput = a
        } else {
            audioInput = nil
        }
        super.init()
    }

    func start(filter: SCContentFilter, width: Int, height: Int, fps: Int, systemAudio: Bool, sourceRect: CGRect?) async throws {
        let cfg = SCStreamConfiguration()
        cfg.width = width
        cfg.height = height
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        cfg.showsCursor = false                       // ← the editor redraws it, smoothly
        cfg.queueDepth = 8
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        if let r = sourceRect { cfg.sourceRect = r }
        if systemAudio {
            cfg.capturesAudio = true
            cfg.excludesCurrentProcessAudio = true
        }

        // Start the writer BEFORE capture — frames can arrive immediately.
        guard writer.startWriting() else { throw writer.error ?? NSError(domain: "retake", code: 1) }

        let stream = SCStream(filter: filter, configuration: cfg, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if systemAudio {
            try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
        }
        try await stream.startCapture()
        self.stream = stream
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard sb.isValid, writer.status == .writing else { return }

        if type == .audio {
            // Audio before the first video frame has nowhere to go — drop it.
            guard sessionStarted, let ai = audioInput, ai.isReadyForMoreMediaData else { return }
            ai.append(sb)
            return
        }

        guard type == .screen, CMSampleBufferGetImageBuffer(sb) != nil else { return }
        // Only keep complete frames
        if let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
           let statusRaw = atts.first?[.status] as? Int,
           let status = SCFrameStatus(rawValue: statusRaw), status != .complete {
            return
        }
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        if !sessionStarted {
            sessionStarted = true
            firstFrameTime = CMTimeGetSeconds(pts)   // mach clock, comparable to CACurrentMediaTime()
            writer.startSession(atSourceTime: pts)
        }
        if input.isReadyForMoreMediaData { input.append(sb) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("Stream stopped: \(error.localizedDescription)\n", stderr)
    }

    func finish() async {
        try? await stream?.stopCapture()
        input.markAsFinished()
        audioInput?.markAsFinished()
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            writer.finishWriting { c.resume() }
        }
    }
}

// ---------------------------------------------------------------- Webcam / mic

final class CameraRecorder: NSObject, AVCaptureFileOutputRecordingDelegate {
    private let session = AVCaptureSession()
    private let output = AVCaptureMovieFileOutput()
    private(set) var startedAt: Double = 0
    private var startCont: CheckedContinuation<Void, Never>?
    private var stopCont: CheckedContinuation<Void, Never>?

    /// video=false → mic-only recording
    func start(to url: URL, video: Bool) async -> Bool {
        // Ask for permissions up-front so we never hang waiting for a recording to start.
        if video {
            let camOK = await AVCaptureDevice.requestAccess(for: .video)
            if !camOK { fputs("⚠️  Camera permission denied — continuing without webcam.\n", stderr); return false }
        }
        let micOK = await AVCaptureDevice.requestAccess(for: .audio)
        if !micOK && !video { fputs("⚠️  Microphone permission denied.\n", stderr); return false }
        session.beginConfiguration()
        session.sessionPreset = video ? .high : .medium
        if video {
            guard let cam = AVCaptureDevice.default(for: .video),
                  let inp = try? AVCaptureDeviceInput(device: cam), session.canAddInput(inp) else {
                fputs("⚠️  No webcam available — continuing without it.\n", stderr)
                session.commitConfiguration(); return false
            }
            session.addInput(inp)
        }
        if let micDev = AVCaptureDevice.default(for: .audio),
           let micInp = try? AVCaptureDeviceInput(device: micDev), session.canAddInput(micInp) {
            session.addInput(micInp)
        } else {
            fputs("⚠️  No microphone input available.\n", stderr)
        }
        guard session.canAddOutput(output) else { session.commitConfiguration(); return false }
        session.addOutput(output)
        if video, let conn = output.connection(with: .video) {
            // Force H.264 (instead of HEVC) so Chrome can play the webcam file directly.
            output.setOutputSettings([AVVideoCodecKey: AVVideoCodecType.h264], for: conn)
        }
        session.commitConfiguration()
        session.startRunning()
        output.startRecording(to: url, recordingDelegate: self)
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in startCont = c }
        return true
    }

    func fileOutput(_ o: AVCaptureFileOutput, didStartRecordingTo url: URL, from connections: [AVCaptureConnection]) {
        startedAt = CACurrentMediaTime()
        startCont?.resume(); startCont = nil
    }

    func fileOutput(_ o: AVCaptureFileOutput, didFinishRecordingTo url: URL, from connections: [AVCaptureConnection], error: Error?) {
        if let error { fputs("Webcam finished with note: \(error.localizedDescription)\n", stderr) }
        stopCont?.resume(); stopCont = nil
    }

    func stop() async {
        guard output.isRecording else { session.stopRunning(); return }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            stopCont = c
            output.stopRecording()
        }
        session.stopRunning()
    }
}

// ---------------------------------------------------------------- Main

@main
struct Main {
    static func main() async {
        let opts = parseArgs()

        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            fputs("""
            ❌ Screen recording permission needed.
               System Settings → Privacy & Security → Screen Recording → enable your terminal app,
               then quit and reopen the terminal and run again.
               (\(error.localizedDescription))\n
            """, stderr)
            exit(1)
        }

        func scaleFor(displayID: CGDirectDisplayID) -> Double {
            let bounds = CGDisplayBounds(displayID)
            if let mode = CGDisplayCopyDisplayMode(displayID), bounds.width > 0 {
                return Double(mode.pixelWidth) / Double(bounds.width)
            }
            return 2.0
        }
        func even(_ v: Double) -> Int { max(2, Int(v.rounded()) & ~1) }

        let interestingWindows = content.windows.filter {
            $0.isOnScreen && $0.windowLayer == 0 &&
            $0.frame.width > 160 && $0.frame.height > 120 &&
            !($0.title ?? "").isEmpty
        }

        if opts.list {
            print("Displays:")
            for (i, d) in content.displays.enumerated() {
                print("  --display \(i)   \(d.width)×\(d.height)  (id \(d.displayID))")
            }
            print("Windows (use --window with any part of the name):")
            for w in interestingWindows {
                let app = w.owningApplication?.applicationName ?? "?"
                print("  \(app) — \(w.title ?? "")  [\(Int(w.frame.width))×\(Int(w.frame.height))]")
            }
            exit(0)
        }

        // Resolve what we're capturing: display, window, or area.
        let filter: SCContentFilter
        var pixelW: Int, pixelH: Int
        var cursorOrigin: CGPoint
        var pointW: Int, pointH: Int
        var sourceRect: CGRect? = nil
        var captureDesc: String
        var captureMeta: [String: Any] = [:]

        guard opts.displayIndex < content.displays.count else {
            fputs("❌ Display \(opts.displayIndex) not found (\(content.displays.count) available).\n", stderr); exit(1)
        }
        let display = content.displays[opts.displayIndex]
        let displayBounds = CGDisplayBounds(display.displayID)

        if let q = opts.windowQuery {
            let ql = q.lowercased()
            let matches = interestingWindows.filter {
                let name = "\(($0.owningApplication?.applicationName ?? "")) \($0.title ?? "")".lowercased()
                return name.contains(ql)
            }
            guard let win = matches.max(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }) else {
                fputs("❌ No window matching \"\(q)\". Try --list to see window names.\n", stderr); exit(1)
            }
            // scale from the display that contains the window's center
            let center = CGPoint(x: win.frame.midX, y: win.frame.midY)
            let host = content.displays.first { CGDisplayBounds($0.displayID).contains(center) } ?? display
            let scale = scaleFor(displayID: host.displayID)
            filter = SCContentFilter(desktopIndependentWindow: win)
            pixelW = even(win.frame.width * scale); pixelH = even(win.frame.height * scale)
            cursorOrigin = win.frame.origin
            pointW = Int(win.frame.width); pointH = Int(win.frame.height)
            let app = win.owningApplication?.applicationName ?? "window"
            captureDesc = "window “\(app) — \(win.title ?? "")”"
            captureMeta = ["mode": "window", "app": app, "title": win.title ?? ""]
        } else if let area = opts.area {
            let scale = scaleFor(displayID: display.displayID)
            filter = SCContentFilter(display: display, excludingWindows: [])
            sourceRect = area
            pixelW = even(area.width * scale); pixelH = even(area.height * scale)
            cursorOrigin = CGPoint(x: displayBounds.origin.x + area.origin.x,
                                   y: displayBounds.origin.y + area.origin.y)
            pointW = Int(area.width); pointH = Int(area.height)
            captureDesc = "area \(Int(area.width))×\(Int(area.height)) of display \(opts.displayIndex)"
            captureMeta = ["mode": "area", "x": Int(area.origin.x), "y": Int(area.origin.y)]
        } else {
            let scale = scaleFor(displayID: display.displayID)
            filter = SCContentFilter(display: display, excludingWindows: [])
            pixelW = even(Double(display.width) * scale); pixelH = even(Double(display.height) * scale)
            cursorOrigin = displayBounds.origin
            pointW = Int(displayBounds.width); pointH = Int(displayBounds.height)
            captureDesc = "display \(opts.displayIndex)"
            captureMeta = ["mode": "display", "index": opts.displayIndex]
        }

        // Output bundle
        let df = DateFormatter(); df.dateFormat = "yyyy-MM-dd HH.mm.ss"
        let name = "\(df.string(from: Date())).take"
        let baseDir = opts.outDir.map { URL(fileURLWithPath: ($0 as NSString).expandingTildeInPath) }
            ?? FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Desktop/Retake", isDirectory: true)
        let bundle = baseDir.appendingPathComponent(name, isDirectory: true)
        try? FileManager.default.createDirectory(at: bundle, withIntermediateDirectories: true)

        // Start everything
        let cursor = CursorLogger(origin: cursorOrigin, captureKeys: opts.keys)
        cursor.onHotkey = { kill(getpid(), SIGINT) }
        cursor.start()

        let screen: ScreenRecorder
        do {
            screen = try ScreenRecorder(outputURL: bundle.appendingPathComponent("screen.mp4"),
                                        width: pixelW, height: pixelH, fps: opts.fps,
                                        systemAudio: opts.systemAudio)
            try await screen.start(filter: filter, width: pixelW, height: pixelH, fps: opts.fps,
                                   systemAudio: opts.systemAudio, sourceRect: sourceRect)
        } catch {
            fputs("❌ Could not start screen capture: \(error.localizedDescription)\n", stderr)
            fputs("   Check Screen Recording permission for your terminal app.\n", stderr)
            exit(1)
        }

        var camera: CameraRecorder? = nil
        var cameraFile: String? = nil
        if opts.webcam || opts.mic {
            let cam = CameraRecorder()
            let file = opts.webcam ? "webcam.mov" : "audio.mov"
            if await cam.start(to: bundle.appendingPathComponent(file), video: opts.webcam) {
                camera = cam; cameraFile = file
            }
        }

        var extras: [String] = []
        if opts.systemAudio { extras.append("system audio") }
        if camera != nil { extras.append(opts.webcam ? "webcam + mic" : "mic") }
        if opts.keys { extras.append("keystrokes") }
        print("""
        ● Recording \(captureDesc) (\(pixelW)×\(pixelH) @ \(opts.fps)fps)\(extras.isEmpty ? "" : " + " + extras.joined(separator: " + "))
          → \(bundle.path)
          Stop: Ctrl+C here, or ⌃⎋ (Control+Escape) from anywhere.
        """)

        // Wait for Ctrl+C / hotkey
        signal(SIGINT, SIG_IGN)
        let sig = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            sig.setEventHandler { sig.cancel(); c.resume() }
            sig.resume()
        }

        print("\n■ Stopping…")
        cursor.stop()
        await camera?.stop()
        await screen.finish()

        // Metadata + cursor data (timestamps relative to first video frame)
        let videoStart = screen.firstFrameTime
        try? cursor.writeJSON(to: bundle.appendingPathComponent("cursor.json"), videoStart: videoStart)

        var meta: [String: Any] = [
            "version": 2,
            "screen": "screen.mp4",
            "cursor": "cursor.json",
            "pointWidth": pointW,
            "pointHeight": pointH,
            "pixelWidth": pixelW,
            "pixelHeight": pixelH,
            "fps": opts.fps,
            "systemAudio": opts.systemAudio,
            "capture": captureMeta
        ]
        if let cameraFile, let camera {
            meta[opts.webcam ? "webcam" : "audio"] = cameraFile
            meta["webcamOffset"] = (camera.startedAt - videoStart).rounded(toPlaces: 4)
        }
        if let data = try? JSONSerialization.data(withJSONObject: meta, options: [.prettyPrinted]) {
            try? data.write(to: bundle.appendingPathComponent("meta.json"))
        }

        print("""
        ✓ Saved \(bundle.lastPathComponent)
          Open the editor (retake-editor.html) in Chrome and load this folder.
        """)
        exit(0)
    }
}
