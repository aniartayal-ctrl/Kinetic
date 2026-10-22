/**
 * Keyframe editing primitives (`src/core/keyframes.ts`).
 *
 * Pure functions behind the graph editor, dope sheet, breakdown tool and pose clipboard.
 * Every function returns new arrays/objects so the store's undo history can share structure.
 */

import { sampleTransformTrack } from "./animator";
import type { AnimationClip, CurveType, TransformKey } from "./schema";
import type { BonePose } from "./solver";

export type Channel = "r" | "x" | "y" | "sx" | "sy";

export const CHANNELS: { id: Channel; label: string; unit: string; color: string; rest: number }[] = [
  { id: "r", label: "Rotate", unit: "°", color: "#64b0ff", rest: 0 },
  { id: "x", label: "Move X", unit: "px", color: "#ff6b6b", rest: 0 },
  { id: "y", label: "Move Y", unit: "px", color: "#30d158", rest: 0 },
  { id: "sx", label: "Scale X", unit: "×", color: "#ff9f0a", rest: 1 },
  { id: "sy", label: "Scale Y", unit: "×", color: "#bf5af2", rest: 1 },
];

const REST: Record<Channel, number> = { r: 0, x: 0, y: 0, sx: 1, sy: 1 };

/** Keys closer than this (seconds) are treated as the same frame. */
const SAME_TIME = 1e-4;

export function channelValue(k: TransformKey, ch: Channel): number {
  return k[ch] ?? REST[ch];
}

/** Rounds `t` to the nearest frame at `fps` and clamps it into the clip. */
export function snapTime(t: number, fps: number, duration: number): number {
  const frame = Math.round(t * fps) / fps;
  return Math.min(duration, Math.max(0, Number(frame.toFixed(4))));
}

/** Sampled pose as a full key (all channels filled). */
export function poseKeyAt(track: TransformKey[] | undefined, time: number): TransformKey {
  const p = sampleTransformTrack(track, time);
  return { time, r: p.r, x: p.x, y: p.y, sx: p.sx, sy: p.sy };
}

/** Inserts `key`, replacing any key on the same frame. Returns the new track and the key's index. */
export function upsertKey(track: TransformKey[], key: TransformKey): { track: TransformKey[]; index: number } {
  const next = track.filter((k) => Math.abs(k.time - key.time) > SAME_TIME);
  next.push(key);
  next.sort((a, b) => a.time - b.time);
  return { track: next, index: next.indexOf(key) };
}

/** Moves key `index` to `newTime`. A key already on that frame is replaced by the moved key. */
export function moveKey(track: TransformKey[], index: number, newTime: number): { track: TransformKey[]; index: number } {
  const moving = track[index];
  if (!moving) return { track, index };
  const rest = track.filter((_, i) => i !== index);
  return upsertKey(rest, { ...moving, time: newTime });
}

export function setKeyChannel(track: TransformKey[], index: number, ch: Channel, value: number): TransformKey[] {
  return track.map((k, i) => (i === index ? { ...k, [ch]: Number(value.toFixed(4)) } : k));
}

/** The curve stored on key `index` shapes the segment from that key to the next one. */
export function setKeyCurve(track: TransformKey[], index: number, curve: CurveType): TransformKey[] {
  return track.map((k, i) => (i === index ? { ...k, curve } : k));
}

export function deleteKeyAt(track: TransformKey[], index: number): TransformKey[] {
  return track.filter((_, i) => i !== index);
}

/**
 * Breakdown ("tween machine"): a new key at `time` that sits `fraction` of the way from the
 * previous key's pose to the next key's pose (0 = copy previous, 1 = copy next, 0.5 = halfway,
 * values outside 0..1 overshoot). Holds the nearer pose when only one neighbour exists.
 */
