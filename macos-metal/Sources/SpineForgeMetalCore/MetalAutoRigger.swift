import Foundation
import Vision
import AppKit
import CoreGraphics

/// Uses Apple's native `Vision` framework (`VNDetectHumanBodyPoseRequest`) on the Neural Engine / Metal GPU
/// combined with part bounding-box geometry to perform 1-Click AI Auto-Rigging in macOS `Kinetic Pro.app`.
public enum MetalAutoRigger {

    public static func detectHumanPoseLandmarks(in imageURL: URL) -> [VNHumanBodyPoseObservation.JointName: SIMD2<Float>] {
        guard let nsImg = NSImage(contentsOf: imageURL),
              let cgImg = nsImg.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            return [:]
        }

        let request = VNDetectHumanBodyPoseRequest()
        let handler = VNImageRequestHandler(cgImage: cgImg, options: [:])
        try? handler.perform([request])

        guard let obs = request.results?.first else { return [:] }
        var out: [VNHumanBodyPoseObservation.JointName: SIMD2<Float>] = [:]
        if let pts = try? obs.recognizedPoints(.all) {
            for (joint, pt) in pts where pt.confidence > 0.25 {
                // Vision coordinates have bottom-left origin; flip Y to top-left [0..1]
                out[joint] = SIMD2<Float>(Float(pt.location.x), Float(1.0 - pt.location.y))
            }
        }
        return out
    }

    /// Refines bone pivots using Apple Vision `VNDetectHumanBodyPoseRequest` + part bounds,
    /// rebuilds high-density Delaunay meshes, dispatches Metal Compute auto-weights, and synthesizes all 6 clips.
    public static func autoRigOnAppleSilicon(renderer: MetalRigRenderer) -> String {
        var project = renderer.solver.project
        let heroURL = renderer.publicRootURL.appendingPathComponent(
            project.src.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        )
        let visionJoints = detectHumanPoseLandmarks(in: heroURL)

        if let neck = visionJoints[.neck],
           let idx = project.bones.firstIndex(where: { $0.name == "head" }) {
            project.bones[idx].x = neck.x
            project.bones[idx].y = neck.y
        }
        if let root = visionJoints[.root],
           let idx = project.bones.firstIndex(where: { $0.name == "hips" }) {
            project.bones[idx].x = root.x
            project.bones[idx].y = root.y
        }
        if let rShoulder = visionJoints[.rightShoulder],
           let idx = project.bones.firstIndex(where: { $0.name == "arm" }) {
            project.bones[idx].x = rShoulder.x
            project.bones[idx].y = rShoulder.y
        }
        if let rElbow = visionJoints[.rightElbow],
           let idx = project.bones.firstIndex(where: { $0.name == "forearm" }) {
            project.bones[idx].x = rElbow.x
            project.bones[idx].y = rElbow.y
        }

        renderer.solver.project = project
        renderer.solver.rebuildHierarchy()

        // Regenerate Delaunay meshes & dispatch Metal Compute auto-weights on all skinned parts
        var totalVerts = 0
        for part in project.parts {
            renderer.regeneratePartMeshOnMetal(
                partName: part.name,
                density: "high",
                weightMode: 0,
                selectedBoneForHeatmap: -1
            )
            totalVerts += renderer.parts[part.name]?.vertexCount ?? 0
        }

        renderer.solver.project.animations = MetalMeshAndClipsGenerator.generateProceduralClips(for: renderer.solver.project)
        return "AI Auto-Rigger (Apple Vision + Metal Compute): Solved \(project.bones.count) bones, \(totalVerts) Delaunay vertices & 6 clips"
    }
}
