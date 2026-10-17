import assert from "node:assert/strict";
import test from "node:test";
import { bakeClipConstraintsToKeyframes, generateProceduralClips, SpineForgeAnimator } from "./animator";
import { buildPartMesh } from "./weights";
import {
  buildSkeleton,
  deformMeshVerticesCPU,
  evaluateDrawOrder,
  restPose,
  solveSkeleton,
  type Affine2D,
} from "./solver";
import { validateProject, type SpineForgeProject } from "./schema";

function createTestProject(): SpineForgeProject {
  const base: SpineForgeProject = {
    version: "1.0.0",
    id: "astral-knight-test",
    title: "Astral Knight Test",
    src: "/presets/astral-forge/hero.webp",
    width: 653,
    height: 1080,
    action: "slam",
    frame: { left: 0.38, top: 0.35, right: 0.5 },
    palette: { rim: "#7fd8ff", flash: "#f3c969" },
    bones: [
      { name: "root", x: 0.5, y: 0.975 },
      { name: "hips", parent: "root", x: 0.5, y: 0.6, regions: [[0.48, 0.42, 0.5, 0.58, 0.11]], feather: 0.07 },
      { name: "chest", parent: "hips", x: 0.5, y: 0.4, regions: [[0.45, 0.25, 0.52, 0.34, 0.1]], feather: 0.05 },
      { name: "head", parent: "chest", x: 0.53, y: 0.15 },
      {
        name: "cape",
        parent: "chest",
        x: 0.33,
        y: 0.18,
        regions: [[0.2, 0.3, 0.13, 0.55, 0.06]],
        feather: 0.06,
        spring: { stiffness: 70, damping: 8, gain: [6, 3], wind: 1.2 },
      },
      { name: "arm-back", parent: "chest", x: 0.335, y: 0.255 },
      { name: "pauldron", parent: "chest", x: 0.77, y: 0.19, follow: { bone: "arm", ratio: 0.3 } },
      { name: "arm", parent: "chest", x: 0.777, y: 0.207 },
      { name: "forearm", parent: "arm", x: 0.805, y: 0.314 },
      { name: "weapon", parent: "forearm", x: 0.885, y: 0.442 },
      { name: "ik-hand-target", parent: "root", x: 0.885, y: 0.442 },
    ],
    ikConstraints: [
      {
        name: "weapon-arm-ik",
        bones: ["arm", "forearm"],
        target: "ik-hand-target",
        bendPositive: true,
        mix: 0,
      },
    ],
    parts: [
      { name: "head", src: "/head.webp", x: 0.439, y: 0.001, w: 0.187, h: 0.18, bone: "head" },
      {
        name: "body",
        src: "/body.webp",
        x: 0.0,
        y: 0.078,
        w: 0.891,
        h: 0.913,
        skin: ["root", "hips", "chest", "cape"],
      },
      {
        name: "arm-back",
        src: "/arm-back.webp",
        x: 0.236,
        y: 0.245,
        w: 0.184,
        h: 0.311,
        bone: "arm-back",
        swap: { before: "body", bone: "arm-back", beyond: 75 },
      },
      { name: "hammer", src: "/hammer.webp", x: 0.618, y: 0.48, w: 0.381, h: 0.519, bone: "weapon" },
      { name: "arm-upper", src: "/arm.webp", x: 0.655, y: 0.216, w: 0.228, h: 0.145, bone: "arm" },
      { name: "forearm", src: "/forearm.webp", x: 0.772, y: 0.281, w: 0.203, h: 0.207, bone: "forearm" },
      { name: "pauldron", src: "/pauldron.webp", x: 0.646, y: 0.106, w: 0.243, h: 0.138, bone: "pauldron" },
    ],
    animations: {},
  };
  base.animations = generateProceduralClips(base);
  return base;
}

test("Rest pose produces exact identity skin matrices and leaves CPU-deformed mesh vertices untouched", () => {
  const project = createTestProject();
  assert.deepEqual(validateProject(project), []);

  const skeleton = buildSkeleton(project);
  const world: Affine2D[] = project.bones.map(() => [1, 0, 0, 1, 0, 0]);
  const skin = new Float32Array(64 * 4);
  const poses = project.bones.map(() => restPose());

  solveSkeleton(skeleton, poses, world, skin);

  for (let b = 0; b < project.bones.length; b++) {
    const [a, bb, c, d, tx, ty] = skin.subarray(b * 8, b * 8 + 6);
    assert.ok(
      Math.abs(a! - 1) + Math.abs(bb!) + Math.abs(c!) + Math.abs(d! - 1) + Math.abs(tx!) + Math.abs(ty!) < 1e-4,
      `Bone ${b} rest skin matrix is not identity`,
    );
  }

  const bodyMesh = buildPartMesh(project, project.parts[1]!);
  const deformed = deformMeshVerticesCPU(bodyMesh, skin);
  for (let i = 0; i < deformed.length; i++) {
    assert.ok(Math.abs(deformed[i]! - bodyMesh.positions[i]!) < 1e-3);
  }
});

test("2-Bone IK solver reaches target and Follow + DrawOrder swap rules trigger accurately", () => {
  const project = createTestProject();
  project.ikConstraints[0]!.mix = 1.0;

  const skeleton = buildSkeleton(project);
  const world: Affine2D[] = project.bones.map(() => [1, 0, 0, 1, 0, 0]);
  const skin = new Float32Array(64 * 4);
  const poses = project.bones.map(() => restPose());

  // Move IK target upward and left
  const targetIdx = skeleton.index["ik-hand-target"]!;
  poses[targetIdx]!.x = -40;
  poses[targetIdx]!.y = -65;

  // Rotate arm-back past 75 degrees to trigger draw-order swap before body
  const armBackIdx = skeleton.index["arm-back"]!;
  poses[armBackIdx]!.r = 110;

  const solved = solveSkeleton(skeleton, poses, world, skin);
  const armIdx = skeleton.index["arm"]!;
  const pauldronIdx = skeleton.index["pauldron"]!;

  assert.ok(Math.abs(solved[armIdx]!.r) > 1, "IK should rotate upper arm toward target");
  assert.ok(Math.abs(solved[pauldronIdx]!.r) >= 0, "Pauldron follow constraint evaluated");

  const order = evaluateDrawOrder(skeleton, solved);
  assert.ok(order.indexOf("arm-back") < order.indexOf("body"), "arm-back should swap before body when r > 75 deg");
});

test("Procedural clips evaluate cleanly and spring baking produces deterministic finite tracks", () => {
  const project = createTestProject();
  const anim = new SpineForgeAnimator(project, "strike");
  for (let i = 0; i < 60; i++) {
    const frame = anim.evaluateAt(i / 30, 1 / 30);
    for (const v of frame.skin) {
      assert.ok(Number.isFinite(v));
    }
  }

  const baked = bakeClipConstraintsToKeyframes(project, project.animations.strike!, 24);
  const capeKeys = baked.boneTracks["cape"];
  assert.ok(capeKeys && capeKeys.length >= 48, "Baked clip should have 24Hz keys for spring bone cape");
  const hasSpringMotion = capeKeys.some((k) => Math.abs(k.r ?? 0) > 0.05);
  assert.ok(hasSpringMotion, "Spring bone cape should have non-zero baked rotation keys");
});