export function breakdownKey(track: TransformKey[], time: number, fraction: number): TransformKey | null {
  const prev = [...track].reverse().find((k) => k.time < time - SAME_TIME);
  const next = track.find((k) => k.time > time + SAME_TIME);
  if (!prev && !next) return null;
  const a = prev ?? next!;
  const b = next ?? prev!;
  const key: TransformKey = { time, curve: prev?.curve };
  for (const c of CHANNELS) {
    const va = channelValue(a, c.id);
    const vb = channelValue(b, c.id);
    key[c.id] = Number((va + (vb - va) * fraction).toFixed(4));
  }
  return key;
}

/** Writes a full-body pose as keys at `time`, one key per bone, keeping each bone's existing curve. */
export function applyPose(
  boneTracks: Record<string, TransformKey[]>,
  pose: Record<string, BonePose>,
  time: number,
): Record<string, TransformKey[]> {
  const out = { ...boneTracks };
  for (const [bone, p] of Object.entries(pose)) {
    const track = out[bone] ?? [];
    const existing = track.find((k) => Math.abs(k.time - time) <= SAME_TIME);
    out[bone] = upsertKey(track, { time, r: p.r, x: p.x, y: p.y, sx: p.sx, sy: p.sy, curve: existing?.curve }).track;
  }
  return out;
}

/** Samples every bone at `time` (used by the pose clipboard). */
export function samplePose(clip: AnimationClip, boneNames: string[], time: number): Record<string, BonePose> {
  const pose: Record<string, BonePose> = {};
  for (const name of boneNames) pose[name] = sampleTransformTrack(clip.boneTracks[name], time);
  return pose;
}

/**
 * Changes a clip's length. With `stretch`, every timed element (bone, IK, deform, draw-order,
 * fx keys and events) scales with it so the motion keeps its proportions; without it, keys stay
 * put and anything past the new end is dropped.
 */
export function retimeClip(clip: AnimationClip, duration: number, stretch: boolean): AnimationClip {
  const d = Math.max(1 / Math.max(clip.fps, 1), duration);
  const k = stretch ? d / Math.max(clip.duration, 1e-6) : 1;
  const map = <T extends { time: number }>(arr: T[] | undefined): T[] | undefined =>
    arr
      ?.map((x) => ({ ...x, time: Number((x.time * k).toFixed(4)) }))
      .filter((x) => x.time <= d + SAME_TIME);
  const mapRecord = <T extends { time: number }>(rec: Record<string, T[]> | undefined) =>
    rec ? Object.fromEntries(Object.entries(rec).map(([name, keys]) => [name, map(keys) ?? []])) : undefined;

  return {
    ...clip,
    duration: Number(d.toFixed(4)),
    boneTracks: mapRecord(clip.boneTracks) ?? {},
    ...(clip.ikTracks ? { ikTracks: mapRecord(clip.ikTracks) } : {}),
    ...(clip.deformTracks ? { deformTracks: mapRecord(clip.deformTracks) } : {}),
    ...(clip.drawOrderTrack ? { drawOrderTrack: map(clip.drawOrderTrack) } : {}),
    ...(clip.fxTrack ? { fxTrack: map(clip.fxTrack) } : {}),
    ...(clip.events ? { events: map(clip.events) } : {}),
  };
}

