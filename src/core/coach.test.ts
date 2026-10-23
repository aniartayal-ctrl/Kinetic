import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { useStudioStore } from "@/store/useStudioStore";
import { applyAllCues, isLooseBone, reviewClip } from "./coach";
import { snapClipToFrames } from "./keyframes";
import type { AnimationClip, SpineForgeProject } from "./schema";

const base = useStudioStore.getState().project;
const withClip = (name: string, clip: Partial<AnimationClip>): SpineForgeProject => ({
  ...base,
  animations: { [name]: { name, duration: 1, fps: 24, loop: false, boneTracks: {}, ...clip } },
});
const ids = (p: SpineForgeProject, name: string) => reviewClip(p, name).map((c) => c.id);
const swing = { weapon: [{ time: 0, r: 0 }, { time: 6 / 24, r: 90 }] };

describe("coach", () => {
  it("matches loose parts by whole word", () => {
    for (const n of ["cape", "cape-tail", "hair_02", "leftEar", "ears", "ponytail", "scarf-end"]) assert.ok(isLooseBone(n), n);
    for (const n of ["forearm", "spear", "gear", "head", "chest", "detail"]) assert.ok(!isLooseBone(n), n);
  });

  it("built-in clips do not flag the forearm as loose", () => {
    for (const name of Object.keys(base.animations)) {
      for (const c of reviewClip(base, name)) assert.ok(!/forearm/.test(c.title), `${name}: ${c.title}`);
    }
  });

  it("built-in clips are frame-aligned", () => {
    for (const name of Object.keys(base.animations)) assert.ok(!ids(base, name).includes("off-frame"), name);
  });

  it("sees squash on any center bone", () => {
    const p = withClip("slam", { boneTracks: { ...swing, chest: [{ time: 0.25, sy: 0.9, sx: 1.1 }] } });
    assert.ok(!ids(p, "slam").includes("squash"));
    assert.ok(ids(withClip("slam", { boneTracks: swing }), "slam").includes("squash"));
  });

  it("asks for squash on fast moves only", () => {
    const slow = withClip("raise", { duration: 2, boneTracks: { weapon: [{ time: 0, r: 0 }, { time: 1.5, r: 90 }] } });
    assert.ok(!ids(slow, "raise").includes("squash"));
  });

  it("skips anticipation on reactions", () => {
    const hit = { weapon: [{ time: 0, r: 0 }, { time: 0.5, r: 90 }] };
    assert.ok(ids(withClip("attack", { boneTracks: hit }), "attack").includes("anticipation"));
    assert.ok(!ids(withClip("hit-react", { boneTracks: hit }), "hit-react").includes("anticipation"));
  });

  it("does not call cycles evenly timed", () => {
    const even = { chest: [0, 6, 12, 18, 24].map((f, i) => ({ time: f / 24, r: i % 2 ? 3 : -3 })) };
    assert.ok(ids(withClip("walk", { boneTracks: even }), "walk").includes("even-timing"));
    assert.ok(!ids(withClip("idle", { boneTracks: even, loop: true }), "idle").includes("even-timing"));
  });

  it("fix all leaves nothing fixable behind on a rough clip", () => {
    const rough = withClip("strike", { boneTracks: { weapon: [{ time: 0, r: 0 }, { time: 0.31, r: 80 }, { time: 0.9, r: 80 }] } });
    const { project, applied } = applyAllCues(rough, "strike");
    assert.ok(applied.length >= 3, applied.join("; "));
    assert.deepEqual(
      reviewClip(project, "strike").filter((c) => c.apply).map((c) => c.id),
      [],
    );
  });
});

describe("snapClipToFrames", () => {
  it("snaps keys, events and length to whole frames and merges collisions", () => {
    const clip: AnimationClip = {
      name: "x",
      duration: 1.01,
      fps: 24,
      loop: false,
      boneTracks: { a: [{ time: 0 }, { time: 0.01, r: 5 }, { time: 0.4, r: 9 }] },
      fxTrack: [{ time: 0.33, flash: 1 } as never],
      events: [{ time: 0.52, name: "OnHit" } as never],
    };
    const s = snapClipToFrames(clip);
    assert.equal(s.duration, 1);
    assert.deepEqual(
      s.boneTracks.a!.map((k) => [Math.round(k.time * 24), k.r]),
      [
        [0, 5],
        [10, 9],
      ],
    );
    assert.ok(Math.abs(s.fxTrack![0]!.time * 24 - 8) < 0.01);
    assert.ok(Math.abs(s.events![0]!.time * 24 - 12) < 0.01);
  });
});
