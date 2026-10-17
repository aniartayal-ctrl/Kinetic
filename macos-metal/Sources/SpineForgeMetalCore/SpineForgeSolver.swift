import Foundation
import simd

public struct BonePose2D {
    public var r: Float = 0
    public var x: Float = 0
    public var y: Float = 0
    public var sx: Float = 1
    public var sy: Float = 1

    public init(r: Float = 0, x: Float = 0, y: Float = 0, sx: Float = 1, sy: Float = 1) {
        self.r = r
        self.x = x
        self.y = y
        self.sx = sx
        self.sy = sy
    }
}

public struct Affine2D {
    public var a: Float
    public var b: Float
    public var c: Float
    public var d: Float
    public var tx: Float
    public var ty: Float

    public static let identity = Affine2D(a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0)

    public init(a: Float = 1, b: Float = 0, c: Float = 0, d: Float = 1, tx: Float = 0, ty: Float = 0) {
        self.a = a
        self.b = b
        self.c = c
        self.d = d
        self.tx = tx
        self.ty = ty
    }

    public func multiplied(by n: Affine2D) -> Affine2D {
        return Affine2D(
            a: a * n.a + c * n.b,
            b: b * n.a + d * n.b,
            c: a * n.c + c * n.d,
            d: b * n.c + d * n.d,
            tx: a * n.tx + c * n.ty + tx,
            ty: b * n.tx + d * n.ty + ty
        )
    }

    public func apply(_ p: SIMD2<Float>) -> SIMD2<Float> {
        return SIMD2<Float>(a * p.x + c * p.y + tx, b * p.x + d * p.y + ty)
    }

    public var worldAngleDeg: Float {
        return atan2(b, a) * 180.0 / .pi
    }
}

public struct SpringRuntimeState {
    public var angle: Float = 0
    public var velocity: Float = 0
    public var lastPos: SIMD2<Float>?
    public var lastVel: SIMD2<Float>?
    public var lastParentAngle: Float?
}

public final class SpineForgeSkeletonSolver {
    public var project: SfProject
    public private(set) var boneIndex: [String: Int] = [:]
    public private(set) var parents: [Int] = []
    public private(set) var pivots: [SIMD2<Float>] = []
    public private(set) var world: [Affine2D] = []
    public private(set) var gpuBones: [GpuBoneMatrix2D] = []
    public private(set) var springs: [SpringRuntimeState] = []

    public init(project: SfProject) {
        self.project = project
        rebuildHierarchy()
    }

    public func rebuildHierarchy() {
        boneIndex.removeAll()
        for (i, b) in project.bones.enumerated() {
            boneIndex[b.name] = i
        }
        let w = Float(project.width)
        let h = Float(project.height)
        parents = project.bones.map { b in
            if let p = b.parent, let idx = boneIndex[p] { return idx }
            return -1
        }
        pivots = project.bones.map { SIMD2<Float>($0.x * w, $0.y * h) }
        world = Array(repeating: .identity, count: project.bones.count)
        gpuBones = Array(repeating: GpuBoneMatrix2D(), count: max(64, project.bones.count))
        springs = Array(repeating: SpringRuntimeState(), count: project.bones.count)
    }

    public func resetSprings() {
        springs = Array(repeating: SpringRuntimeState(), count: project.bones.count)
    }

    private func computeWorld(poses: [BonePose2D]) {
        for i in 0..<parents.count {
            let pose = poses[i]
            let parent = parents[i]
            let pivot = pivots[i]
            let origin = parent < 0 ? SIMD2<Float>.zero : pivots[parent]
            let rad = pose.r * .pi / 180.0
            let cs = cos(rad)
            let sn = sin(rad)
            let local = Affine2D(
                a: cs * pose.sx,
                b: sn * pose.sx,
                c: -sn * pose.sy,
                d: cs * pose.sy,
                tx: pivot.x - origin.x + pose.x,
                ty: pivot.y - origin.y + pose.y
            )
            world[i] = parent < 0 ? local : world[parent].multiplied(by: local)
        }
    }

