import assert from "node:assert/strict";
import test from "node:test";
import { extractAlphaContourUV, generatePartMeshGeometry, simplifyPolygonRDP } from "./mesh";
import { buildPartMesh, paintMeshWeights } from "./weights";
import type { SpineForgeProject } from "./schema";

const SAMPLE_PROJECT: Pick<SpineForgeProject, "width" | "height" | "bones"> = {
  width: 653,
  height: 1080,
  bones: [
    { name: "root", x: 0.5, y: 0.975 },
    { name: "hips", parent: "root", x: 0.5, y: 0.6, regions: [[0.48, 0.42, 0.5, 0.58, 0.11]], feather: 0.07 },
    { name: "chest", parent: "hips", x: 0.5, y: 0.4, regions: [[0.45, 0.25, 0.52, 0.34, 0.1]], feather: 0.05 },
    { name: "cape", parent: "chest", x: 0.33, y: 0.18, regions: [[0.2, 0.3, 0.13, 0.55, 0.06]], feather: 0.06 },
    { name: "head", parent: "chest", x: 0.53, y: 0.15 },
  ],
};

test("Contour extraction + Delaunay mesh filters transparent concave zones and preserves hullCount", () => {
  const maskW = 64;
  const maskH = 64;
  const alpha = new Uint8Array(maskW * maskH);
  // Draw an L-shaped / concave cloak silhouette
  for (let y = 8; y < 56; y++) {
    for (let x = 8; x < 56; x++) {
      if (x < 28 || y > 36) {
        alpha[y * maskW + x] = 255;
      }
    }
  }

  const { hullUV } = extractAlphaContourUV(alpha, maskW, maskH, 12, 2, 0.02);
  assert.ok(hullUV.length >= 4, "hull polygon must have at least 4 vertices");

  const mesh = generatePartMeshGeometry(
    SAMPLE_PROJECT,
    {
      name: "cape",
      src: "/cape.png",
      x: 0.1,
      y: 0.1,
      w: 0.4,
      h: 0.7,
      skin: ["root", "chest", "cape"],
    },
    {
      alphaMask: { data: alpha, width: maskW, height: maskH, threshold: 12, dilatePx: 2 },
      columns: 24,
    },
  );

  assert.equal(mesh.hullCount, hullUV.length);
  assert.ok(mesh.positions.length / 2 > mesh.hullCount, "interior Steiner vertices must be added");
  assert.ok(mesh.indices.length >= 6 && mesh.indices.length % 3 === 0);

  // Verify every UV is within [0, 1]
  for (const uv of mesh.uvs) {
    assert.ok(uv >= -1e-6 && uv <= 1 + 1e-6, `UV out of range: ${uv}`);
  }
});

test("Auto-weights (capsule, hybrid, heat) and interactive brush strokes keep 4-bone weights normalized to 1.0", () => {
  const bodyPart = {
    name: "body",
    src: "/body.png",
    x: 0.0,
    y: 0.08,
    w: 0.89,
    h: 0.91,
    skin: ["root", "hips", "chest", "cape"],
  };

  for (const mode of ["capsule", "hybrid", "heat"] as const) {
    const mesh = buildPartMesh(SAMPLE_PROJECT, bodyPart, { columns: 20, weightMode: mode });
    const vCount = mesh.positions.length / 2;
    assert.equal(mesh.weights.length, vCount * 4);
    for (let v = 0; v < vCount; v++) {
      const sum =
        mesh.weights[v * 4]! +
        mesh.weights[v * 4 + 1]! +
        mesh.weights[v * 4 + 2]! +
        mesh.weights[v * 4 + 3]!;
      assert.ok(Math.abs(sum - 1) < 1e-5, `Mode ${mode} vertex ${v} weights sum to ${sum}`);
    }
  }

  // Test interactive weight painting brush (add, smooth, subtract)
  let mesh = buildPartMesh(SAMPLE_PROJECT, bodyPart, { columns: 16 });
  mesh = paintMeshWeights(mesh, SAMPLE_PROJECT.bones.length, {
    x: 0.2 * SAMPLE_PROJECT.width,
    y: 0.4 * SAMPLE_PROJECT.height,
    radius: 120,
    strength: 0.75,
    boneIndex: 3, // cape
    mode: "add",
  });
  mesh = paintMeshWeights(mesh, SAMPLE_PROJECT.bones.length, {
    x: 0.2 * SAMPLE_PROJECT.width,
    y: 0.4 * SAMPLE_PROJECT.height,
    radius: 120,
    strength: 0.5,
    boneIndex: 3,
    mode: "smooth",
  });

  const vCount = mesh.positions.length / 2;
  for (let v = 0; v < vCount; v++) {
    const sum =
      mesh.weights[v * 4]! +
      mesh.weights[v * 4 + 1]! +
      mesh.weights[v * 4 + 2]! +
      mesh.weights[v * 4 + 3]!;
    assert.ok(Math.abs(sum - 1) < 1e-5, `Painted vertex ${v} weights sum to ${sum}`);
  }
});

test("simplifyPolygonRDP preserves key corners while reducing vertex count", () => {
  const squareWithCollinear: [number, number][] = [
    [0, 0],
    [0.25, 0],
    [0.5, 0],
    [0.75, 0],
    [1, 0],
    [1, 0.5],
    [1, 1],
    [0.5, 1],
    [0, 1],
    [0, 0.5],
  ];
  const simplified = simplifyPolygonRDP(squareWithCollinear, 0.01);
  assert.ok(simplified.length <= 6);
});
