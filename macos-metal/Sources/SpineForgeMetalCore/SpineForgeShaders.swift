import Foundation
import simd

/// Apple Metal Shading Language (MSL) source compiled directly on the Apple Silicon GPU via `MTLDevice.makeLibrary(source:options:)`.
/// Includes:
/// 1. `vertex_skin_2d`: 4-bone Linear Blend Skinning (LBS) + Free-Form Deformation (FFD) + Heatmap interpolation
/// 2. `fragment_rig_2d`: Premultiplied texture sampling + directional rim light + additive flash + GPU weight heatmap overlay
/// 3. `vertex_gizmo_2d` / `fragment_gizmo_2d`: Hardware-accelerated wireframe, bone hierarchy, IK handle, and brush ring overlay
/// 4. `compute_auto_weights`: Parallel GPU Compute Kernel for capsule-envelope + geodesic inverse-distance weight solving
public enum SpineForgeMetalShaders {
    public static let mslSource = """
    #include <metal_stdlib>
    using namespace metal;

    struct RigVertexIn {
        float2 position [[attribute(0)]];
        float2 deform   [[attribute(1)]];
        float2 uv       [[attribute(2)]];
        uint4  joints   [[attribute(3)]];
        float4 weights  [[attribute(4)]];
        float4 heat     [[attribute(5)]];
    };

    struct BoneMatrix2D {
        // [a, b, c, d] in col01, [tx, ty, 0, 0] in trans
        float4 col01;
        float4 trans;
    };

    struct ViewUniforms {
        // x = scaleX, y = scaleY, z = offsetX, w = offsetY in clip space
        float4 viewTransform;
        float3 rimColor;
        float  flashIntensity;
        float3 flashTint;
        float  heatmapMix;
        float2 texelSize;
        float  partOpacity;
        float  rimAmount;
    };

    struct RigVertexOut {
        float4 position [[position]];
        float2 uv;
        float4 heat;
    };

    inline float2 applyBone(constant BoneMatrix2D &bm, float2 p) {
        float4 m = bm.col01;
        float2 t = bm.trans.xy;
        return float2(m.x * p.x + m.z * p.y + t.x,
                      m.y * p.x + m.w * p.y + t.y);
    }

    vertex RigVertexOut vertex_skin_2d(
        RigVertexIn in [[stage_in]],
        constant BoneMatrix2D *bones [[buffer(1)]],
        constant ViewUniforms &u [[buffer(2)]]
    ) {
        float2 basePos = in.position + in.deform;
        float2 skinned = applyBone(bones[in.joints.x], basePos) * in.weights.x
                       + applyBone(bones[in.joints.y], basePos) * in.weights.y
                       + applyBone(bones[in.joints.z], basePos) * in.weights.z
                       + applyBone(bones[in.joints.w], basePos) * in.weights.w;

        RigVertexOut out;
        float4 vt = u.viewTransform;
        out.position = float4(skinned.x * vt.x + vt.z,
                              skinned.y * vt.y + vt.w,
                              0.0, 1.0);
        out.uv = in.uv;
        out.heat = in.heat;
        return out;
    }

    fragment float4 fragment_rig_2d(
        RigVertexOut in [[stage_in]],
        texture2d<float> tex [[texture(0)]],
        sampler samp [[sampler(0)]],
        constant ViewUniforms &u [[buffer(2)]]
    ) {
        float4 c = tex.sample(samp, in.uv);
        // Premultiplied alpha conversion if texture was loaded straight
        float a = c.a;
        if (a < 0.004) {
            discard_fragment();
        }
        float3 rgb = c.rgb * a;

        // Directional rim highlight
        float neighborA = tex.sample(samp, in.uv + u.texelSize * float2(-3.0, -3.0)).a;
        float rim = clamp(a - neighborA, 0.0, 1.0) * u.rimAmount;
        rgb += u.rimColor * rim * (0.55 + u.flashIntensity);

        // Power flash tint
        rgb += u.flashTint * u.flashIntensity * 0.28 * a;

        // Live GPU weight heatmap overlay
        if (u.heatmapMix > 0.01) {
            float3 heatPremult = in.heat.rgb * a;
            rgb = mix(rgb, heatPremult, u.heatmapMix * in.heat.a);
        }

        rgb = min(rgb, float3(a));
        return float4(rgb * u.partOpacity, a * u.partOpacity);
    }

    // --- Hardware Gizmo Overlay Shaders (Wireframe, Bones, IK Diamonds, Weight Brush) ---
    struct GizmoVertexIn {
        float2 position [[attribute(0)]];
        float4 color    [[attribute(1)]];
    };

    struct GizmoVertexOut {
        float4 position [[position]];
        float4 color;
        float  pointSize [[point_size]];
    };

    vertex GizmoVertexOut vertex_gizmo_2d(
        GizmoVertexIn in [[stage_in]],
        constant ViewUniforms &u [[buffer(1)]]
    ) {
        GizmoVertexOut out;
        float4 vt = u.viewTransform;
        out.position = float4(in.position.x * vt.x + vt.z,
                              in.position.y * vt.y + vt.w,
                              0.0, 1.0);
        out.color = in.color;
        out.pointSize = 8.0;
        return out;
    }

    fragment float4 fragment_gizmo_2d(GizmoVertexOut in [[stage_in]]) {
        return float4(in.color.rgb * in.color.a, in.color.a);
    }

    // --- Apple Metal Compute Shader: Parallel GPU Capsule + Geodesic Auto-Weight Solver ---
    struct GpuCapsule {
        float2 a;
        float2 b;
        float  radius;
        float  feather;
        uint   boneIndex;
        uint   padding;
    };

    struct WeightComputeParams {
        uint vertexCount;
        uint capsuleCount;
        uint fallbackBoneIndex;
        uint mode; // 0 = hybrid capsule, 1 = inverse-distance heat
    };

    inline float gpuCapsuleDist(float2 p, float2 a, float2 b) {
        float2 ab = b - a;
        float lenSq = dot(ab, ab);
        float t = (lenSq < 1e-6) ? 0.0 : clamp(dot(p - a, ab) / lenSq, 0.0, 1.0);
        return length(p - (a + ab * t));
    }

    inline float gpuSmoothstep(float edge0, float edge1, float x) {
        float t = clamp((x - edge0) / max(1e-5, edge1 - edge0), 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
    }

    kernel void compute_auto_weights(
        device const float2 *positions [[buffer(0)]],
        device const GpuCapsule *capsules [[buffer(1)]],
        constant WeightComputeParams &params [[buffer(2)]],
        device uint4 *outJoints [[buffer(3)]],
        device float4 *outWeights [[buffer(4)]],
        uint gid [[thread_position_in_grid]]
    ) {
        if (gid >= params.vertexCount) return;
        float2 p = positions[gid];

        // Accumulate per-bone strength (up to 32 bones)
        float raw[32];
        for (uint i = 0; i < 32; ++i) raw[i] = 0.0;

        float total = 0.0;
        for (uint c = 0; c < params.capsuleCount; ++c) {
            GpuCapsule cap = capsules[c];
            float d = gpuCapsuleDist(p, cap.a, cap.b);
            float w = 0.0;
            if (params.mode == 1) {
                float normD = d / max(1.0, cap.radius);
                w = 1.0 / pow(normD * normD + 0.08, 1.75);
            } else {
                w = 1.0 - gpuSmoothstep(cap.radius, cap.radius + cap.feather, d);
            }
            if (cap.boneIndex < 32) {
                raw[cap.boneIndex] = max(raw[cap.boneIndex], w);
            }
        }

        for (uint b = 0; b < 32; ++b) {
            if (b != params.fallbackBoneIndex) {
                total += raw[b];
            }
        }

        if (params.mode == 0) {
            if (total > 1.0) {
                for (uint b = 0; b < 32; ++b) raw[b] /= total;
            } else if (params.fallbackBoneIndex < 32) {
                raw[params.fallbackBoneIndex] += (1.0 - total);
            }
        }

        // Select top 4 bones and normalize
        uint4 topJ = uint4(params.fallbackBoneIndex, 0, 0, 0);
        float4 topW = float4(0.0);

        for (int k = 0; k < 4; ++k) {
            float bestW = -1.0;
            uint bestB = 0;
            for (uint b = 0; b < 32; ++b) {
                if (raw[b] > bestW) {
                    bestW = raw[b];
                    bestB = b;
                }
            }
            if (bestW > 1e-6) {
                topJ[k] = bestB;
                topW[k] = bestW;
                raw[bestB] = -1.0;
            }
        }

        float sum = topW.x + topW.y + topW.z + topW.w;
        if (sum > 1e-6) {
            topW /= sum;
        } else {
            topJ = uint4(params.fallbackBoneIndex, 0, 0, 0);
            topW = float4(1.0, 0.0, 0.0, 0.0);
        }

        outJoints[gid] = topJ;
        outWeights[gid] = topW;
    }
    """
}
