import assert from "node:assert/strict";
import test from "node:test";
import { BUDGET_TARGETS, computeBudget } from "./budget";
import { BUILTIN_PRESETS } from "./presets";

test("Performance budget measures real atlas, mesh and draw-call cost", () => {
  const project = BUILTIN_PRESETS["astral-forge"]!();
  const mobile = computeBudget(project, BUDGET_TARGETS["mobile-symbol"]);
  const desktop = computeBudget(project, BUDGET_TARGETS["desktop-hero"]);

  assert.equal(mobile.metrics.length, 7);
  assert.ok(mobile.atlas.pages >= 1 && mobile.atlas.fillPct > 0 && mobile.atlas.fillPct <= 100);
  const vertices = mobile.metrics.find((m) => m.id === "vertices")!;
  const expected = project.parts.reduce((s, p) => s + (p.mesh ? p.mesh.positions.length / 2 : 4), 0);
  assert.equal(vertices.value, expected);
  // Same rig is cheaper against a desktop target than a mobile symbol target.
  assert.ok(desktop.score >= mobile.score);
  // Half-scale export packs into less memory than full scale.
  const tex = (r: typeof mobile) => r.metrics.find((m) => m.id === "texture")!.value;
  assert.ok(tex(mobile) <= tex(desktop));

  // An additive slot sandwiched between normal slots breaks batching.
  const split = structuredClone(project);
  split.parts[1]!.blendMode = "additive";
  const dc = (r: typeof mobile) => r.metrics.find((m) => m.id === "drawcalls")!.value;
  assert.ok(dc(computeBudget(split, BUDGET_TARGETS["mobile-symbol"])) > dc(mobile));
});
