// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "SpineForgeMetal",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(name: "SpineForgeMetalCore", targets: ["SpineForgeMetalCore"]),
        .executable(name: "spineforge-metal-cli", targets: ["SpineForgeMetalCLI"]),
        .executable(name: "SpineForge", targets: ["SpineForgeMacApp"])
    ],
    targets: [
        .target(
            name: "SpineForgeMetalCore",
            path: "Sources/SpineForgeMetalCore",
            linkerSettings: [
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("Vision"),
                .linkedFramework("CoreImage"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("ImageIO"),
                .linkedFramework("AppKit"),
                .linkedFramework("UniformTypeIdentifiers")
            ]
        ),
        .executableTarget(
            name: "SpineForgeMetalCLI",
            dependencies: ["SpineForgeMetalCore"],
            path: "Sources/SpineForgeMetalCLI"
        ),
        .executableTarget(
            name: "SpineForgeMacApp",
            dependencies: ["SpineForgeMetalCore"],
            path: "Sources/SpineForgeMacApp",
            linkerSettings: [
                .linkedFramework("SwiftUI"),
                .linkedFramework("AppKit"),
                .linkedFramework("Metal"),
                .linkedFramework("MetalKit"),
                .linkedFramework("Vision"),
                .linkedFramework("CoreImage")
            ]
        )
    ]
)
