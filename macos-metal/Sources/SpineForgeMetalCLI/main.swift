import Foundation
import SpineForgeMetalCore

@main
struct SpineForgeMetalCLI {
    static func main() {
        let args = CommandLine.arguments
        guard args.count >= 2 else {
            printUsage()
            exit(1)
        }

        let cmd = args[1]
        do {
            switch cmd {
            case "info":
                let dummyProject = SfProject(
                    version: "1.0.0",
                    id: "probe",
                    title: "Probe",
                    src: "",
                    width: 64,
                    height: 64,
                    action: "slam",
                    frame: SfFrameMargin(left: 0.2, top: 0.2, right: 0.2, bottom: 0.05),
                    palette: SfPalette(rim: "#7fd8ff", flash: "#f3c969"),
                    bones: [SfBone(name: "root", x: 0.5, y: 0.95)],
                    ikConstraints: [],
                    parts: [],
                    animations: [:]
                )
                let renderer = try MetalRigRenderer(project: dummyProject, publicRootURL: URL(fileURLWithPath: "."))
                let dev = renderer.device
                let info: [String: Any] = [
                    "metalDeviceName": dev.name,
                    "hasUnifiedMemory": dev.hasUnifiedMemory,
                    "maxThreadsPerThreadgroup": dev.maxThreadsPerThreadgroup.width,
                    "recommendedMaxWorkingSetSizeMB": dev.recommendedMaxWorkingSetSize / (1024 * 1024),
                    "status": "ready"
                ]
                let data = try JSONSerialization.data(withJSONObject: info, options: [.prettyPrinted, .sortedKeys])
                print(String(data: data, encoding: .utf8)!)

            case "bake-sheet":
                // spineforge-metal-cli bake-sheet <project.json> <publicRoot> <output.png> [cellHeight] [fps]
                guard args.count >= 5 else {
                    fputs("Usage: spineforge-metal-cli bake-sheet <project.json> <publicRoot> <output.png> [cellHeight] [fps]\n", stderr)
                    exit(1)
                }
                let projectURL = URL(fileURLWithPath: args[2])
                let publicRoot = URL(fileURLWithPath: args[3])
                let outURL = URL(fileURLWithPath: args[4])
                let cellH = args.count >= 6 ? (Int(args[5]) ?? 220) : 220
                let fps = args.count >= 7 ? (Float(args[6]) ?? 12.0) : 12.0

                let data = try Data(contentsOf: projectURL)
                let project = try JSONDecoder().decode(SfProject.self, from: data)
                let renderer = try MetalRigRenderer(project: project, publicRootURL: publicRoot)
                let res = try renderer.bakeSpriteSheetOnMetalGPU(
                    cellHeight: cellH,
                    columns: 8,
                    fps: fps,
                    outputPNGURL: outURL
                )
                let summary: [String: Any] = [
                    "device": renderer.device.name,
                    "project": project.id,
                    "sheetWidth": res.sheetWidth,
                    "sheetHeight": res.sheetHeight,
                    "totalFrames": res.totalFrames,
                    "metalGpuTimeMs": round(res.elapsedMs * 100) / 100,
                    "output": outURL.path
                ]
                let json = try JSONSerialization.data(withJSONObject: summary, options: [.prettyPrinted])
                print(String(data: json, encoding: .utf8)!)

            case "render-preview":
                // spineforge-metal-cli render-preview <project.json> <publicRoot> <output.png> [clipName] [time]
                guard args.count >= 5 else {
                    fputs("Usage: spineforge-metal-cli render-preview <project.json> <publicRoot> <output.png> [clipName] [time]\n", stderr)
                    exit(1)
                }
                let projectURL = URL(fileURLWithPath: args[2])
                let publicRoot = URL(fileURLWithPath: args[3])
                let outURL = URL(fileURLWithPath: args[4])
                let clipName = args.count >= 6 ? args[5] : "strike"
                let time = args.count >= 7 ? (Float(args[6]) ?? 0.58) : 0.58

                let data = try Data(contentsOf: projectURL)
                let project = try JSONDecoder().decode(SfProject.self, from: data)
                let renderer = try MetalRigRenderer(project: project, publicRootURL: publicRoot)
                try renderer.renderSingleFrameOnMetalGPU(
                    clipName: clipName,
                    time: time,
                    width: 1000,
                    height: 1200,
                    showWireframe: true,
                    showBones: true,
                    heatmapMix: 0.45,
                    outputPNGURL: outURL
                )
                print("{\"status\":\"ok\",\"device\":\"\(renderer.device.name)\",\"output\":\"\(outURL.path)\"}")

            case "export-all":
                // spineforge-metal-cli export-all <project.json> <publicRoot> <outputDir> [cellHeight] [fps]
                guard args.count >= 5 else {
                    fputs("Usage: spineforge-metal-cli export-all <project.json> <publicRoot> <outputDir> [cellHeight] [fps]\n", stderr)
                    exit(1)
                }
                let projectURL = URL(fileURLWithPath: args[2])
                let publicRoot = URL(fileURLWithPath: args[3])
                let outDir = URL(fileURLWithPath: args[4])
                let cellH = args.count >= 6 ? (Int(args[5]) ?? 220) : 220
                let fps = args.count >= 7 ? (Float(args[6]) ?? 12.0) : 12.0

                let data = try Data(contentsOf: projectURL)
                let project = try JSONDecoder().decode(SfProject.self, from: data)
                let renderer = try MetalRigRenderer(project: project, publicRootURL: publicRoot)
                let summary = try MetalUnityExporter.exportCompleteUnityBundle(
                    renderer: renderer,
                    outputDir: outDir,
                    sheetCellHeight: cellH,
                    sheetFps: fps
                )
                let outDict: [String: Any] = [
                    "status": "ok",
                    "device": renderer.device.name,
                    "id": summary.id,
                    "atlasSize": "\(summary.atlasWidth)x\(summary.atlasHeight)",
                    "sheetSize": "\(summary.sheetWidth)x\(summary.sheetHeight)",
                    "totalFrames": summary.totalFrames,
                    "elapsedMs": round(summary.elapsedMs * 100) / 100,
                    "outputDir": summary.outputDir.path
                ]
                let json = try JSONSerialization.data(withJSONObject: outDict, options: [.prettyPrinted, .sortedKeys])
                print(String(data: json, encoding: .utf8)!)

            default:
                printUsage()
                exit(1)
            }
        } catch {
            fputs("Error: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    static func printUsage() {
        print("""
        SpineForge Apple Metal GPU CLI
        Commands:
          info
          bake-sheet <project.json> <publicRoot> <output.png> [cellHeight] [fps]
          render-preview <project.json> <publicRoot> <output.png> [clipName] [time]
        """)
    }
}
