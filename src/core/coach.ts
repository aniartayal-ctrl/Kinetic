/**
 * Animation coach (`src/core/coach.ts`).
 *
 * Reviews a clip against the 12 principles of animation and returns cue cards. Most cards carry a
 * one-click fix. Fixes re-detect their target on the clip they are given, so cards can be applied
 * in any order (or all at once) without stale indices.
 */

import { EASE_BACK_OUT, EASE_POWER2_IN, EASE_POWER2_OUT, EASE_SINE_IN_OUT, sampleTransformTrack } from "./animator";
import { channelValue, keyPreservingShape, poseKeyAt, snapClipToFrames, snapTime, upsertKey } from "./keyframes";
import type { AnimationClip, SpineForgeProject, TransformKey } from "./schema";

export type CueCard = {
  /** Stable per check, e.g. "anticipation". */
  id: string;
  principle: string;
  title: string;
  detail: string;
  severity: "warn" | "tip";
  fixLabel?: string;
  apply?: (project: SpineForgeProject, clipName: string) => SpineForgeProject;
};

const LOOSE_WORDS = new Set([
  "cape", "cloak", "hair", "ponytail", "pigtail", "braid", "tail", "cloth", "plume", "feather", "ribbon", "chain", "scarf",
  "skirt", "ear", "antenna", "tassel", "banner", "flag", "sash", "fringe", "mane", "whisker", "tentacle", "vine", "rope", "strap",
]);
const ACTION_CLIP = /strike|slam|win|power|bolt|cheer|triumph|hit|smash|attack|spin|burst|trigger|expand|open/i;
/** Being hit is not something the character anticipates. */
const REACTION_CLIP = /react|hurt|damage|recoil|knock|stagger|flinch/i;
const CENTER_BONES = ["hips", "body", "pelvis", "torso", "chest"];
/** Move size per frame (see moveScore) above which a move reads as a hit or snap. */
const IMPACT_SPEED = 8;

/**
 * Whole-word match on the bone name ("cape-tail", "leftEar", "hair_02"), so "forearm", "spear" and
 * "gear" are not mistaken for an ear.
 */
export function isLooseBone(name: string): boolean {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((t) => LOOSE_WORDS.has(t) || (t.endsWith("s") && LOOSE_WORDS.has(t.slice(0, -1))));
}

type Seg = { bone: string; index: number; k0: TransformKey; k1: TransformKey; d: Delta };
type Delta = { r: number; x: number; y: number; sx: number; sy: number };

const delta = (a: TransformKey, b: TransformKey): Delta => ({
  r: channelValue(b, "r") - channelValue(a, "r"),
  x: channelValue(b, "x") - channelValue(a, "x"),
  y: channelValue(b, "y") - channelValue(a, "y"),
  sx: channelValue(b, "sx") - channelValue(a, "sx"),
  sy: channelValue(b, "sy") - channelValue(a, "sy"),
});
const moves = (d: Delta) => Math.abs(d.r) > 0.5 || Math.abs(d.x) > 0.5 || Math.abs(d.y) > 0.5 || Math.abs(d.sx) > 0.01 || Math.abs(d.sy) > 0.01;
const isLinear = (k: TransformKey) => k.curve === undefined || k.curve === "linear";

function segments(clip: AnimationClip): Seg[] {
  const out: Seg[] = [];
  for (const [bone, track] of Object.entries(clip.boneTracks)) {
    for (let i = 0; i < track.length - 1; i++) out.push({ bone, index: i, k0: track[i]!, k1: track[i + 1]!, d: delta(track[i]!, track[i + 1]!) });
  }
  return out;
}

/** Size of a move: degrees plus translation scaled so 5% of the rig height counts like 20°. */
function moveScore(d: Delta, height: number): number {
  return Math.abs(d.r) + (Math.hypot(d.x, d.y) / Math.max(1, height)) * 400;
}

function biggestMove(project: SpineForgeProject, clip: AnimationClip): (Seg & { score: number }) | null {
  let best: (Seg & { score: number }) | null = null;
  for (const s of segments(clip)) {
    const score = moveScore(s.d, project.height);
    if (!best || score > best.score) best = { ...s, score };
  }
  return best && best.score >= 20 ? best : null;
}

/** The dominant channel of a move and its signed size. */
function mainChannel(d: Delta, height: number): { ch: "r" | "x" | "y"; v: number } {
  const t = (v: number) => (Math.abs(v) / Math.max(1, height)) * 400;
  if (Math.abs(d.r) >= t(d.x) && Math.abs(d.r) >= t(d.y)) return { ch: "r", v: d.r };
  return Math.abs(d.x) >= Math.abs(d.y) ? { ch: "x", v: d.x } : { ch: "y", v: d.y };
}

