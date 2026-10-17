import Foundation
import CoreGraphics
import ImageIO
import AppKit
import Vision
import CoreImage
import UniformTypeIdentifiers
import simd

public struct PackedAtlasRegionSwift {
    public var name: String
    public var x: Int
    public var y: Int
    public var width: Int
    public var height: Int
    public var uvRect: SIMD4<Float> // [u0, v0, u1, v1]
}

public struct CompleteMetalExportSummary {
    public var id: String
    public var outputDir: URL
    public var atlasWidth: Int
    public var atlasHeight: Int
    public var sheetWidth: Int
    public var sheetHeight: Int
    public var totalFrames: Int
    public var elapsedMs: Double
}

public enum MetalUnityExporter {

    private static func nextPowerOfTwo(_ n: Int) -> Int {
        var p = 64
        while p < n && p < 8192 { p <<= 1 }
        return p
    }

    private static func round4(_ v: Float) -> Float {
        return (v * 10000.0).rounded() / 10000.0
    }

    /// Exports the complete 3-way Unity + Spine 4.2 + Apple Metal Flipbook Sprite Sheet bundle natively in Swift!
    /// Writes to `outputDir`:
    /// - `<id>.png` (Packed Texture Atlas)
    /// - `<id>.atlas.txt` (Spine 4.2 Atlas)
    /// - `<id>.spine.json` (Spine 4.2 Skeleton + Weighted Meshes + Baked Animations)
    /// - `<id>.sfrig.json` (Zero-Dependency Unity C# Runtime Rig)
    /// - `<id>-sheet.png` (Apple Metal GPU Baked Flipbook Sprite Sheet)
    /// - `<id>.sprites.json` (Unity Flipbook Slicing & Clip Manifest)
    /// - `<id>.project.json` (Canonical Project File)
    public static func exportCompleteUnityBundle(
        renderer: MetalRigRenderer,
        outputDir: URL,
        sheetCellHeight: Int = 220,
        sheetFps: Float = 12.0
    ) throws -> CompleteMetalExportSummary {
        let t0 = CFAbsoluteTimeGetCurrent()
        try FileManager.default.createDirectory(at: outputDir, withIntermediateDirectories: true)

        let project = renderer.solver.project
        let id = project.id

        // 1. Pack Part Textures into Power-of-Two Atlas using Shelf/Skyline Packing + CoreGraphics
        let padding = 4
        var partImages: [(name: String, cgImage: CGImage, w: Int, h: Int)] = []

        for part in project.parts {
            let relPath = part.src.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let url = renderer.publicRootURL.appendingPathComponent(relPath)
            if let nsImg = NSImage(contentsOf: url),
               let cg = nsImg.cgImage(forProposedRect: nil, context: nil, hints: nil) {
                partImages.append((part.name, cg, cg.width, cg.height))
            } else {
                let w = max(16, Int(round(part.w * Float(project.width))))
                let h = max(16, Int(round(part.h * Float(project.height))))
                if let ctx = CGContext(
                    data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                ), let cg = ctx.makeImage() {
                    partImages.append((part.name, cg, w, h))
                }
            }
        }

        // Sort tallest first for tight shelf packing
        let sorted = partImages.sorted { $0.h > $1.h }
        let totalArea = sorted.reduce(0) { $0 + ($1.w + padding * 2) * ($1.h + padding * 2) }
        let targetWidth = nextPowerOfTwo(max(512, Int(ceil(sqrt(Double(totalArea))))))

        var curX = padding
        var curY = padding
        var rowH = 0
        var maxUsedW = 64
        var maxUsedH = 64
        var placed: [String: (x: Int, y: Int, w: Int, h: Int, cg: CGImage)] = [:]

        for item in sorted {
            if curX + item.w + padding > targetWidth {
                curX = padding
                curY += rowH + padding
                rowH = 0
            }
            placed[item.name] = (curX, curY, item.w, item.h, item.cgImage)
            curX += item.w + padding
            rowH = max(rowH, item.h)
            maxUsedW = max(maxUsedW, curX)
            maxUsedH = max(maxUsedH, curY + rowH + padding)
        }

        let atlasW = nextPowerOfTwo(maxUsedW)
        let atlasH = nextPowerOfTwo(maxUsedH)

        // Composite into Atlas CGContext (top-left origin for placement)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let atlasCtx = CGContext(
            data: nil,
            width: atlasW,
            height: atlasH,
            bitsPerComponent: 8,
            bytesPerRow: atlasW * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw NSError(domain: "SpineForgeExport", code: 10, userInfo: [NSLocalizedDescriptionKey: "Failed to create Atlas CGContext"])
        }

