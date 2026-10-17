import assert from "node:assert/strict";
import test from "node:test";
import { BUILTIN_PRESETS } from "../core/presets";
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
});