function withClip(project: SpineForgeProject, clipName: string, fn: (clip: AnimationClip) => AnimationClip): SpineForgeProject {
  const clip = project.animations[clipName];
  if (!clip) return project;
  return { ...project, animations: { ...project.animations, [clipName]: fn(clip) } };
}

function withTrack(clip: AnimationClip, bone: string, track: TransformKey[]): AnimationClip {
  return { ...clip, boneTracks: { ...clip.boneTracks, [bone]: track } };
}

function centerBone(project: SpineForgeProject): string {
  return CENTER_BONES.find((n) => project.bones.some((b) => b.name === n)) ?? project.bones[1]?.name ?? project.bones[0]!.name;
}

const addDelta = (k: TransformKey, d: Delta, f: number): TransformKey => ({
  ...k,
  r: channelValue(k, "r") + d.r * f,
  x: channelValue(k, "x") + d.x * f,
  y: channelValue(k, "y") + d.y * f,
  sx: channelValue(k, "sx") + d.sx * f,
  sy: channelValue(k, "sy") + d.sy * f,
});

/* ── Fixes ─────────────────────────────────────────────────────────────────────────────────── */

const fixEase: CueCard["apply"] = (project, clipName) =>
  withClip(project, clipName, (clip) => {
    const boneTracks = { ...clip.boneTracks };
    for (const [bone, track] of Object.entries(boneTracks)) {
      boneTracks[bone] = track.map((k, i) => {
        const next = track[i + 1];
        return next && isLinear(k) && moves(delta(k, next)) ? { ...k, curve: EASE_SINE_IN_OUT } : k;
      });
    }
    return { ...clip, boneTracks };
  });

const fixAnticipation: CueCard["apply"] = (project, clipName) =>
  withClip(project, clipName, (clip) => {
    const big = biggestMove(project, clip);
    if (!big) return clip;
    const fps = clip.fps || 30;
    const ta = snapTime(big.k0.time + (big.k1.time - big.k0.time) * 0.35, fps, clip.duration);
    if (ta <= big.k0.time || ta >= big.k1.time) return clip;
    const track = clip.boneTracks[big.bone]!.map((k, i) => (i === big.index ? { ...k, curve: EASE_POWER2_OUT } : k));
    const windUp = { ...addDelta(big.k0, big.d, -0.15), time: ta, curve: EASE_POWER2_IN };
    return withTrack(clip, big.bone, upsertKey(track, windUp).track);
  });

const fixFollowThrough: CueCard["apply"] = (project, clipName) =>
  withClip(project, clipName, (clip) => {
    const big = biggestMove(project, clip);
    if (!big) return clip;
    const fps = clip.fps || 30;
    const track = clip.boneTracks[big.bone]!;
    const next = track[big.index + 2];
    const settleAt = big.k1.time + 4 / fps;
    const room = next ? next.time - big.k1.time >= 6 / fps : clip.duration - big.k1.time >= 4 / fps;
    if (!room) return withTrack(clip, big.bone, track.map((k, i) => (i === big.index ? { ...k, curve: EASE_BACK_OUT } : k)));
    // Push past the target, then settle back four frames later.
    const overshoot = { ...addDelta(big.k1, big.d, 0.1), curve: EASE_SINE_IN_OUT };
    const settle = { ...big.k1, time: Number(settleAt.toFixed(4)) };
    let t = track.map((k, i) => (i === big.index + 1 ? overshoot : k));
    t = upsertKey(t, settle).track;
    return withTrack(clip, big.bone, t);
  });

const fixSquash: CueCard["apply"] = (project, clipName) =>
  withClip(project, clipName, (clip) => {
    const big = biggestMove(project, clip);
    if (!big) return clip;
    const bone = centerBone(project);
    const fps = clip.fps || 30;
    const impact = big.k1.time;
    let track = clip.boneTracks[bone] ?? [];
    const recoverAt = Math.min(clip.duration, Number((impact + 4 / fps).toFixed(4)));
    track = keyPreservingShape(track, recoverAt);
    const base = poseKeyAt(track, impact);
    const squash: TransformKey = { ...base, sx: (base.sx ?? 1) * 1.06, sy: (base.sy ?? 1) * 0.94, curve: EASE_POWER2_OUT };
    return withTrack(clip, bone, upsertKey(track, squash).track);
  });