    private func solve2BoneIK(_ ik: SfIkConstraint, poses: inout [BonePose2D]) {
        guard ik.mix > 0.001, let targetIdx = boneIndex[ik.target] else { return }
        computeWorld(poses: poses)
        let tWorld = world[targetIdx]
        let tx = tWorld.tx
        let ty = tWorld.ty

        if ik.bones.count == 1, let bIdx = boneIndex[ik.bones[0]] {
            let w = world[bIdx]
            let desired = atan2(ty - w.ty, tx - w.tx) * 180.0 / .pi
            let current = w.worldAngleDeg
            let delta = fmod(desired - current + 540.0, 360.0) - 180.0
            poses[bIdx].r += delta * ik.mix
            computeWorld(poses: poses)
            return
        }

        guard ik.bones.count >= 2,
              let pIdx = boneIndex[ik.bones[0]],
              let cIdx = boneIndex[ik.bones[1]] else { return }

        let pBind = pivots[pIdx]
        let cBind = pivots[cIdx]
        let l1 = simd_distance(pBind, cBind)
        guard l1 > 1e-3 else { return }

        var l2 = (project.bones[cIdx].length ?? 0.12) * Float(project.height)
        var tipBindAngle = atan2(cBind.y - pBind.y, cBind.x - pBind.x)
        if let grandIdx = parents.firstIndex(of: cIdx) {
            let gBind = pivots[grandIdx]
            l2 = simd_distance(cBind, gBind)
            tipBindAngle = atan2(gBind.y - cBind.y, gBind.x - cBind.x)
        }

        let pWorld = world[pIdx]
        let dx = tx - pWorld.tx
        let dy = ty - pWorld.ty
        let dist = max(1e-3, min(l1 + l2 - 1e-3, hypot(dx, dy)))

        let bindUpperAngle = atan2(cBind.y - pBind.y, cBind.x - pBind.x)
        let bindBend = tipBindAngle - bindUpperAngle

        let cosAlpha = max(-1.0, min(1.0, (l1 * l1 + dist * dist - l2 * l2) / (2.0 * l1 * dist)))
        let alpha = acos(cosAlpha)
        let cosBeta = max(-1.0, min(1.0, (l1 * l1 + l2 * l2 - dist * dist) / (2.0 * l1 * l2)))
        let beta = acos(cosBeta)

        let sign: Float = ik.bendPositive ? 1.0 : -1.0
        let targetAngle = atan2(dy, dx)
        let desiredUpperWorldRad = targetAngle - sign * alpha
        let desiredLowerBendRad = sign * (.pi - beta)

        let parentOfUpper = parents[pIdx]
        let parentWorldRad = parentOfUpper >= 0 ? (world[parentOfUpper].worldAngleDeg * .pi / 180.0) : 0.0

        let solvedUpperR = (desiredUpperWorldRad - parentWorldRad - bindUpperAngle) * 180.0 / .pi
        let solvedLowerR = (desiredLowerBendRad - bindBend) * 180.0 / .pi

        func wrap180(_ deg: Float) -> Float {
            return fmod(deg + 540.0, 360.0) - 180.0
        }

        poses[pIdx].r += wrap180(solvedUpperR - poses[pIdx].r) * ik.mix
        poses[cIdx].r += wrap180(solvedLowerR - poses[cIdx].r) * ik.mix
        computeWorld(poses: poses)
    }

    public func evaluateClip(
        name clipName: String,
        at timestamp: Float,
        dt: Float = 1.0 / 60.0,
        manualPoseOverrides: [String: BonePose2D] = [:]
    ) -> (poses: [BonePose2D], drawOrder: [String], flash: Float, shake: Float) {
        let clip = project.animations[clipName]
        let duration = max(0.01, clip?.duration ?? 2.4)
        let t = (clip?.loop ?? true) ? fmod(fmod(timestamp, duration) + duration, duration) : max(0, min(duration, timestamp))

        let fx = sampleFx(clip?.fxTrack, time: t)
        let unit = Float(project.height) / 1000.0
        let shakePx = fx.shake * 5.0 * unit

        var poses = project.bones.enumerated().map { (idx, bone) -> BonePose2D in
            var p = sampleTrack(clip?.boneTracks[bone.name], time: t)
            if let ovr = manualPoseOverrides[bone.name] {
                p.r += ovr.r
                p.x += ovr.x
                p.y += ovr.y
            }
            if idx == 0 && shakePx > 0 {
                p.x += sin(t * 95.0) * shakePx
                p.y += cos(t * 77.0) * shakePx * 0.6
            }
            return p
        }

        for (i, bone) in project.bones.enumerated() {
            if let follow = bone.follow, let targetIdx = boneIndex[follow.bone] {
                poses[i].r += poses[targetIdx].r * follow.ratio
            }
            if bone.spring != nil {
                poses[i].r += springs[i].angle
            }
        }

        computeWorld(poses: poses)

        for ik in project.ikConstraints {
            solve2BoneIK(ik, poses: &poses)
        }

        for i in 0..<project.bones.count {
            let p = pivots[i]
            let m = world[i].multiplied(by: Affine2D(a: 1, b: 0, c: 0, d: 1, tx: -p.x, ty: -p.y))
            gpuBones[i] = GpuBoneMatrix2D(a: m.a, b: m.b, c: m.c, d: m.d, tx: m.tx, ty: m.ty)
        }

        if dt > 1e-5 {
            stepSprings(time: t, dt: min(dt, 1.0 / 20.0))
        }

        // Dynamic draw order swaps
        var order = project.parts.map { $0.name }
        for part in project.parts {
            guard let swap = part.swap, let bIdx = boneIndex[swap.bone] else { continue }
            let r = poses[bIdx].r
            let active = swap.beyond >= 0 ? (r > swap.beyond) : (r < swap.beyond)
            if active {
                if let curIdx = order.firstIndex(of: part.name) {
                    order.remove(at: curIdx)
                }
                if let beforeIdx = order.firstIndex(of: swap.before) {
                    order.insert(part.name, at: beforeIdx)
                } else {
                    order.append(part.name)
                }
            }
        }

        return (poses, order, fx.flash, fx.shake)
    }

