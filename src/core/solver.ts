/**
 * Rigging Solver (`src/core/solver.ts`)
 *
 * Implements:
 * 1. Parent-first Forward Kinematics (FK) in 2D affine space [a, b, c, d, tx, ty]
 * 2. Analytical 1-Bone and 2-Bone Inverse Kinematics (IK) with bend direction (+1/-1) and FK/IK mix weight
 * 3. Follow constraints (`follow: { bone, ratio }`)
 * 4. Real-time spring physics integrator (`spring: { stiffness, damping, gain, wind }`)
 * 5. Dynamic draw-order swaps (`swap: { before, bone, beyond }`)
 * 6. CPU & GPU 4-Bone Linear Blend Skinning (LBS) + Free-Form Deformation (FFD) vertex transform
 */

import type { PartMeshData, RigBone, RigIkConstraint, SpineForgeProject } from "./schema";

/** Local bone pose deltas from bind pose. r in degrees clockwise; x/y in rig pixels; sx/sy multipliers. */
export type BonePose = {
  r: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
};

export const restPose = (): BonePose => ({ r: 0, x: 0, y: 0, sx: 1, sy: 1 });

/** 2D affine matrix [a, b, c, d, tx, ty]: x' = a*x + c*y + tx, y' = b*x + d*y + ty. */
export type Affine2D = [number, number, number, number, number, number];

export const IDENTITY_AFFINE: Affine2D = [1, 0, 0, 1, 0, 0];

export function multiplyAffine(m: Affine2D, n: Affine2D): Affine2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyAffine(m: Affine2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function invertAffine(m: Affine2D): Affine2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return [...IDENTITY_AFFINE];
  const invDet = 1 / det;
  const a = m[3] * invDet;
  const b = -m[1] * invDet;
  const c = -m[2] * invDet;
  const d = m[0] * invDet;
  const tx = -(a * m[4] + c * m[5]);
  const ty = -(b * m[4] + d * m[5]);
  return [a, b, c, d, tx, ty];
}

export function worldAngleDeg(m: Affine2D): number {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}

export type SpringState = {
  angle: number;
  velocity: number;
  lastPos?: [number, number];
  lastVel?: [number, number];
  lastParentAngle?: number;
  parentSpin?: number;
};

export type BuiltSkeleton = {
  project: SpineForgeProject;
  bones: RigBone[];
  parents: number[];
  /** Bind pivots in rig pixel space [px, py]. */
  pivots: [number, number][];
  index: Record<string, number>;
};

export function buildSkeleton(project: SpineForgeProject): BuiltSkeleton {
  const index: Record<string, number> = {};
  project.bones.forEach((b, i) => {
    index[b.name] = i;
  });
  return {
    project,
    bones: project.bones,
    parents: project.bones.map((b) => (b.parent ? (index[b.parent] ?? -1) : -1)),
    pivots: project.bones.map((b) => [b.x * project.width, b.y * project.height]),
    index,
  };
}

/**
 * Solves 1-bone or 2-bone analytical IK in studio pixel space, modifying `poses[upperIdx].r` and `poses[lowerIdx].r`.
 * Uses the Law of Cosines on bind segment lengths and blends by `ik.mix`.
 */
