// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "openstudio-record",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "openstudio-record",
            path: "Sources/openstudio-record"
        )
    ]
)