        atlasCtx.clear(CGRect(x: 0, y: 0, width: atlasW, height: atlasH))

        var regions: [String: PackedAtlasRegionSwift] = [:]
        var spineAtlasLines: [String] = [
            "\(id).png",
            "size: \(atlasW),\(atlasH)",
            "format: RGBA8888",
            "filter: Linear,Linear",
            "repeat: none"
        ]

        for part in project.parts {
            guard let p = placed[part.name] else { continue }
            // CGContext has bottom-left Y origin; convert top-left y -> bottom-left cgY
            let cgY = atlasH - p.y - p.h
            atlasCtx.draw(p.cg, in: CGRect(x: p.x, y: cgY, width: p.w, height: p.h))

            let uvRect = SIMD4<Float>(
                Float(p.x) / Float(atlasW),
                Float(p.y) / Float(atlasH),
                Float(p.x + p.w) / Float(atlasW),
                Float(p.y + p.h) / Float(atlasH)
            )
            regions[part.name] = PackedAtlasRegionSwift(
                name: part.name,
                x: p.x,
                y: p.y,
                width: p.w,
                height: p.h,
                uvRect: uvRect
            )

            spineAtlasLines.append(part.name)
            spineAtlasLines.append("  bounds: \(p.x),\(p.y),\(p.w),\(p.h)")
            spineAtlasLines.append("  offsets: 0,0,\(p.w),\(p.h)")
        }

        let atlasPNGURL = outputDir.appendingPathComponent("\(id).png")
        if let atlasCG = atlasCtx.makeImage(),
           let dest = CGImageDestinationCreateWithURL(atlasPNGURL as CFURL, UTType.png.identifier as CFString, 1, nil) {
            CGImageDestinationAddImage(dest, atlasCG, nil)
            CGImageDestinationFinalize(dest)
        }

        let atlasTxtURL = outputDir.appendingPathComponent("\(id).atlas.txt")
        try (spineAtlasLines.joined(separator: "\n") + "\n").write(to: atlasTxtURL, atomically: true, encoding: .utf8)

        // 2. Export Spine 4.2 JSON & Zero-Dependency Unity .sfrig.json
        let spineDict = buildSpine42Dictionary(renderer: renderer)
        let spineData = try JSONSerialization.data(withJSONObject: spineDict, options: [.prettyPrinted, .sortedKeys])
        try spineData.write(to: outputDir.appendingPathComponent("\(id).spine.json"))

        let sfrigDict = buildUnitySfRigDictionary(renderer: renderer, atlasW: atlasW, atlasH: atlasH, regions: regions)
        let sfrigData = try JSONSerialization.data(withJSONObject: sfrigDict, options: [.prettyPrinted, .sortedKeys])
        try sfrigData.write(to: outputDir.appendingPathComponent("\(id).sfrig.json"))

        // 3. Bake Flipbook Sprite Sheet on Apple Metal GPU + Write .sprites.json
        let sheetPNGURL = outputDir.appendingPathComponent("\(id)-sheet.png")
        let bakeRes = try renderer.bakeSpriteSheetOnMetalGPU(
            cellHeight: sheetCellHeight,
            columns: 8,
            fps: sheetFps,
            outputPNGURL: sheetPNGURL
        )

        let spritesDict = buildSpritesManifestDictionary(
            project: project,
            sheetWidth: bakeRes.sheetWidth,
            sheetHeight: bakeRes.sheetHeight,
            cellHeight: sheetCellHeight,
            columns: 8,
            fps: sheetFps
        )
        let spritesData = try JSONSerialization.data(withJSONObject: spritesDict, options: [.prettyPrinted, .sortedKeys])
        try spritesData.write(to: outputDir.appendingPathComponent("\(id).sprites.json"))

        // 4. Save updated .project.json
        let projData = try JSONEncoder().encode(project)
        try projData.write(to: outputDir.appendingPathComponent("\(id).project.json"))