export function solveIkConstraint(
  skeleton: BuiltSkeleton,
  ik: RigIkConstraint,
  poses: BonePose[],
  world: Affine2D[],
): void {
  if (ik.mix <= 0) return;
  const targetIdx = skeleton.index[ik.target];
  if (targetIdx === undefined) return;

  // Ensure world transforms up to current state are computed
  computeWorldMatrices(skeleton, poses, world);
  const targetWorld = world[targetIdx]!;
  const tx = targetWorld[4];
  const ty = targetWorld[5];

  if (ik.bones.length === 1) {
    const bIdx = skeleton.index[ik.bones[0]!];
    if (bIdx === undefined) return;
    const w = world[bIdx]!;
    const bx = w[4];
    const by = w[5];
    const desiredWorldAngle = (Math.atan2(ty - by, tx - bx) * 180) / Math.PI;
    const currentWorldAngle = worldAngleDeg(w);
    let delta = ((desiredWorldAngle - currentWorldAngle + 540) % 360) - 180;
    poses[bIdx]!.r += delta * ik.mix;
    computeWorldMatrices(skeleton, poses, world);
    return;
  }

  const pIdx = skeleton.index[ik.bones[0]!];
  const cIdx = skeleton.index[ik.bones[1]!];
  if (pIdx === undefined || cIdx === undefined) return;

  const [pBindX, pBindY] = skeleton.pivots[pIdx]!;
  const [cBindX, cBindY] = skeleton.pivots[cIdx]!;
  const L1 = Math.hypot(cBindX - pBindX, cBindY - pBindY);
  if (L1 < 1e-3) return;

  // Determine end effector length L2 (from child bone to its first child or bone.length)
  let L2 = (skeleton.bones[cIdx]!.length ?? 0.12) * skeleton.project.height;
  let tipBindOffsetAngle = Math.atan2(cBindY - pBindY, cBindX - pBindX);
  const grandChildIdx = skeleton.parents.findIndex((p) => p === cIdx);
  if (grandChildIdx >= 0) {
    const [gBindX, gBindY] = skeleton.pivots[grandChildIdx]!;
    L2 = Math.hypot(gBindX - cBindX, gBindY - cBindY);
    tipBindOffsetAngle = Math.atan2(gBindY - cBindY, gBindX - cBindX);
  }

  const pWorld = world[pIdx]!;
  const px = pWorld[4];
  const py = pWorld[5];
  const dx = tx - px;
  const dy = ty - py;
  const dist = Math.max(1e-3, Math.min(L1 + L2 - 1e-3, Math.hypot(dx, dy)));

  const bindUpperAngle = Math.atan2(cBindY - pBindY, cBindX - pBindX);
  const bindBend = tipBindOffsetAngle - bindUpperAngle;

  // Law of cosines for interior angles
  const cosAlpha = Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)));
  const alpha = Math.acos(cosAlpha);
  const cosBeta = Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2)));
  const beta = Math.acos(cosBeta);

  const sign = ik.bendPositive ? 1 : -1;
  const targetAngle = Math.atan2(dy, dx);
  const desiredUpperWorldRad = targetAngle - sign * alpha;
  const desiredLowerBendRad = sign * (Math.PI - beta);

  const parentOfUpper = skeleton.parents[pIdx]!;
  const parentWorldAngleRad = parentOfUpper >= 0 ? (worldAngleDeg(world[parentOfUpper]!) * Math.PI) / 180 : 0;

  const solvedUpperR = ((desiredUpperWorldRad - parentWorldAngleRad - bindUpperAngle) * 180) / Math.PI;
  const solvedLowerR = ((desiredLowerBendRad - bindBend) * 180) / Math.PI;

  const wrap180 = (deg: number) => ((deg + 540) % 360) - 180;
  poses[pIdx]!.r += wrap180(solvedUpperR - poses[pIdx]!.r) * ik.mix;
  poses[cIdx]!.r += wrap180(solvedLowerR - poses[cIdx]!.r) * ik.mix;
  computeWorldMatrices(skeleton, poses, world);
}