const fixSecondary: CueCard["apply"] = (project) => ({
  ...project,
  bones: project.bones.map((b) =>
    isLooseBone(b.name) && !b.spring ? { ...b, spring: { stiffness: 60, damping: 6, gain: [7, 3] as [number, number], wind: 1.2 } } : b,
  ),
});

const fixOffFrame: CueCard["apply"] = (project, clipName) => withClip(project, clipName, snapClipToFrames);

const fixLoopSeam: CueCard["apply"] = (project, clipName) =>
  withClip(project, clipName, (clip) => {
    const boneTracks = { ...clip.boneTracks };
    for (const [bone, track] of Object.entries(boneTracks)) {
      if (track.length === 0) continue;
      const start = poseKeyAt(track, 0);
      const last = track[track.length - 1]!;
      boneTracks[bone] = upsertKey(track, { ...start, time: clip.duration, curve: last.curve }).track;
    }
    return { ...clip, boneTracks };
  });

const fixExaggerate: CueCard["apply"] = (project, clipName) =>
  withClip(project, clipName, (clip) => {
    const boneTracks: Record<string, TransformKey[]> = {};
    for (const [bone, track] of Object.entries(clip.boneTracks)) {
      boneTracks[bone] = track.map((k) => ({
        ...k,
        r: channelValue(k, "r") * 1.25,
        x: channelValue(k, "x") * 1.25,
        y: channelValue(k, "y") * 1.25,
        sx: 1 + (channelValue(k, "sx") - 1) * 1.25,
        sy: 1 + (channelValue(k, "sy") - 1) * 1.25,
      }));
    }
    return { ...clip, boneTracks };
  });

/* ── Review ────────────────────────────────────────────────────────────────────────────────── */

