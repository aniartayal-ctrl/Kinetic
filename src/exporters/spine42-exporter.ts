/**
 * Spine 4.2 JSON Exporter (`src/exporters/spine42-exporter.ts`)
 *
 * Exports a `SpineForgeProject` into a 100% standards-compliant Spine 4.2 `.json` skeleton file:
 * - Converts studio top-left Y-down pixel coordinates to Spine Y-up local bone space (root origin = 0,0)
 * - Encodes weighted `mesh` attachments in Spine's exact vertex format:
 *   `[boneCount, boneIndex0, localBindX0, localBindY0, weight0, ...]`
 * - Bakes spring physics (`bone.spring`) and `follow` constraints into explicit keyframe tracks
 * - Exports `ik` constraints, `deform` FFD timelines, and `drawOrder` swap timelines
 */

import { bakeClipConstraintsToKeyframes, SpineForgeAnimator } from "../core/animator";
import type { AnimationClip, SpineForgeProject } from "../core/schema";
import { buildPartMesh } from "../core/weights";

export type Spine42BoneJson = {
  name: string;
  parent?: string;
  length?: number;
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  color?: string;
};

export type Spine42SlotJson = {
  name: string;
  bone: string;
  attachment: string;
  blend?: "normal" | "additive" | "multiply" | "screen";
};

export type Spine42MeshAttachmentJson = {
  type: "mesh";
  name: string;
  path: string;
  uvs: number[];
  triangles: number[];
  vertices: number[];
  hull: number;
  width: number;
  height: number;
};

