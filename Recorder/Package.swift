// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "retake",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "retake",
            path: "Sources/retake"
        )
    ]
)
