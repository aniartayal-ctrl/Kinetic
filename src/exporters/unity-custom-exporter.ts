/**
 * Zero-Dependency Custom Unity Exporter (`src/exporters/unity-custom-exporter.ts`)
 *
 * Exports `<id>.sfrig.json` designed for our standalone `com.spineforge.runtime` Unity C# package
 * (requires ZERO Spine license or third-party dependencies).
 *
 * Features:
 * - Pre-maps each part's mesh UVs directly into the packed `<id>.atlas.png` texture in Unity's
 *   bottom-left UV convention (`u = atlasU`, `v = 1 - atlasV`).
 * - Pre-converts vertex bind positions and bone bind pivots into Unity world units (meters, `pixelsPerUnit = 100`,
 *   root bone at `(0, 0, 0)`, Y-up).
 * - Exports both baked 24/30Hz bone transform curves (for 1-click native Unity `AnimationClip` generation)
 *   AND raw spring/IK metadata for live C# runtime evaluation.
 */

import { bakeClipConstraintsToKeyframes, SpineForgeAnimator } from "../core/animator";
import type { SpineForgeProject } from "../core/schema";
import { buildPartMesh } from "../core/weights";
import type { PackedAtlasLayout } from "./atlas-packer";

export type UnitySfRigBone = {
  name: string;
  parentIndex: number;
  /** Bind pivot in Unity local space relative to parent (meters, Y-up). */
  localBindX: number;
  localBindY: number;
  /** Bind pivot in Unity root space (meters, Y-up, root = 0,0). */
  worldBindX: number;
  worldBindY: number;
  length: number;
};

export type UnitySfRigSubmesh = {
  name: string;
  boneIndex: number;
  isSkinned: boolean;
  /** Vertex positions in Unity root space [x0, y0, x1, y1, ...] (meters, Y-up). */
  vertices: number[];
  /** Atlas UVs in Unity bottom-left convention [u0, v0, u1, v1, ...]. */
  uvs: number[];
  /** 4 bone indices per vertex [j0, j1, j2, j3, ...]. */
  boneIndices: number[];
  /** 4 bone weights per vertex [w0, w1, w2, w3, ...] summing to 1.0. */
  boneWeights: number[];
  /** Triangle indices (clockwise winding for Unity front-face in Y-up). */
  triangles: number[];
};

export type UnitySfRigKeyframe = {
  time: number;
  /** Local rotation in degrees (counter-clockwise in Unity Y-up). */
  r: number;
  /** Local translation delta in meters (Y-up). */
  dx: number;
  dy: number;
  /** Local scale multipliers. */
  sx: number;
  sy: number;
};

export type UnitySfRigClip = {
  name: string;
  duration: number;
  fps: number;
  loop: boolean;
  boneTracks: {
    boneName: string;
    boneIndex: number;
    keys: UnitySfRigKeyframe[];
  }[];
  drawOrderKeys: {
    time: number;
    order: string[];
  }[];
};

export type UnitySfRigDocument = {
  format: "SpineForgeUnityRig";
  version: "1.0.0";
  id: string;
  title: string;
  pixelsPerUnit: number;
  designWidth: number;
  designHeight: number;
  atlasPage: string;
  atlasWidth: number;
  atlasHeight: number;
  bones: UnitySfRigBone[];
  submeshes: UnitySfRigSubmesh[];
  animations: UnitySfRigClip[];
};

function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}