/** Value range of a channel across a track (padded so flat channels still get a visible band). */
export function channelRange(track: TransformKey[], ch: Channel, samples: number[] = []): [number, number] {
  const values = [...track.map((k) => channelValue(k, ch)), ...samples];
  if (values.length === 0) return [REST[ch] - 1, REST[ch] + 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const minSpan = ch === "sx" || ch === "sy" ? 0.1 : 2;
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const pad = (hi - lo) * 0.12;
  return [lo - pad, hi + pad];
}

type Bezier = [number, number, number, number];
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * Splits a normalized easing bezier at time fraction `u` (de Casteljau). Both halves, renormalized
 * to their own segments, trace the original curve exactly. Returns null when the split point sits
 * where a half would be degenerate (no progress), in which case callers fall back to inheriting.
 */
export function splitBezier(c: Bezier, u: number): { left: Bezier; right: Bezier } | null {
  const [x1, y1, x2, y2] = c;
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (bx(m) < u) lo = m;
    else hi = m;
  }
  const s = (lo + hi) / 2;
  const lerp = (a: number[], b: number[]) => [a[0]! + (b[0]! - a[0]!) * s, a[1]! + (b[1]! - a[1]!) * s];
  const A = lerp([0, 0], [x1, y1]);
  const B = lerp([x1, y1], [x2, y2]);
  const C = lerp([x2, y2], [1, 1]);
  const D = lerp(A, B);
  const E = lerp(B, C);
  const [mx, my] = lerp(D, E) as [number, number];
  if (mx < 1e-6 || mx > 1 - 1e-6 || Math.abs(my) < 1e-6 || Math.abs(1 - my) < 1e-6) return null;
  return {
    left: [r4(A[0]! / mx), r4(A[1]! / my), r4(D[0]! / mx), r4(D[1]! / my)],
    right: [r4((E[0]! - mx) / (1 - mx)), r4((E[1]! - my) / (1 - my)), r4((C[0]! - mx) / (1 - mx)), r4((C[1]! - my) / (1 - my))],
  };
}

/**
 * Keys the current pose at `time` without changing the motion: the eased segment it lands in is
 * split so both halves keep the original shape. An existing key on that frame keeps its curve.
 */
export function keyPreservingShape(track: TransformKey[], time: number): TransformKey[] {
  const existing = track.find((k) => Math.abs(k.time - time) <= SAME_TIME);
  const key = poseKeyAt(track, time);
  if (existing) return upsertKey(track, { ...key, curve: existing.curve }).track;

  const prevIdx = track.reduce((acc, k, i) => (k.time < time ? i : acc), -1);
  const k0 = track[prevIdx];
  const k1 = track[prevIdx + 1];
  if (!k0 || !k1) return upsertKey(track, { ...key, curve: k0?.curve }).track;
  if (k0.curve === "stepped") return upsertKey(track, { ...key, curve: "stepped" }).track;
  if (!Array.isArray(k0.curve)) return upsertKey(track, key).track;

  const split = splitBezier(k0.curve, (time - k0.time) / (k1.time - k0.time));
  if (!split) return upsertKey(track, { ...key, curve: k0.curve }).track;
  const withLeft = track.map((k, i) => (i === prevIdx ? { ...k, curve: split.left } : k));
  return upsertKey(withLeft, { ...key, curve: split.right }).track;
}

/** Writes channel values into the key at `time`, inserting a shape-preserving key first if needed. */
export function patchKeyAt(track: TransformKey[], time: number, patch: Partial<Record<Channel, number>>): TransformKey[] {
  let next = keyPreservingShape(track, time);
  const idx = next.findIndex((k) => Math.abs(k.time - time) <= SAME_TIME);
  for (const [ch, value] of Object.entries(patch) as [Channel, number][]) {
    if (Number.isFinite(value)) next = setKeyChannel(next, idx, ch, value);
  }
  return next;
}

/**
 * Spine's ⌥-drag: moves key `index` and every later key by the same amount, keeping their spacing.
 * The shift is limited so keys never pass the previous key or run past the clip's end.
 */
export function rippleMoveKey(
  track: TransformKey[],
  index: number,
  newTime: number,
  duration: number,
  minGap = 1e-3,
): { track: TransformKey[]; index: number } {
  const key = track[index];
  if (!key) return { track, index };
  const prev = index > 0 ? track[index - 1]!.time + minGap : 0;
  const last = track[track.length - 1]!.time;
  const delta = Math.max(prev - key.time, Math.min(newTime - key.time, duration - last));
  return { track: track.map((k, i) => (i >= index ? { ...k, time: Number((k.time + delta).toFixed(4)) } : k)), index };
}