export function computeWorldMatrices(
  skeleton: BuiltSkeleton,
  poses: BonePose[],
  world: Affine2D[],
): void {
  const { parents, pivots } = skeleton;
  for (let i = 0; i < parents.length; i++) {
    const pose = poses[i]!;
    const parent = parents[i]!;
    const [px, py] = pivots[i]!;
    const [ox, oy] = parent < 0 ? [0, 0] : pivots[parent]!;
    const rad = (pose.r * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const local: Affine2D = [
      cos * pose.sx,
      sin * pose.sx,
      -sin * pose.sy,
      cos * pose.sy,
      px - ox + pose.x,
      py - oy + pose.y,
    ];
    world[i] = multiplyAffine(parent < 0 ? IDENTITY_AFFINE : world[parent]!, local);
  }
}

/**
 * Full skeleton solve pass:
 * 1. Applies `follow` constraints
 * 2. Applies spring angles
 * 3. Solves 2-bone IK constraints
 * 4. Computes `world` matrices and packs `skin` (world * inverseBind) into Float32Array (8 floats per bone)
 */
export function solveSkeleton(
  skeleton: BuiltSkeleton,
  basePoses: BonePose[],
  world: Affine2D[],
  skin: Float32Array,
  springs?: SpringState[],
  ikOverrides?: Record<string, { mix: number; bendPositive?: boolean }>,
): BonePose[] {
  const { bones, pivots, index, project } = skeleton;
  const effectivePoses: BonePose[] = basePoses.map((p) => ({ ...p }));

  bones.forEach((bone, i) => {
    if (bone.follow && index[bone.follow.bone] !== undefined) {
      effectivePoses[i]!.r += effectivePoses[index[bone.follow.bone]!]!.r * bone.follow.ratio;
    }
    if (bone.spring && springs?.[i]) {
      effectivePoses[i]!.r += springs[i]!.angle;
    }
  });

  computeWorldMatrices(skeleton, effectivePoses, world);

  for (const ik of project.ikConstraints ?? []) {
    const ovr = ikOverrides?.[ik.name];
    const effectiveIk: RigIkConstraint = ovr
      ? { ...ik, mix: ovr.mix, bendPositive: ovr.bendPositive ?? ik.bendPositive }
      : ik;
    solveIkConstraint(skeleton, effectiveIk, effectivePoses, world);
  }

  for (let i = 0; i < bones.length; i++) {
    const [px, py] = pivots[i]!;
    const m = multiplyAffine(world[i]!, [1, 0, 0, 1, -px, -py]);
    skin.set([m[0], m[1], m[2], m[3], m[4], m[5], 0, 0], i * 8);
  }

  return effectivePoses;
}

/**
 * Steps secondary-motion spring physics for all bones with `bone.spring`.
 */
export function stepSpringBones(
  skeleton: BuiltSkeleton,
  world: Affine2D[],
  springs: SpringState[],
  time: number,
  dt: number,
): void {
  const step = Math.min(Math.max(dt, 0), 1 / 20);
  if (step <= 1e-6) return;
  const unit = skeleton.project.height / 1000;

  skeleton.bones.forEach((bone, i) => {
    const spring = bone.spring;
    if (!spring) return;
    const state = springs[i]!;
    const parent = skeleton.parents[i]!;
    const m = world[i]!;
    const position: [number, number] = [m[4], m[5]];
    const parentAngle = parent >= 0 ? worldAngleDeg(world[parent]!) : 0;

    const velocity: [number, number] = state.lastPos
      ? [(position[0] - state.lastPos[0]) / step, (position[1] - state.lastPos[1]) / step]
      : [0, 0];
    const accel: [number, number] = state.lastVel
      ? [(velocity[0] - state.lastVel[0]) / step, (velocity[1] - state.lastVel[1]) / step]
      : [0, 0];
    const spin = state.lastParentAngle === undefined ? 0 : (parentAngle - state.lastParentAngle) / step;
    const spinAccel = state.parentSpin === undefined ? 0 : (spin - state.parentSpin) / step;

    state.lastPos = position;
    state.lastVel = velocity;
    state.lastParentAngle = parentAngle;
    state.parentSpin = spin;

    const scale = 1 / Math.max(1, 1000 * unit);
    const wind =
      (spring.wind ?? 0) * (Math.sin(time * 1.3 + i) * 0.7 + Math.sin(time * 2.9 + i * 2) * 0.3);
    const target =
      Math.max(-14, Math.min(14, accel[0] * scale * spring.gain[0] + accel[1] * scale * spring.gain[1])) + wind;
    const force = spring.stiffness * (target - state.angle) - spring.damping * state.velocity - spinAccel * 0.02;
    state.velocity += force * step;
    state.angle = Math.max(-18, Math.min(18, state.angle + state.velocity * step));
  });
}

/**
 * Evaluates dynamic draw-order swaps based on bone angles (`part.swap`).
 */
export function evaluateDrawOrder(skeleton: BuiltSkeleton, poses: BonePose[], baseOrder?: string[]): string[] {
  const order = baseOrder ? [...baseOrder] : skeleton.project.parts.map((p) => p.name);
  for (const part of skeleton.project.parts) {
    if (!part.swap) continue;
    const bIdx = skeleton.index[part.swap.bone];
    if (bIdx === undefined) continue;
    const r = poses[bIdx]!.r;
    const active = part.swap.beyond >= 0 ? r > part.swap.beyond : r < part.swap.beyond;
    if (!active) continue;
    const curIdx = order.indexOf(part.name);
    if (curIdx >= 0) order.splice(curIdx, 1);
    const beforeIdx = order.indexOf(part.swap.before);
    if (beforeIdx >= 0) order.splice(beforeIdx, 0, part.name);
    else order.push(part.name);
  }
  return order;
}

/**
 * Deforms a part's mesh vertices on the CPU using the current `skin` matrices and optional FFD `deformOffsets`.
 * Useful for hit-testing in the Studio viewport, bounding-box verification, and software rasterization.
 */
export function deformMeshVerticesCPU(
  mesh: PartMeshData,
  skin: Float32Array,
  deformOffsets?: number[],
): Float32Array {
  const vCount = mesh.positions.length / 2;
  const out = new Float32Array(vCount * 2);

  for (let v = 0; v < vCount; v++) {
    const px = mesh.positions[v * 2]! + (deformOffsets?.[v * 2] ?? 0);
    const py = mesh.positions[v * 2 + 1]! + (deformOffsets?.[v * 2 + 1] ?? 0);
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < 4; k++) {
      const w = mesh.weights[v * 4 + k]!;
      if (w <= 0) continue;
      const j = mesh.joints[v * 4 + k]! * 8;
      const a = skin[j]!;
      const b = skin[j + 1]!;
      const c = skin[j + 2]!;
      const d = skin[j + 3]!;
      const tx = skin[j + 4]!;
      const ty = skin[j + 5]!;
      sx += (a * px + c * py + tx) * w;
      sy += (b * px + d * py + ty) * w;
    }
    out[v * 2] = sx;
    out[v * 2 + 1] = sy;
  }
  return out;
}