export function reviewClip(project: SpineForgeProject, clipName: string): CueCard[] {
  const clip = project.animations[clipName];
  if (!clip) return [];
  const cards: CueCard[] = [];
  const fps = clip.fps || 30;
  const segs = segments(clip);
  const moving = segs.filter((s) => moves(s.d));
  const big = biggestMove(project, clip);

  const linear = moving.filter((s) => isLinear(s.k0));
  if (linear.length >= 2 && linear.length / Math.max(1, moving.length) >= 0.3) {
    cards.push({
      id: "slow-in-out",
      principle: "Slow in & slow out",
      title: `${linear.length} moves start and stop at full speed`,
      detail: "Linear keys read mechanical. Easing lets each move accelerate out of a pose and cushion into the next.",
      severity: "warn",
      fixLabel: "Ease them",
      apply: fixEase,
    });
  }

  if (big) {
    const { ch, v } = mainChannel(big.d, project.height);
    const prev = clip.boneTracks[big.bone]![big.index - 1];
    const prevD = prev ? delta(prev, big.k0) : null;
    const hasWindUp = prevD ? Math.sign(prevD[ch]) === -Math.sign(v) && Math.abs(prevD[ch]) >= Math.abs(v) * 0.08 : false;
    if (!hasWindUp && big.k1.time - big.k0.time >= 3 / fps && !REACTION_CLIP.test(clipName)) {
      cards.push({
        id: "anticipation",
        principle: "Anticipation",
        title: `${big.bone}'s big move has no wind-up`,
        detail: "A small move the opposite way first tells the eye an action is coming and makes the hit land harder.",
        severity: "warn",
        fixLabel: "Add wind-up",
        apply: fixAnticipation,
      });
    }

    const track = clip.boneTracks[big.bone]!;
    const after = track[big.index + 2];
    const curve = big.k0.curve;
    const overshootCurve = Array.isArray(curve) && (curve[1] > 1.02 || curve[3] > 1.02);
    const settles =
      after && after.time - big.k1.time <= 0.5 && Math.sign(delta(big.k1, after)[ch]) === -Math.sign(v) && Math.abs(delta(big.k1, after)[ch]) > 0.3;
    if (!overshootCurve && !settles) {
      cards.push({
        id: "follow-through",
        principle: "Follow through",
        title: `${big.bone} stops dead at the end of its move`,
        detail: "Real mass overshoots a little and settles. Four frames of settle sells weight.",
        severity: "warn",
        fixLabel: "Add overshoot",
        apply: fixFollowThrough,
      });
    }

    const center = centerBone(project);
    const scaled = CENTER_BONES.some((b) =>
      (clip.boneTracks[b] ?? []).some((k) => Math.abs(channelValue(k, "sx") - 1) > 0.02 || Math.abs(channelValue(k, "sy") - 1) > 0.02),
    );
    const speed = big.score / Math.max(1, (big.k1.time - big.k0.time) * fps);
    if (!scaled && speed >= IMPACT_SPEED) {
      cards.push({
        id: "squash",
        principle: "Squash & stretch",
        title: "No squash on impact",
        detail: `A brief volume-preserving squash on ${center} at the hit adds punch without changing the pose.`,
        severity: "tip",
        fixLabel: "Add squash",
        apply: fixSquash,
      });
    }
  } else if (ACTION_CLIP.test(clipName) && moving.length > 0) {
    cards.push({
      id: "exaggeration",
      principle: "Exaggeration",
      title: "The action reads small",
      detail: "Slot actions are seen at symbol size. Push every pose 25% further so the silhouette changes clearly.",
      severity: "tip",
      fixLabel: "Push poses 25%",
      apply: fixExaggerate,
    });
  }

  const loose = project.bones.filter((b) => isLooseBone(b.name) && !b.spring);
  if (loose.length > 0) {
    cards.push({
      id: "secondary",
      principle: "Secondary action",
      title: `${loose.map((b) => b.name).join(", ")} ${loose.length === 1 ? "moves" : "move"} rigidly`,
      detail: "Loose parts should drag behind and overlap the main action. Physics does this automatically.",
      severity: "tip",
      fixLabel: "Add physics",
      apply: fixSecondary,
    });
  }

  const offFrame = segs.length === 0 ? 0 : Object.values(clip.boneTracks).flat().filter((k) => Math.abs(k.time * fps - Math.round(k.time * fps)) > 0.02).length;
  if (offFrame > 0) {
    cards.push({
      id: "off-frame",
      principle: "Timing",
      title: `${offFrame} keys sit between frames`,
      detail: `At ${fps} fps these keys never land exactly, so timing shifts slightly in Unity. Snap them to whole frames.`,
      severity: "tip",
      fixLabel: "Snap to frames",
      apply: fixOffFrame,
    });
  }

  if (clip.loop) {
    const popping = Object.entries(clip.boneTracks).filter(([, track]) => {
      if (track.length === 0) return false;
      const a = sampleTransformTrack(track, 0);
      const b = sampleTransformTrack(track, clip.duration);
      return Math.abs(a.r - b.r) > 0.5 || Math.hypot(a.x - b.x, a.y - b.y) > 0.5 || Math.abs(a.sx - b.sx) > 0.01 || Math.abs(a.sy - b.sy) > 0.01;
    });
    if (popping.length > 0) {
      cards.push({
        id: "loop-seam",
        principle: "Timing",
        title: `Loop pops on ${popping.length} ${popping.length === 1 ? "bone" : "bones"}`,
        detail: "The last frame does not match the first, so the loop jumps. Match the end pose to the start.",
        severity: "warn",
        fixLabel: "Close the loop",
        apply: fixLoopSeam,
      });
    }
  }

  const main = big?.bone ?? Object.entries(clip.boneTracks).sort((a, b) => b[1].length - a[1].length)[0]?.[0];
  const mainTrack = main ? clip.boneTracks[main] ?? [] : [];
  // Cycles (idles, breathing, walks) are evenly timed by nature.
  if (mainTrack.length >= 4 && !clip.loop) {
    const gaps = mainTrack.slice(1).map((k, i) => k.time - mainTrack[i]!.time);
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
    if (mean > 0 && sd / mean < 0.08) {
      cards.push({
        id: "even-timing",
        principle: "Timing",
        title: `${main}'s keys are evenly spaced`,
        detail: "Equal gaps make every beat feel the same. Hold the key poses longer and make the moves between them quicker.",
        severity: "tip",
      });
    }
  }

  return cards.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warn" ? -1 : 1));
}

/** Applies every card with a fix, re-reviewing between fixes so each one sees the updated clip. */
export function applyAllCues(project: SpineForgeProject, clipName: string): { project: SpineForgeProject; applied: string[] } {
  let p = project;
  const applied: string[] = [];
  for (const id of ["off-frame", "anticipation", "follow-through", "squash", "slow-in-out", "secondary", "loop-seam", "exaggeration"]) {
    const card = reviewClip(p, clipName).find((c) => c.id === id);
    if (card?.apply) {
      p = card.apply(p, clipName);
      applied.push(card.title);
    }
  }
  return { project: p, applied };
}