export type Spine42Json = {
  skeleton: {
    hash: string;
    spine: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fps: number;
    images: string;
  };
  bones: Spine42BoneJson[];
  slots: Spine42SlotJson[];
  ik?: {
    name: string;
    bones: string[];
    target: string;
    bendPositive: boolean;
    mix: number;
  }[];
  skins: {
    name: string;
    attachments: Record<string, Record<string, Spine42MeshAttachmentJson>>;
  }[];
  events?: Record<string, { int?: number; float?: number; string?: string }>;
  animations: Record<
    string,
    {
      bones?: Record<
        string,
        {
          rotate?: { time: number; value?: number; curve?: "stepped" | number[] }[];
          translate?: { time: number; x?: number; y?: number; curve?: "stepped" | number[] }[];
          scale?: { time: number; x?: number; y?: number; curve?: "stepped" | number[] }[];
        }
      >;
      deform?: Record<string, Record<string, Record<string, { time: number; vertices: number[] }[]>>>;
      drawOrder?: { time: number; offsets?: { slot: string; offset: number }[] }[];
      events?: { time: number; name: string; int?: number; float?: number; string?: string }[];
    }
  >;
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Converts a studio pixel point `(px, py)` (Y-down, top-left origin) into Spine world space (Y-up, root bone = 0,0).
 */
function studioToSpineWorld(px: number, py: number, rootPx: number, rootPy: number): [number, number] {
  return [px - rootPx, rootPy - py];
}

export function exportSpine42Json(
  project: SpineForgeProject,
  options: { bakeSprings?: boolean; sampleRateHz?: number } = {},
): Spine42Json {
  const bakeSprings = options.bakeSprings ?? true;
  const sampleRateHz = options.sampleRateHz ?? 24;

  const rootBone = project.bones[0] ?? { name: "root", x: 0.5, y: 0.975 };
  const rootPx = rootBone.x * project.width;
  const rootPy = rootBone.y * project.height;

  const boneIndex: Record<string, number> = {};
  project.bones.forEach((b, i) => {
    boneIndex[b.name] = i;
  });

  // Compute Spine world bind position for each bone (with bind rotation = 0 so local space is simple translation offset)
  const boneSpineWorld: [number, number][] = project.bones.map((b) =>
    studioToSpineWorld(b.x * project.width, b.y * project.height, rootPx, rootPy),
  );

  const spineBones: Spine42BoneJson[] = project.bones.map((b, i) => {
    const [wx, wy] = boneSpineWorld[i]!;
    const pIdx = b.parent ? (boneIndex[b.parent] ?? -1) : -1;
    const [pwx, pwy] = pIdx >= 0 ? boneSpineWorld[pIdx]! : [0, 0];
    return {
      name: b.name,
      ...(b.parent ? { parent: b.parent } : {}),
      length: round4((b.length ?? 0.08) * project.height),
      x: round4(wx - pwx),
      y: round4(wy - pwy),
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      ...(b.color ? { color: b.color.replace("#", "") + "ff" } : {}),
    };
  });

  const spineSlots: Spine42SlotJson[] = project.parts.map((part) => {
    const slotBone = part.bone ?? part.skin?.[0] ?? rootBone.name;
    return {
      name: part.name,
      bone: slotBone,
      attachment: part.name,
      ...(part.blendMode && part.blendMode !== "normal" ? { blend: part.blendMode } : {}),
    };
  });

  const attachments: Record<string, Record<string, Spine42MeshAttachmentJson>> = {};

  for (const part of project.parts) {
    const mesh = part.mesh ?? buildPartMesh(project, part);
    const vCount = mesh.positions.length / 2;
    const isWeighted = Boolean(part.skin && part.skin.length > 1);
    const singleBoneIdx = part.bone ? (boneIndex[part.bone] ?? 0) : (boneIndex[part.skin?.[0] ?? "root"] ?? 0);

    const spineVertices: number[] = [];
    for (let v = 0; v < vCount; v++) {
      const px = mesh.positions[v * 2]!;
      const py = mesh.positions[v * 2 + 1]!;
      const [wx, wy] = studioToSpineWorld(px, py, rootPx, rootPy);

      if (!isWeighted) {
        // Unweighted mesh: [localX, localY, ...] relative to the slot's bone
        const [bx, by] = boneSpineWorld[singleBoneIdx]!;
        spineVertices.push(round4(wx - bx), round4(wy - by));
      } else {
        // Weighted Spine mesh format: [boneCount, boneIdx0, bindLocalX0, bindLocalY0, weight0, ...]
        const active: { b: number; lx: number; ly: number; w: number }[] = [];
        for (let k = 0; k < 4; k++) {
          const b = mesh.joints[v * 4 + k]!;
          const w = mesh.weights[v * 4 + k]!;
          if (w > 1e-5) {
            const [bx, by] = boneSpineWorld[b] ?? [0, 0];
            active.push({
              b,
              lx: round4(wx - bx),
              ly: round4(wy - by),
              w: round4(w),
            });
          }
        }
        if (active.length === 0) {
          const [bx, by] = boneSpineWorld[0]!;
          active.push({ b: 0, lx: round4(wx - bx), ly: round4(wy - by), w: 1 });
        }
        spineVertices.push(active.length);
        for (const inf of active) {
          spineVertices.push(inf.b, inf.lx, inf.ly, inf.w);
        }
      }
    }

    attachments[part.name] = {
      [part.name]: {
        type: "mesh",
        name: part.name,
        path: part.name,
        uvs: mesh.uvs.map(round4),
        triangles: mesh.indices.slice(),
        vertices: spineVertices,
        hull: mesh.hullCount,
        width: Math.round(part.w * project.width),
        height: Math.round(part.h * project.height),
      },
    };
  }

  // Export animations
  const animationsJson: Spine42Json["animations"] = {};
  const baseOrder = project.parts.map((p) => p.name);

  for (const [clipName, rawClip] of Object.entries(project.animations)) {
    const clip: AnimationClip = bakeSprings
      ? bakeClipConstraintsToKeyframes(project, rawClip, sampleRateHz)
      : rawClip;

    const bonesAnim: NonNullable<Spine42Json["animations"][string]["bones"]> = {};

    for (const [boneName, keys] of Object.entries(clip.boneTracks)) {
      if (!keys || keys.length === 0) continue;
      // Skip completely static tracks
      const hasMotion = keys.some(
        (k) =>
          Math.abs(k.r ?? 0) > 1e-3 ||
          Math.abs(k.x ?? 0) > 1e-3 ||
          Math.abs(k.y ?? 0) > 1e-3 ||
          Math.abs((k.sx ?? 1) - 1) > 1e-4 ||
          Math.abs((k.sy ?? 1) - 1) > 1e-4,
      );
      if (!hasMotion) continue;

      // Studio rotation is clockwise (Y-down); Spine rotation is counter-clockwise (Y-up) => negate r and y
      const rotate = keys.map((k) => ({
        time: round4(k.time),
        value: round4(-(k.r ?? 0)),
      }));
      const translate = keys.map((k) => ({
        time: round4(k.time),
        x: round4(k.x ?? 0),
        y: round4(-(k.y ?? 0)),
      }));
      const scale = keys.map((k) => ({
        time: round4(k.time),
        x: round4(k.sx ?? 1),
        y: round4(k.sy ?? 1),
      }));

      bonesAnim[boneName] = { rotate, translate, scale };
    }

    // Export dynamic drawOrder swaps along the clip timeline
    const drawOrderTimeline: NonNullable<Spine42Json["animations"][string]["drawOrder"]> = [];
    const animEvaluator = new SpineForgeAnimator(project, clipName);
    const totalSteps = Math.max(2, Math.round(clip.duration * sampleRateHz));
    let lastOrderSig = "";

    for (let s = 0; s <= totalSteps; s++) {
      const t = round4((s / totalSteps) * clip.duration);
      const frame = animEvaluator.evaluateAt(t, clip.duration / totalSteps);
      const sig = frame.order.join(",");
      if (sig !== lastOrderSig) {
        lastOrderSig = sig;
        const offsets: { slot: string; offset: number }[] = [];
        frame.order.forEach((slotName, newIdx) => {
          const origIdx = baseOrder.indexOf(slotName);
          if (origIdx >= 0 && newIdx - origIdx !== 0) {
            offsets.push({ slot: slotName, offset: newIdx - origIdx });
          }
        });
        drawOrderTimeline.push({ time: t, ...(offsets.length > 0 ? { offsets } : {}) });
      }
    }

    // Export FFD deform tracks if present
    let deformJson: Spine42Json["animations"][string]["deform"] | undefined;
    if (clip.deformTracks && Object.keys(clip.deformTracks).length > 0) {
      deformJson = { default: {} };
      for (const [partName, dKeys] of Object.entries(clip.deformTracks)) {
        if (!dKeys || dKeys.length === 0) continue;
        deformJson.default![partName] = {
          [partName]: dKeys.map((dk) => ({
            time: round4(dk.time),
            vertices: dk.offsets.map((val, idx) => round4(idx % 2 === 1 ? -val : val)),
          })),
        };
      }
    }

    animationsJson[clipName] = {
      bones: bonesAnim,
      ...(deformJson ? { deform: deformJson } : {}),
      ...(drawOrderTimeline.length > 1 ? { drawOrder: drawOrderTimeline } : {}),
      ...(rawClip.events && rawClip.events.length > 0
        ? {
            events: rawClip.events.map((ev) => ({
              time: round4(ev.time),
              name: ev.name,
              ...(ev.intParam !== undefined ? { int: ev.intParam } : {}),
              ...(ev.floatParam !== undefined ? { float: round4(ev.floatParam) } : {}),
              ...(ev.stringParam !== undefined ? { string: ev.stringParam } : {}),
            })),
          }
        : {}),
    };
  }

  // Collect all unique event definitions across clips
  const eventsCatalog: Record<string, { int?: number; float?: number; string?: string }> = {};
  for (const clip of Object.values(project.animations)) {
    for (const ev of clip.events ?? []) {
      if (!eventsCatalog[ev.name]) {
        eventsCatalog[ev.name] = {
          ...(ev.intParam !== undefined ? { int: ev.intParam } : {}),
          ...(ev.floatParam !== undefined ? { float: ev.floatParam } : {}),
          ...(ev.stringParam !== undefined ? { string: ev.stringParam } : {}),
        };
      }
    }
  }

  // Export default skin + any authored multi-skin variants
  const exportedSkins =
    project.skins && project.skins.length > 0
      ? project.skins.map((s) => ({
          name: s.name,
          attachments,
        }))
      : [
          {
            name: "default",
            attachments,
          },
        ];

  return {
    skeleton: {
      hash: `sf-${project.id}`,
      spine: "4.2.0",
      x: round4(-rootPx),
      y: round4(-(project.height - rootPy)),
      width: project.width,
      height: project.height,
      fps: 24,
      images: "./",
    },
    bones: spineBones,
    slots: spineSlots,
    ...(project.ikConstraints && project.ikConstraints.length > 0
      ? {
          ik: project.ikConstraints.map((ik) => ({
            name: ik.name,
            bones: [...ik.bones],
            target: ik.target,
            bendPositive: !ik.bendPositive, // Flipped for Y-up
            mix: ik.mix,
          })),
        }
      : {}),
    skins: exportedSkins,
    ...(Object.keys(eventsCatalog).length > 0 ? { events: eventsCatalog } : {}),
    animations: animationsJson,
  };
}
