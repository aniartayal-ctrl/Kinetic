import assert from "node:assert/strict";
import test from "node:test";
import { autoRigProject } from "../core/auto-rigger";
import { BUILTIN_PRESETS } from "../core/presets";
import { validateProject } from "../core/schema";
import { paintFfdLiquifyStroke } from "../core/weights";
import { buildCompleteUnityExportBundle } from "./node-bundle-builder";
import type { Spine42Json } from "./spine42-exporter";
import type { UnitySpriteSheetManifest } from "./spritesheet-exporter";
import type { UnitySfRigDocument } from "./unity-custom-exporter";

test("Triple Export Engine produces valid Spine 4.2 JSON+Atlas, Unity .sfrig.json, and Baked Sprite Sheet", async () => {
  const project = BUILTIN_PRESETS["astral-forge"]!();
  const bundle = await buildCompleteUnityExportBundle(project, {
    sheetCellHeight: 128,
    sheetFps: 6,
  });

  // 1. Verify Atlas PNG
  assert.ok(bundle.atlasPng.byteLength > 1000, "Atlas PNG should be non-empty");
  assert.ok(bundle.spineAtlasTxt.includes("astral-forge.png"), "Spine .atlas.txt should reference page");
  assert.ok(bundle.spineAtlasTxt.includes("hammer"), "Spine .atlas.txt should include hammer region");

  // 2. Verify Spine 4.2 JSON structure and weighted vertex invariants
  const spine = JSON.parse(bundle.spineJson) as Spine42Json;
  assert.equal(spine.skeleton.spine, "4.2.0");
  assert.equal(spine.bones[0]?.name, "root");
  assert.equal(spine.bones.length, project.bones.length);
  assert.equal(spine.slots.length, project.parts.length);

  const bodyAttachment = spine.skins[0]?.attachments["body"]?.["body"];
  assert.ok(bodyAttachment, "Spine default skin must contain weighted body mesh attachment");
  assert.equal(bodyAttachment.type, "mesh");
  assert.ok(bodyAttachment.hull >= 4, "Hull count must be >= 4");
  assert.ok(bodyAttachment.triangles.length > 0 && bodyAttachment.triangles.length % 3 === 0);

  // Verify weighted vertex array parses cleanly: [boneCount, b0, x0, y0, w0, ...]
  const verts = bodyAttachment.vertices;
  const expectedVertexCount = bodyAttachment.uvs.length / 2;
  let cursor = 0;
  let parsedVerts = 0;
  while (cursor < verts.length) {
    const boneCount = verts[cursor++]!;
    assert.ok(boneCount >= 1 && boneCount <= 4, `Invalid boneCount ${boneCount}`);
    let weightSum = 0;
    for (let k = 0; k < boneCount; k++) {
      const bIdx = verts[cursor++]!;
      const lx = verts[cursor++]!;
      const ly = verts[cursor++]!;
      const w = verts[cursor++]!;
      assert.ok(bIdx >= 0 && bIdx < spine.bones.length);
      assert.ok(Number.isFinite(lx) && Number.isFinite(ly));
      weightSum += w;
    }
    assert.ok(Math.abs(weightSum - 1) < 1e-2, `Spine vertex weight sum ${weightSum} != 1`);
    parsedVerts++;
  }
  assert.equal(parsedVerts, expectedVertexCount, "Spine weighted vertex stream must match UV vertex count");

  // 3. Verify Unity Custom .sfrig.json
  const sfrig = JSON.parse(bundle.unitySfRigJson) as UnitySfRigDocument;
  assert.equal(sfrig.format, "SpineForgeUnityRig");
  assert.equal(sfrig.bones.length, project.bones.length);
  assert.equal(sfrig.submeshes.length, project.parts.length);
  assert.equal(sfrig.animations.length, 6);

  for (const sub of sfrig.submeshes) {
    const vCount = sub.vertices.length / 2;
    assert.equal(sub.uvs.length, vCount * 2);
    assert.equal(sub.boneIndices.length, vCount * 4);
    assert.equal(sub.boneWeights.length, vCount * 4);
    for (const uv of sub.uvs) {
      assert.ok(uv >= 0 && uv <= 1, `Atlas UV ${uv} out of [0, 1] bounds`);
    }
  }

  // 4. Verify Baked Flipbook Sprite Sheet
  assert.ok(bundle.spriteSheetPng.byteLength > 1000, "Sprite sheet PNG should be non-empty");
  const sheetMeta = JSON.parse(bundle.spriteSheetJson) as UnitySpriteSheetManifest;
  assert.equal(sheetMeta.format, "SpineForgeSpriteSheet");
  assert.equal(sheetMeta.clips.length, 6);
  assert.ok(sheetMeta.frames.length >= 24);
  assert.ok(bundle.zipBuffer.byteLength > 2000, "ZIP bundle should be generated");

  // 5. Verify Multi-Skin Wardrobe & AnimationEvent triggers in Spine 4.2 and Unity .sfrig.json
  assert.equal(spine.skins.length, 3, "Spine 4.2 should export all 3 skin tiers");
  assert.equal(sfrig.skins.length, 3, "Unity .sfrig.json should export all 3 skin tiers");
  assert.ok(spine.events && "OnHit" in spine.events, "Spine 4.2 should export OnHit event catalog");
  const strikeClipUnity = sfrig.animations.find((a) => a.name === "strike");
  assert.ok(strikeClipUnity && strikeClipUnity.events.length >= 2, "Unity strike clip should include AnimationEvents");
});

test("1-Click AI Auto-Rigger and Liquify FFD Warp Brush produce valid rigs and vertex offsets", () => {
  const base = BUILTIN_PRESETS["sands-of-solara"]!();
  const rigged = autoRigProject(base, undefined, { meshDensity: "high", weightMode: "hybrid" });
  assert.deepEqual(validateProject(rigged), []);
  assert.ok(rigged.bones.length >= 10);

  const bodyPart = rigged.parts.find((p) => p.name === "body")!;
  assert.ok(bodyPart.mesh);
  const offsets = paintFfdLiquifyStroke(bodyPart.mesh, undefined, {
    x: 0.35 * rigged.width,
    y: 0.45 * rigged.height,
    dx: 18,
    dy: -12,
    radius: 90,
    strength: 0.65,
    mode: "push",
  });
  assert.equal(offsets.length, bodyPart.mesh.positions.length);
  assert.ok(offsets.some((val) => Math.abs(val) > 0.5), "Liquify push stroke must displace vertices inside radius");
});