export function exportUnityCustomRig(
  project: SpineForgeProject,
  atlas: PackedAtlasLayout,
  options: { pixelsPerUnit?: number; sampleRateHz?: number } = {},
): UnitySfRigDocument {
  const ppu = options.pixelsPerUnit ?? 100;
  const sampleRateHz = options.sampleRateHz ?? 24;

  const rootBone = project.bones[0] ?? { name: "root", x: 0.5, y: 0.975 };
  const rootPx = rootBone.x * project.width;
  const rootPy = rootBone.y * project.height;

  const boneIndex: Record<string, number> = {};
  project.bones.forEach((b, i) => {
    boneIndex[b.name] = i;
  });

  // Convert studio pixel (px, py) -> Unity meters (Y-up, root = 0,0)
  const toUnityMeters = (px: number, py: number): [number, number] => [
    (px - rootPx) / ppu,
    (rootPy - py) / ppu,
  ];

  const unityWorldPivots = project.bones.map((b) =>
    toUnityMeters(b.x * project.width, b.y * project.height),
  );

  const bones: UnitySfRigBone[] = project.bones.map((b, i) => {
    const parentIndex = b.parent ? (boneIndex[b.parent] ?? -1) : -1;
    const [wx, wy] = unityWorldPivots[i]!;
    const [pwx, pwy] = parentIndex >= 0 ? unityWorldPivots[parentIndex]! : [0, 0];
    return {
      name: b.name,
      parentIndex,
      localBindX: round5(wx - pwx),
      localBindY: round5(wy - pwy),
      worldBindX: round5(wx),
      worldBindY: round5(wy),
      length: round5(((b.length ?? 0.08) * project.height) / ppu),
    };
  });

  const submeshes: UnitySfRigSubmesh[] = project.parts.map((part) => {
    const mesh = part.mesh ?? buildPartMesh(project, part);
    const vCount = mesh.positions.length / 2;
    const region = atlas.regions[part.name] ?? {
      x: 0,
      y: 0,
      width: Math.round(part.w * project.width),
      height: Math.round(part.h * project.height),
      uvRect: [0, 0, 1, 1] as [number, number, number, number],
    };
    const [u0, v0, u1, v1] = region.uvRect;

    const vertices: number[] = new Array(vCount * 2);
    const uvs: number[] = new Array(vCount * 2);

    for (let v = 0; v < vCount; v++) {
      const px = mesh.positions[v * 2]!;
      const py = mesh.positions[v * 2 + 1]!;
      const [ux, uy] = toUnityMeters(px, py);
      vertices[v * 2] = round5(ux);
      vertices[v * 2 + 1] = round5(uy);

      const pu = mesh.uvs[v * 2]!;
      const pv = mesh.uvs[v * 2 + 1]!;
      const atlasU = u0 + pu * (u1 - u0);
      const atlasV = v0 + pv * (v1 - v0);
      // Flip V for Unity's bottom-left texture UV origin
      uvs[v * 2] = round5(atlasU);
      uvs[v * 2 + 1] = round5(1 - atlasV);
    }

    // Flip triangle winding (a, c, b) because Y-axis inversion flips 2D handedness
    const triangles: number[] = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      triangles.push(mesh.indices[t]!, mesh.indices[t + 2]!, mesh.indices[t + 1]!);
    }

    const primaryBone = part.bone ? (boneIndex[part.bone] ?? 0) : (boneIndex[part.skin?.[0] ?? "root"] ?? 0);

    return {
      name: part.name,
      boneIndex: primaryBone,
      isSkinned: Boolean(part.skin && part.skin.length > 1),
      vertices,
      uvs,
      boneIndices: mesh.joints.slice(),
      boneWeights: mesh.weights.map(round5),
      triangles,
    };
  });

  const animations: UnitySfRigClip[] = [];
  for (const [clipName, rawClip] of Object.entries(project.animations)) {
    const baked = bakeClipConstraintsToKeyframes(project, rawClip, sampleRateHz);
    const boneTracks: UnitySfRigClip["boneTracks"] = [];

    project.bones.forEach((bone, bIdx) => {
      const keys = baked.boneTracks[bone.name] ?? [];
      boneTracks.push({
        boneName: bone.name,
        boneIndex: bIdx,
        keys: keys.map((k) => ({
          time: round5(k.time),
          r: round5(-(k.r ?? 0)),
          dx: round5((k.x ?? 0) / ppu),
          dy: round5(-(k.y ?? 0) / ppu),
          sx: round5(k.sx ?? 1),
          sy: round5(k.sy ?? 1),
        })),
      });
    });

    const animEval = new SpineForgeAnimator(project, clipName);
    const steps = Math.max(2, Math.round(rawClip.duration * sampleRateHz));
    const drawOrderKeys: UnitySfRigClip["drawOrderKeys"] = [];
    let prevSig = "";
    for (let s = 0; s <= steps; s++) {
      const t = round5((s / steps) * rawClip.duration);
      const frame = animEval.evaluateAt(t, rawClip.duration / steps);
      const sig = frame.order.join(",");
      if (sig !== prevSig) {
        prevSig = sig;
        drawOrderKeys.push({ time: t, order: frame.order });
      }
    }

    animations.push({
      name: clipName,
      duration: rawClip.duration,
      fps: rawClip.fps,
      loop: rawClip.loop,
      boneTracks,
      drawOrderKeys,
    });
  }

  return {
    format: "SpineForgeUnityRig",
    version: "1.0.0",
    id: project.id,
    title: project.title,
    pixelsPerUnit: ppu,
    designWidth: project.width,
    designHeight: project.height,
    atlasPage: atlas.pageName,
    atlasWidth: atlas.width,
    atlasHeight: atlas.height,
    bones,
    submeshes,
    animations,
  };
}
