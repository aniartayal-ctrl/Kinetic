/**
 * Round-trip check against Esoteric Software's official Spine 4.2 runtime (spine-core).
 * Parses every exported skeleton, plays every animation with physics enabled, and checks that
 * bones stay finite and the setup-pose mesh lands within 0.25 px of where the studio drew it
 * (the slack covers 4-decimal weight rounding on large rigs).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AnimationState,
  AnimationStateData,
  type AttachmentLoader,
  BoundingBoxAttachment,
  ClippingAttachment,
  MeshAttachment,
  PathAttachment,
  Physics,
  PointAttachment,
  RegionAttachment,
  Skeleton,
  SkeletonJson,
  type Skin,
  TextureRegion,
} from "@esotericsoftware/spine-core";
import { BUILTIN_PRESETS } from "../core/presets";
import { buildPartMesh } from "../core/weights";
import { exportSpine42 } from "./spine42-exporter";

function fakeRegion(): TextureRegion {
  const r = new TextureRegion();
  Object.assign(r, { u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1, originalWidth: 1, originalHeight: 1, degrees: 0 });
  return r;
}

const loader: AttachmentLoader = {
  newRegionAttachment: (_s: Skin, name: string, path: string) => {
    const a = new RegionAttachment(name, path);
    a.region = fakeRegion();
    return a;
  },
  newMeshAttachment: (_s: Skin, name: string, path: string) => {
    const a = new MeshAttachment(name, path);
    a.region = fakeRegion();
    return a;
  },
  newBoundingBoxAttachment: (_s: Skin, name: string) => new BoundingBoxAttachment(name),
  newPathAttachment: (_s: Skin, name: string) => new PathAttachment(name),
  newPointAttachment: (_s: Skin, name: string) => new PointAttachment(name),
  newClippingAttachment: (_s: Skin, name: string) => new ClippingAttachment(name),
};

for (const mode of ["native", "bake"] as const) {
  for (const presetId of Object.keys(BUILTIN_PRESETS)) {
    test(`spine-core 4.2 loads and plays "${presetId}" (${mode})`, () => {
      const project = BUILTIN_PRESETS[presetId]!();
      const { json } = exportSpine42(project, { physics: mode });
      const data = new SkeletonJson(loader).readSkeletonData(JSON.parse(JSON.stringify(json)));

      assert.equal(data.bones.length, project.bones.length);
      assert.equal(data.physicsConstraints.length, mode === "native" ? project.bones.filter((b) => b.spring).length : 0);

      // Setup pose: Spine must place every mesh vertex where the studio placed it.
      const skeleton = new Skeleton(data);
      skeleton.setToSetupPose();
      skeleton.updateWorldTransform(Physics.reset);
      const rootPx = project.bones[0]!.x * project.width;
      const rootPy = project.bones[0]!.y * project.height;
      for (const part of project.parts) {
        const slot = skeleton.findSlot(part.name)!;
        const mesh = slot.getAttachment() as MeshAttachment;
        const out = new Array<number>(mesh.worldVerticesLength).fill(0);
        mesh.computeWorldVertices(slot, 0, mesh.worldVerticesLength, out, 0, 2);
        const studio = (part.mesh ?? buildPartMesh(project, part)).positions;
        for (let i = 0; i < out.length; i += 2) {
          assert.ok(Math.abs(out[i]! - (studio[i]! - rootPx)) < 0.25, `${part.name} x mismatch`);
          assert.ok(Math.abs(out[i + 1]! - (rootPy - studio[i + 1]!)) < 0.25, `${part.name} y mismatch v${i / 2}: ${out[i + 1]} vs ${rootPy - studio[i + 1]!}`);
        }
      }

      // Play every animation for its full length with physics stepping.
      const state = new AnimationState(new AnimationStateData(data));
      for (const anim of data.animations) {
        skeleton.setToSetupPose();
        state.setAnimation(0, anim.name, false);
        const steps = Math.ceil(anim.duration * 60) + 1;
        for (let i = 0; i < steps; i++) {
          state.update(1 / 60);
          state.apply(skeleton);
          skeleton.update(1 / 60);
          skeleton.updateWorldTransform(Physics.update);
        }
        for (const bone of skeleton.bones) {
          assert.ok(Number.isFinite(bone.worldX) && Number.isFinite(bone.worldY), `${anim.name}: ${bone.data.name} not finite`);
          assert.ok(Math.abs(bone.worldX) < 1e5 && Math.abs(bone.worldY) < 1e5, `${anim.name}: ${bone.data.name} exploded`);
        }
      }
    });
  }
}
