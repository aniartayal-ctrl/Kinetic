import assert from "node:assert/strict";
import test from "node:test";
import { exportUnityCustomRig } from "../exporters/unity-custom-exporter";
import { computeAtlasLayout } from "../exporters/atlas-packer";
import {
  applyPose,
  breakdownKey,
  channelRange,
  moveKey,
  retimeClip,
  samplePose,
  setKeyCurve,
  snapTime,
  upsertKey,
} from "./keyframes";
import { BUILTIN_PRESETS } from "./presets";
import type { AnimationClip, TransformKey } from "./schema";

const track: TransformKey[] = [
  { time: 0, r: 0 },
  { time: 0.5, r: 40, curve: [0.25, 0, 0.75, 1] },
  { time: 1, r: 10 },
];

test("snapTime rounds to frames and clamps to the clip", () => {
  assert.equal(snapTime(0.517, 24, 2), 0.5);
  assert.equal(snapTime(-0.2, 30, 2), 0);
  assert.equal(snapTime(5, 30, 2), 2);
});

test("moveKey retimes, keeps order, and replaces a key on the target frame", () => {
  const moved = moveKey(track, 1, 0.75);
  assert.deepEqual(moved.track.map((k) => k.time), [0, 0.75, 1]);
  assert.equal(moved.track[moved.index]!.r, 40);
  const collide = moveKey(track, 1, 1);
  assert.deepEqual(collide.track.map((k) => k.r), [0, 40]);
  assert.equal(upsertKey(track, { time: 0.5, r: 5 }).track.length, 3);
});

test("breakdown blends neighbour poses, overshoots past 1, and holds at the edges", () => {
  assert.equal(breakdownKey(track, 0.25, 0.5)!.r, 20);
  assert.equal(breakdownKey(track, 0.25, 1.2)!.r, 48);
  assert.equal(breakdownKey([{ time: 0, r: 7 }], 0.5, 0.5)!.r, 7);
  assert.equal(breakdownKey([], 0.5, 0.5), null);
});

test("curves, pose copy/paste and range helpers", () => {
  assert.equal(setKeyCurve(track, 0, "stepped")[0]!.curve, "stepped");
  const clip: AnimationClip = { name: "c", duration: 1, fps: 30, loop: false, boneTracks: { arm: track } };
  const pose = samplePose(clip, ["arm", "leg"], 0.5);
  assert.equal(pose.arm!.r, 40);
  const pasted = applyPose(clip.boneTracks, pose, 0.9);
  assert.equal(pasted.arm!.find((k) => k.time === 0.9)!.r, 40);
  assert.equal(pasted.leg!.length, 1);
  const [lo, hi] = channelRange(track, "r");
  assert.ok(lo < 0 && hi > 40);
  const [slo, shi] = channelRange([{ time: 0 }], "sx");
  assert.ok(shi - slo >= 0.1);
});

test("retimeClip stretches every timed element or trims without stretching", () => {
  const clip: AnimationClip = {
    name: "c",
    duration: 1,
    fps: 30,
    loop: false,
    boneTracks: { arm: track },
    events: [{ time: 0.5, name: "OnHit" }],
    fxTrack: [{ time: 1, flash: 1 }],
  };
  const slow = retimeClip(clip, 2, true);
  assert.deepEqual(slow.boneTracks.arm!.map((k) => k.time), [0, 1, 2]);
  assert.equal(slow.events![0]!.time, 1);
  assert.equal(slow.fxTrack![0]!.time, 2);
  const trimmed = retimeClip(clip, 0.6, false);
  assert.deepEqual(trimmed.boneTracks.arm!.map((k) => k.time), [0, 0.5]);
});

test("Unity export bakes each clip at its own frame rate (at least 30 Hz)", () => {
  const project = BUILTIN_PRESETS["astral-forge"]!();
  const clipName = Object.keys(project.animations)[0]!;
  project.animations[clipName] = { ...project.animations[clipName]!, fps: 60 };
  const atlas = computeAtlasLayout(project.id, project.parts.map((p) => ({ name: p.name, width: 64, height: 64 })));
  const doc = exportUnityCustomRig(project, atlas, { sampleRateHz: 24 });
  const clip = doc.animations.find((a) => a.name === clipName)!;
  const keys = clip.boneTracks[0]!.keys.length;
  assert.equal(keys, Math.max(2, Math.round(project.animations[clipName]!.duration * 60)) + 1);
});

test("keyPreservingShape splits an eased segment without changing the motion", async () => {
  const { keyPreservingShape } = await import("./keyframes");
  const { sampleTransformTrack } = await import("./animator");
  const eased: TransformKey[] = [
    { time: 0, r: 0, x: 10, curve: [0.175, 0.885, 0.32, 1.275] },
    { time: 1, r: 90, x: -30 },
  ];
  const keyed = keyPreservingShape(eased, 0.37);
  assert.equal(keyed.length, 3);
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const a = sampleTransformTrack(eased, t);
    const b = sampleTransformTrack(keyed, t);
    assert.ok(Math.abs(a.r - b.r) < 0.05 && Math.abs(a.x - b.x) < 0.05, `t=${t}: ${a.r} vs ${b.r}`);
  }
  // Stepped segments stay stepped; linear segments stay linear.
  assert.equal(keyPreservingShape([{ time: 0, r: 0, curve: "stepped" }, { time: 1, r: 5 }], 0.5)[1]!.curve, "stepped");
  assert.equal(keyPreservingShape([{ time: 0, r: 0 }, { time: 1, r: 5 }], 0.5)[1]!.r, 2.5);
});