    private func stepSprings(time: Float, dt: Float) {
        let unit = Float(project.height) / 1000.0
        let scale = 1.0 / max(1.0, 1000.0 * unit)

        for (i, bone) in project.bones.enumerated() {
            guard let sp = bone.spring else { continue }
            let parent = parents[i]
            let m = world[i]
            let pos = SIMD2<Float>(m.tx, m.ty)
            let parentAngle = parent >= 0 ? world[parent].worldAngleDeg : 0

            let vel = springs[i].lastPos != nil ? (pos - springs[i].lastPos!) / dt : .zero
            let acc = springs[i].lastVel != nil ? (vel - springs[i].lastVel!) / dt : .zero
            let spin = springs[i].lastParentAngle != nil ? (parentAngle - springs[i].lastParentAngle!) / dt : 0

            springs[i].lastPos = pos
            springs[i].lastVel = vel
            springs[i].lastParentAngle = parentAngle

            let gx = sp.gain.count > 0 ? sp.gain[0] : 6.0
            let gy = sp.gain.count > 1 ? sp.gain[1] : 3.0
            let wind = (sp.wind ?? 0) * (sin(time * 1.3 + Float(i)) * 0.7 + sin(time * 2.9 + Float(i * 2)) * 0.3)
            let target = max(-14.0, min(14.0, acc.x * scale * gx + acc.y * scale * gy)) + wind
            let force = sp.stiffness * (target - springs[i].angle) - sp.damping * springs[i].velocity - spin * 0.02
            springs[i].velocity += force * dt
            springs[i].angle = max(-18.0, min(18.0, springs[i].angle + springs[i].velocity * dt))
        }
    }

    public func sampleTrack(_ track: [SfTransformKey]?, time: Float) -> BonePose2D {
        guard let track = track, !track.isEmpty else { return BonePose2D() }
        if time <= track[0].time {
            let k = track[0]
            return BonePose2D(r: k.r ?? 0, x: k.x ?? 0, y: k.y ?? 0, sx: k.sx ?? 1, sy: k.sy ?? 1)
        }
        if let last = track.last, time >= last.time {
            return BonePose2D(r: last.r ?? 0, x: last.x ?? 0, y: last.y ?? 0, sx: last.sx ?? 1, sy: last.sy ?? 1)
        }
        var idx = 0
        for i in 0..<(track.count - 1) {
            if time >= track[i].time && time <= track[i + 1].time {
                idx = i
                break
            }
        }
        let k0 = track[idx]
        let k1 = track[idx + 1]
        let span = max(1e-5, k1.time - k0.time)
        let u = max(0, min(1, (time - k0.time) / span))
        // Smoothstep easing approximation
        let a = u * u * (3.0 - 2.0 * u)
        func lerp(_ v0: Float, _ v1: Float) -> Float { v0 + (v1 - v0) * a }
        return BonePose2D(
            r: lerp(k0.r ?? 0, k1.r ?? 0),
            x: lerp(k0.x ?? 0, k1.x ?? 0),
            y: lerp(k0.y ?? 0, k1.y ?? 0),
            sx: lerp(k0.sx ?? 1, k1.sx ?? 1),
            sy: lerp(k0.sy ?? 1, k1.sy ?? 1)
        )
    }

    private func sampleFx(_ track: [SfFxKey]?, time: Float) -> (flash: Float, shake: Float) {
        guard let track = track, !track.isEmpty else { return (0, 0) }
        if time <= track[0].time { return (track[0].flash ?? 0, track[0].shake ?? 0) }
        if let last = track.last, time >= last.time { return (last.flash ?? 0, last.shake ?? 0) }
        var idx = 0
        for i in 0..<(track.count - 1) {
            if time >= track[i].time && time <= track[i + 1].time {
                idx = i
                break
            }
        }
        let k0 = track[idx]
        let k1 = track[idx + 1]
        let a = max(0, min(1, (time - k0.time) / max(1e-5, k1.time - k0.time)))
        return (
            (k0.flash ?? 0) + ((k1.flash ?? 0) - (k0.flash ?? 0)) * a,
            (k0.shake ?? 0) + ((k1.shake ?? 0) - (k0.shake ?? 0)) * a
        )
    }
}