        let elapsedMs = (CFAbsoluteTimeGetCurrent() - t0) * 1000.0
        return CompleteMetalExportSummary(
            id: id,
            outputDir: outputDir,
            atlasWidth: atlasW,
            atlasHeight: atlasH,
            sheetWidth: bakeRes.sheetWidth,
            sheetHeight: bakeRes.sheetHeight,
            totalFrames: bakeRes.totalFrames,
            elapsedMs: elapsedMs
        )
    }

    private static func buildSpine42Dictionary(renderer: MetalRigRenderer) -> [String: Any] {
        let project = renderer.solver.project
        let rigW = Float(project.width)
        let rigH = Float(project.height)
        let rootBone = project.bones.first ?? SfBone(name: "root", x: 0.5, y: 0.975)
        let rootPx = rootBone.x * rigW
        let rootPy = rootBone.y * rigH

        func toSpineWorld(_ px: Float, _ py: Float) -> SIMD2<Float> {
            return SIMD2<Float>(px - rootPx, rootPy - py)
        }

        let boneSpineWorld: [SIMD2<Float>] = project.bones.map {
            toSpineWorld($0.x * rigW, $0.y * rigH)
        }

        let bonesArr: [[String: Any]] = project.bones.enumerated().map { (i, b) in
            let w = boneSpineWorld[i]
            let pIdx = renderer.solver.parents[i]
            let pw = pIdx >= 0 ? boneSpineWorld[pIdx] : .zero
            var dict: [String: Any] = [
                "name": b.name,
                "length": round4((b.length ?? 0.08) * rigH),
                "x": round4(w.x - pw.x),
                "y": round4(w.y - pw.y),
                "rotation": 0,
                "scaleX": 1,
                "scaleY": 1
            ]
            if let parent = b.parent { dict["parent"] = parent }
            return dict
        }

        let slotsArr: [[String: Any]] = project.parts.map { part in
            [
                "name": part.name,
                "bone": part.bone ?? part.skin?.first ?? rootBone.name,
                "attachment": part.name
            ]
        }

        var attachmentsDict: [String: Any] = [:]
        for part in project.parts {
            guard let state = renderer.parts[part.name] else { continue }
            let isWeighted = (part.skin?.count ?? 0) > 1
            let singleIdx = renderer.solver.boneIndex[part.bone ?? part.skin?.first ?? "root"] ?? 0

            var spineVerts: [Float] = []
            var uvs: [Float] = []
            for v in state.vertices {
                uvs.append(round4(v.uv.x))
                uvs.append(round4(v.uv.y))
                let wPos = toSpineWorld(v.position.x, v.position.y)
                if !isWeighted {
                    let bPos = boneSpineWorld[singleIdx]
                    spineVerts.append(round4(wPos.x - bPos.x))
                    spineVerts.append(round4(wPos.y - bPos.y))
                } else {
                    var active: [(b: Int, lx: Float, ly: Float, w: Float)] = []
                    for k in 0..<4 {
                        let w = v.weights[k]
                        let b = Int(v.joints[k])
                        if w > 1e-5 && b < boneSpineWorld.count {
                            let bPos = boneSpineWorld[b]
                            active.append((b, round4(wPos.x - bPos.x), round4(wPos.y - bPos.y), round4(w)))
                        }
                    }
                    if active.isEmpty {
                        let bPos = boneSpineWorld[0]
                        active.append((0, round4(wPos.x - bPos.x), round4(wPos.y - bPos.y), 1.0))
                    }
                    spineVerts.append(Float(active.count))
                    for item in active {
                        spineVerts.append(Float(item.b))
                        spineVerts.append(item.lx)
                        spineVerts.append(item.ly)
                        spineVerts.append(item.w)
                    }
                }
            }

            attachmentsDict[part.name] = [
                part.name: [
                    "type": "mesh",
                    "name": part.name,
                    "path": part.name,
                    "uvs": uvs,
                    "triangles": state.indices.map { Int($0) },
                    "vertices": spineVerts,
                    "hull": part.mesh?.hullCount ?? 4,
                    "width": Int(round(part.w * rigW)),
                    "height": Int(round(part.h * rigH))
                ]
            ]
        }

        // Bake animations at 24Hz
        var animsDict: [String: Any] = [:]
        for (clipName, clip) in project.animations {
            renderer.solver.resetSprings()
            let steps = max(2, Int(round(clip.duration * 24.0)))
            let dt = clip.duration / Float(steps)
            var boneCurves: [String: [String: [[String: Any]]]] = [:]
            for b in project.bones {
                boneCurves[b.name] = ["rotate": [], "translate": [], "scale": []]
            }

            for s in 0...steps {
                let t = round4(Float(s) * dt)
                let eval = renderer.solver.evaluateClip(name: clipName, at: t, dt: dt)
                for (bIdx, b) in project.bones.enumerated() {
                    let p = eval.poses[bIdx]
                    boneCurves[b.name]!["rotate"]!.append(["time": t, "value": round4(-p.r)])
                    boneCurves[b.name]!["translate"]!.append(["time": t, "x": round4(p.x), "y": round4(-p.y)])
                    boneCurves[b.name]!["scale"]!.append(["time": t, "x": round4(p.sx), "y": round4(p.sy)])
                }
            }
            animsDict[clipName] = ["bones": boneCurves]
        }

        return [
            "skeleton": [
                "hash": "sf-\(project.id)",
                "spine": "4.2.0",
                "x": round4(-rootPx),
                "y": round4(-(rigH - rootPy)),
                "width": project.width,
                "height": project.height,
                "fps": 24,
                "images": "./"
            ],
            "bones": bonesArr,
            "slots": slotsArr,
            "skins": [["name": "default", "attachments": attachmentsDict]],
            "animations": animsDict
        ]
    }

    private static func buildUnitySfRigDictionary(
        renderer: MetalRigRenderer,
        atlasW: Int,
        atlasH: Int,
        regions: [String: PackedAtlasRegionSwift]
    ) -> [String: Any] {
        let project = renderer.solver.project
        let ppu: Float = 100.0
        let rigW = Float(project.width)
        let rigH = Float(project.height)
        let rootBone = project.bones.first ?? SfBone(name: "root", x: 0.5, y: 0.975)
        let rootPx = rootBone.x * rigW
        let rootPy = rootBone.y * rigH

        func toUnityMeters(_ px: Float, _ py: Float) -> SIMD2<Float> {
            return SIMD2<Float>((px - rootPx) / ppu, (rootPy - py) / ppu)
        }

        let unityWorldPivots = project.bones.map { toUnityMeters($0.x * rigW, $0.y * rigH) }

        let bonesArr: [[String: Any]] = project.bones.enumerated().map { (i, b) in
            let pIdx = renderer.solver.parents[i]
            let w = unityWorldPivots[i]
            let pw = pIdx >= 0 ? unityWorldPivots[pIdx] : .zero
            return [
                "name": b.name,
                "parentIndex": pIdx,
                "localBindX": round4(w.x - pw.x),
                "localBindY": round4(w.y - pw.y),
                "worldBindX": round4(w.x),
                "worldBindY": round4(w.y),
                "length": round4(((b.length ?? 0.08) * rigH) / ppu)
            ]
        }

        let submeshesArr: [[String: Any]] = project.parts.compactMap { part in
            guard let state = renderer.parts[part.name] else { return nil }
            let reg = regions[part.name]?.uvRect ?? SIMD4<Float>(0, 0, 1, 1)
            var verts: [Float] = []
            var uvs: [Float] = []
            var boneIndices: [Int] = []
            var boneWeights: [Float] = []

            for v in state.vertices {
                let um = toUnityMeters(v.position.x, v.position.y)
                verts.append(round4(um.x))
                verts.append(round4(um.y))

                let au = reg.x + v.uv.x * (reg.z - reg.x)
                let av = reg.y + v.uv.y * (reg.w - reg.y)
                uvs.append(round4(au))
                uvs.append(round4(1.0 - av))

                for k in 0..<4 {
                    boneIndices.append(Int(v.joints[k]))
                    boneWeights.append(round4(v.weights[k]))
                }
            }

            var tris: [Int] = []
            let triCount = state.indices.count / 3
            for t in 0..<triCount {
                tris.append(Int(state.indices[t * 3]))
                tris.append(Int(state.indices[t * 3 + 2]))
                tris.append(Int(state.indices[t * 3 + 1]))
            }

            let primaryBone = renderer.solver.boneIndex[part.bone ?? part.skin?.first ?? "root"] ?? 0
            return [
                "name": part.name,
                "boneIndex": primaryBone,
                "isSkinned": (part.skin?.count ?? 0) > 1,
                "vertices": verts,
                "uvs": uvs,
                "boneIndices": boneIndices,
                "boneWeights": boneWeights,
                "triangles": tris
            ]
        }

        var animsArr: [[String: Any]] = []
        for (clipName, clip) in project.animations.sorted(by: { $0.key < $1.key }) {
            renderer.solver.resetSprings()
            let steps = max(2, Int(round(clip.duration * 24.0)))
            let dt = clip.duration / Float(steps)
            var keysPerBone: [[[String: Any]]] = Array(repeating: [], count: project.bones.count)
            var drawOrderKeys: [[String: Any]] = []
            var prevOrderSig = ""

            for s in 0...steps {
                let t = round4(Float(s) * dt)
                let eval = renderer.solver.evaluateClip(name: clipName, at: t, dt: dt)
                for bIdx in 0..<project.bones.count {
                    let p = eval.poses[bIdx]
                    keysPerBone[bIdx].append([
                        "time": t,
                        "r": round4(-p.r),
                        "dx": round4(p.x / ppu),
                        "dy": round4(-p.y / ppu),
                        "sx": round4(p.sx),
                        "sy": round4(p.sy)
                    ])
                }
                let sig = eval.drawOrder.joined(separator: ",")
                if sig != prevOrderSig {
                    prevOrderSig = sig
                    drawOrderKeys.append(["time": t, "order": eval.drawOrder])
                }
            }

            let boneTracks: [[String: Any]] = project.bones.enumerated().map { (bIdx, b) in
                [
                    "boneName": b.name,
                    "boneIndex": bIdx,
                    "keys": keysPerBone[bIdx]
                ]
            }

            animsArr.append([
                "name": clipName,
                "duration": clip.duration,
                "fps": clip.fps,
                "loop": clip.loop,
                "boneTracks": boneTracks,
                "drawOrderKeys": drawOrderKeys
            ])
        }

        return [
            "format": "SpineForgeUnityRig",
            "version": "1.0.0",
            "id": project.id,
            "title": project.title,
            "pixelsPerUnit": 100,
            "designWidth": project.width,
            "designHeight": project.height,
            "atlasPage": "\(project.id).png",
            "atlasWidth": atlasW,
            "atlasHeight": atlasH,
            "bones": bonesArr,
            "submeshes": submeshesArr,
            "animations": animsArr
        ]
    }

    private static func buildSpritesManifestDictionary(
        project: SfProject,
        sheetWidth: Int,
        sheetHeight: Int,
        cellHeight: Int,
        columns: Int,
        fps: Float
    ) -> [String: Any] {
        let spanW = Float(project.width) * (1.0 + project.frame.left + project.frame.right)
        let spanH = Float(project.height) * (1.0 + project.frame.top + (project.frame.bottom ?? 0.05))
        let cellWidth = max(32, Int(round(Float(cellHeight) * spanW / spanH)))

        var clipsMeta: [[String: Any]] = []
        var framesMeta: [[String: Any]] = []
        var globalFrame = 0

        for clipName in project.animations.keys.sorted() {
            guard let clip = project.animations[clipName] else { continue }
            let count = max(4, Int(round(clip.duration * fps)))
            let startFrame = globalFrame
            for i in 0..<count {
                let col = globalFrame % columns
                let row = globalFrame / columns
                let x = col * cellWidth
                let y = row * cellHeight
                framesMeta.append([
                    "clip": clipName,
                    "frameIndex": i,
                    "time": round4((Float(i) / Float(count)) * clip.duration),
                    "x": x,
                    "y": y,
                    "w": cellWidth,
                    "h": cellHeight,
                    "unityY": sheetHeight - y - cellHeight,
                    "pivotX": 0.5,
                    "pivotY": 0.05
                ])
                globalFrame += 1
            }
            clipsMeta.append([
                "name": clipName,
                "fps": fps,
                "loop": clip.loop,
                "startFrame": startFrame,
                "frameCount": count
            ])
        }

        return [
            "format": "SpineForgeSpriteSheet",
            "version": "1.0.0",
            "id": project.id,
            "texturePage": "\(project.id)-sheet.png",
            "sheetWidth": sheetWidth,
            "sheetHeight": sheetHeight,
            "cellWidth": cellWidth,
            "cellHeight": cellHeight,
            "columns": columns,
            "pixelsPerUnit": 100,
            "clips": clipsMeta,
            "frames": framesMeta
        ]
    }
}
