import assert from "node:assert/strict";
import test from "node:test";
import { applyAllCues, reviewClip } from "../coach";
import { BUILTIN_PRESETS } from "../presets";
import { findNames, planCommand, splitClauses } from "./planner";
import type { CopilotContext } from "./tools";
import { COPILOT_TOOLS, TOOL_NAMES } from "./tools";

const project = BUILTIN_PRESETS["astral-forge"]!();
const ctx: CopilotContext = {
  bones: project.bones.map((b) => b.name),
  parts: project.parts.map((p) => p.name),
  clips: Object.keys(project.animations),
  ikNames: (project.ikConstraints ?? []).map((k) => k.name),
  activeClip: "strike",
  selectedBone: "arm",
  selectedPart: "body",
  currentTime: 0.5,
  duration: 2,
  fps: 24,
};
const tools = (p: string) => planCommand(p, ctx).actions.map((a) => a.tool);

test("clause splitting keeps objects with their verb", () => {
  assert.deepEqual(splitClauses("show onion skin and motion arcs, then key all"), ["show onion skin and motion arcs", "key all"]);
  assert.deepEqual(splitClauses("mesh body and head; play"), ["mesh body and head", "play"]);
});

test("names resolve exactly and through synonyms", () => {
  assert.deepEqual(findNames("add physics to the arm back", ctx.bones), ["arm-back"]);
  assert.ok(findNames("swing the sword", ctx.bones).includes("weapon"));
  assert.deepEqual(findNames("warm up", ctx.bones), []);
});

test("every feature area is reachable in plain English", () => {
  const cases: [string, string[]][] = [
    ["review this clip", ["review"]],
    ["add anticipation and overshoot", ["apply_suggestion", "apply_suggestion"]],
    ["fix everything", ["fix_all"]],
    ["mesh the body dense with heat weights", ["configure_mesh_and_weights"]],
    ["re-weight all layers", ["configure_mesh_and_weights"]],
    ["add physics to the cape, then make it snappier", ["configure_spring_physics", "retime_clip"]],
    ["remove physics from cape", ["configure_spring_physics"]],
    ["add a bone called tassel under head", ["add_bone"]],
    ["set ik to 40%", ["configure_ik"]],
    ["flip the elbow", ["configure_ik"]],
    ["lock chest", ["lock_bone"]],
    ["key all bones, then breakdown 30% on arm", ["set_key", "breakdown"]],
    ["copy pose then go to frame 20 then paste pose", ["copy_pose", "go_to", "paste_pose"]],
    ["ease in on the arm", ["set_curve"]],
    ["make it 1.5 seconds long", ["retime_clip"]],
    ["60 fps", ["retime_clip"]],
    ["play the idle animation", ["select", "playback"]],
    ["pause", ["playback"]],
    ["next key", ["go_to"]],
    ["show onion skin and motion arcs", ["toggle_overlay", "toggle_overlay"]],
    ["hide the bones", ["toggle_overlay"]],
    ["auto rig it", ["auto_rig"]],
    ["generate all clips", ["generate_clips"]],
    ["bake physics", ["bake_springs_to_keys"]],
    ["add a camera shake event at frame 12", ["add_animation_event"]],
    ["open the weight paint tool", ["set_mode"]],
    ["check the budget", ["check_budget"]],
    ["undo", ["undo"]],
    ["save", ["save"]],
    ["export", ["export"]],
  ];
  for (const [prompt, expected] of cases) assert.deepEqual(tools(prompt), expected, prompt);
  // Every emitted tool exists in the catalog.
  for (const [prompt] of cases) for (const a of planCommand(prompt, ctx).actions) assert.ok(TOOL_NAMES.has(a.tool), a.tool);
  assert.ok(COPILOT_TOOLS.length >= 30);
});

test("unknown requests explain themselves instead of guessing", () => {
  const plan = planCommand("make me a sandwich", ctx);
  assert.equal(plan.actions.length, 0);
  assert.match(plan.reply, /couldn't map/);
});

test("coach reviews clips and every fix applies cleanly", () => {
  const cards = reviewClip(project, "strike");
  assert.ok(cards.length > 0, "built-in strike has room to improve");
  for (const card of cards) {
    if (!card.apply) continue;
    const next = card.apply(project, "strike");
    assert.notEqual(next, project, `${card.id} changed nothing`);
    for (const track of Object.values(next.animations.strike!.boneTracks)) {
      for (let i = 1; i < track.length; i++) assert.ok(track[i]!.time > track[i - 1]!.time, `${card.id} left unsorted keys`);
      for (const k of track) for (const v of [k.r, k.x, k.y, k.sx, k.sy]) assert.ok(v === undefined || Number.isFinite(v));
    }
  }
  const { project: fixed, applied } = applyAllCues(project, "strike");
  assert.ok(applied.length > 0);
  const remaining = reviewClip(fixed, "strike").filter((c) => c.apply).map((c) => c.id);
  assert.ok(!remaining.includes("off-frame") && !remaining.includes("anticipation") && !remaining.includes("secondary"), remaining.join());
});

test("coach catches a linear, unanticipated, rigid clip and fixes it", () => {
  const p = structuredClone(project);
  p.animations.test = {
    name: "test",
    duration: 1,
    fps: 24,
    loop: true,
    boneTracks: { arm: [{ time: 0, r: 0 }, { time: 0.25, r: 5 }, { time: 0.5, r: 80 }, { time: 0.75, r: 80 }] },
  };
  const ids = reviewClip(p, "test").map((c) => c.id);
  for (const id of ["slow-in-out", "anticipation", "follow-through", "loop-seam"]) assert.ok(ids.includes(id), `missing ${id} in ${ids}`);
});
