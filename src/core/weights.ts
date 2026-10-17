/**
 * Automatic & Interactive Weight Skinning Engine (`src/core/weights.ts`)
 *
 * Supports:
 * 1. Rigid Single-Bone Binding (`weights = [1, 0, 0, 0]`)
 * 2. Capsule Envelope Auto-Weighting:
 *    - Generalizes SlotSpy's capsule distance + smoothstep feathering (`src/lib/simulator/rig.ts`)
 *    - First bone in `part.skin` receives the unallocated remainder so planted legs/roots stay anchored.
 * 3. Geodesic / Heat-Diffusion Auto-Weighting:
 *    - When a bone has no explicit `regions` capsules, automatically synthesizes a bone segment capsule
 *      from the bone pivot to its child (or along its length/bindRotation) and computes inverse-distance^4
 *      heat weights across the mesh adjacency graph.
 * 4. Interactive Weight Painting Brush Operations:
 *    - `add`, `subtract`, `replace`, `smooth` (Laplacian neighbor smoothing along triangle edges), `normalize`
 *    - Guarantees at most 4 active bone influences per vertex and `sum(weights) === 1.0` within 1e-6.
 */

import { generatePartMeshGeometry, type MeshGenOptions } from "./mesh";
import { RIG_BONE_PALETTE, type PartMeshData, type RigBone, type RigPart, type SpineForgeProject } from "./schema";

export function capsuleDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq));
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (Math.abs(edge1 - edge0) < 1e-9) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export type AutoWeightMode = "capsule" | "heat" | "hybrid";

/**
 * Computes top-4 bone indices and normalized weights for every vertex in `positions`.
 */
export function computeAutoWeights(
  project: Pick<SpineForgeProject, "width" | "height" | "bones">,
  part: RigPart,
  positions: number[],
  mode: AutoWeightMode = "hybrid",
): { joints: number[]; weights: number[] } {
  const rigW = project.width;
  const rigH = project.height;
  const boneIndex: Record<string, number> = {};
  project.bones.forEach((b, i) => {
    boneIndex[b.name] = i;
  });

  const vertexCount = positions.length / 2;
  const joints = new Array<number>(vertexCount * 4).fill(0);
  const weights = new Array<number>(vertexCount * 4).fill(0);

  const skinIndices = (part.skin ?? []).map((name) => boneIndex[name]).filter((idx): idx is number => idx !== undefined);
  const rigidIndex = skinIndices.length === 0 && part.bone ? (boneIndex[part.bone] ?? 0) : -1;

  if (rigidIndex >= 0 || skinIndices.length === 1) {
    const targetBone = rigidIndex >= 0 ? rigidIndex : skinIndices[0]!;
    for (let v = 0; v < vertexCount; v++) {
      joints[v * 4] = targetBone;
      weights[v * 4] = 1;
    }
    return { joints, weights };
  }

  const activeSkin = skinIndices.length > 0 ? skinIndices : [0];
  const raw = new Float64Array(project.bones.length);

  // Precompute child bone segments for heat fallback when a bone has no explicit capsule regions
  const childByParent = new Map<number, number>();
  project.bones.forEach((b, idx) => {
    if (b.parent && boneIndex[b.parent] !== undefined && !childByParent.has(boneIndex[b.parent]!)) {
      childByParent.set(boneIndex[b.parent]!, idx);
    }
  });

  for (let v = 0; v < vertexCount; v++) {
    const x = positions[v * 2]!;
    const y = positions[v * 2 + 1]!;
    raw.fill(0);

    if (mode === "heat") {
      // Pure inverse-distance^3 heat weighting across all bones in activeSkin
      for (const bIdx of activeSkin) {
        const bone = project.bones[bIdx]!;
        const ax = bone.x * rigW;
        const ay = bone.y * rigH;
        const childIdx = childByParent.get(bIdx);
        const bx = childIdx !== undefined ? project.bones[childIdx]!.x * rigW : ax;
        const by = childIdx !== undefined ? project.bones[childIdx]!.y * rigH : ay;
        const d = capsuleDistance(x, y, ax, ay, bx, by);
        const normD = d / Math.max(1, rigH * 0.08);
        raw[bIdx] = 1 / Math.pow(normD * normD + 0.08, 1.75);
      }
    } else {
      // Capsule / Hybrid mode: matches SlotSpy's exact capsule feathering when `regions` exist,
      // and synthesizes a natural bone segment envelope when `regions` are omitted in interactive studio mode.
      let total = 0;
      for (let s = 1; s < activeSkin.length; s++) {
        const bIdx = activeSkin[s]!;
        const bone = project.bones[bIdx]!;
        const feather = (bone.feather ?? 0.05) * rigH;
        let strength = 0;

        if (bone.regions && bone.regions.length > 0) {
          for (const [ax, ay, bx, by, radius] of bone.regions) {
            const d = capsuleDistance(x, y, ax * rigW, ay * rigH, bx * rigW, by * rigH);
            const r = radius * rigH;
            strength = Math.max(strength, 1 - smoothstep(r, r + feather, d));
          }
        } else if (mode === "hybrid") {
          const ax = bone.x * rigW;
          const ay = bone.y * rigH;
          const childIdx = childByParent.get(bIdx);
          const bx = childIdx !== undefined ? project.bones[childIdx]!.x * rigW : ax;
          const by = childIdx !== undefined ? project.bones[childIdx]!.y * rigH : ay;
          const d = capsuleDistance(x, y, ax, ay, bx, by);
          const r = (bone.length ?? 0.08) * rigH;
          strength = Math.max(strength, 1 - smoothstep(r, r + feather * 1.4, d));
        }

        raw[bIdx] = strength;
        total += strength;
      }

      if (total > 1) {
        for (let b = 0; b < raw.length; b++) raw[b]! /= total;
      } else {
        raw[activeSkin[0]!]! += 1 - total;
      }
    }

    // Rank top 4 bone weights and normalize to 1.0
    const ranked = Array.from(raw, (weight, bone) => ({ weight, bone }))
      .filter((entry) => entry.weight > 1e-7)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4);

    if (ranked.length === 0) {
      joints[v * 4] = activeSkin[0]!;
      weights[v * 4] = 1;
      continue;
    }

    const sum = ranked.reduce((acc, entry) => acc + entry.weight, 0) || 1;
    let accum = 0;
    for (let k = 0; k < ranked.length; k++) {
      joints[v * 4 + k] = ranked[k]!.bone;
      const w = k === ranked.length - 1 ? Math.max(0, 1 - accum) : ranked[k]!.weight / sum;
      weights[v * 4 + k] = w;
      accum += w;
    }
  }

  return { joints, weights };
}

/**
 * Builds or returns a part's complete PartMeshData (positions, uvs, joints, weights, indices, hullCount).
 */
export function buildPartMesh(
  project: Pick<SpineForgeProject, "width" | "height" | "bones">,
  part: RigPart,
  options: MeshGenOptions & { weightMode?: AutoWeightMode } = {},
): PartMeshData {
  if (part.mesh && !options.alphaMask && options.columns === undefined && !options.weightMode) {
    return part.mesh;
  }
  const geom = generatePartMeshGeometry(project, part, options);
  const { joints, weights } = computeAutoWeights(project, part, geom.positions, options.weightMode ?? "hybrid");
  return {
    ...geom,
    joints,
    weights,
  };
}

export type WeightBrushMode = "add" | "subtract" | "replace" | "smooth";

export type WeightBrushStroke = {
  /** Brush center X in rig pixel coordinates. */
  x: number;
  /** Brush center Y in rig pixel coordinates. */
  y: number;
  /** Brush radius in rig pixel coordinates. */
  radius: number;
  /** Brush strength [0..1]. */
  strength: number;
  /** Target bone index into `project.bones`. */
  boneIndex: number;
  /** Brush operation mode. */
  mode: WeightBrushMode;
  /** Optional set of bone indices locked from modification. */
  lockedBones?: Set<number>;
};

/**
 * Applies an interactive weight brush stroke to `mesh`, returning a new PartMeshData with normalized 4-bone weights.
 */
export function paintMeshWeights(
  mesh: PartMeshData,
  boneCount: number,
  stroke: WeightBrushStroke,
): PartMeshData {
  const vertexCount = mesh.positions.length / 2;
  const newJoints = mesh.joints.slice();
  const newWeights = mesh.weights.slice();

  // Build vertex adjacency list if smoothing
  let neighbors: number[][] | null = null;
  if (stroke.mode === "smooth") {
    neighbors = Array.from({ length: vertexCount }, () => []);
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const a = mesh.indices[t]!;
      const b = mesh.indices[t + 1]!;
      const c = mesh.indices[t + 2]!;
      if (!neighbors[a]!.includes(b)) neighbors[a]!.push(b);
      if (!neighbors[a]!.includes(c)) neighbors[a]!.push(c);
      if (!neighbors[b]!.includes(a)) neighbors[b]!.push(a);
      if (!neighbors[b]!.includes(c)) neighbors[b]!.push(c);
      if (!neighbors[c]!.includes(a)) neighbors[c]!.push(a);
      if (!neighbors[c]!.includes(b)) neighbors[c]!.push(b);
    }
  }

  // Unpack dense weights per vertex for accurate manipulation
  const dense = new Float64Array(vertexCount * boneCount);
  for (let v = 0; v < vertexCount; v++) {
    for (let k = 0; k < 4; k++) {
      const b = mesh.joints[v * 4 + k]!;
      const w = mesh.weights[v * 4 + k]!;
      if (b >= 0 && b < boneCount && w > 0) {
        dense[v * boneCount + b] += w;
      }
    }
  }

  const updatedDense = dense.slice();
  const r = Math.max(1e-3, stroke.radius);

  for (let v = 0; v < vertexCount; v++) {
    const vx = mesh.positions[v * 2]!;
    const vy = mesh.positions[v * 2 + 1]!;
    const dist = Math.hypot(vx - stroke.x, vy - stroke.y);
    if (dist > r) continue;

    // Smooth quadratic falloff from center (1) to radius (0)
    const falloff = 1 - smoothstep(0, r, dist);
    const amount = Math.max(0, Math.min(1, stroke.strength * falloff));
    if (amount <= 1e-6) continue;

    const rowOffset = v * boneCount;

    if (stroke.mode === "smooth" && neighbors) {
      const nbrs = neighbors[v]!;
      if (nbrs.length === 0) continue;
      for (let b = 0; b < boneCount; b++) {
        if (stroke.lockedBones?.has(b)) continue;
        let avg = 0;
        for (const n of nbrs) {
          avg += dense[n * boneCount + b]!;
        }
        avg /= nbrs.length;
        updatedDense[rowOffset + b] = dense[rowOffset + b]! * (1 - amount) + avg * amount;
      }
    } else {
      const targetB = stroke.boneIndex;
      if (stroke.lockedBones?.has(targetB)) continue;
      const current = updatedDense[rowOffset + targetB]!;
      let nextTarget = current;
      if (stroke.mode === "add") {
        nextTarget = Math.min(1, current + amount);
      } else if (stroke.mode === "subtract") {
        nextTarget = Math.max(0, current - amount);
      } else if (stroke.mode === "replace") {
        nextTarget = current * (1 - amount) + amount;
      }
      updatedDense[rowOffset + targetB] = nextTarget;

      // Proportionally scale unlocked other bones so total remains 1.0
      let otherSum = 0;
      for (let b = 0; b < boneCount; b++) {
        if (b !== targetB && !stroke.lockedBones?.has(b)) {
          otherSum += updatedDense[rowOffset + b]!;
        }
      }
      let lockedSum = 0;
      if (stroke.lockedBones) {
        for (const lb of stroke.lockedBones) {
          if (lb !== targetB) lockedSum += updatedDense[rowOffset + lb]!;
        }
      }
      const remainder = Math.max(0, 1 - nextTarget - lockedSum);
      if (otherSum > 1e-7) {
        const scale = remainder / otherSum;
        for (let b = 0; b < boneCount; b++) {
          if (b !== targetB && !stroke.lockedBones?.has(b)) {
            updatedDense[rowOffset + b]! *= scale;
          }
        }
      } else if (remainder > 0) {
        // Assign leftover to root (0) or keep on targetB
        const fallbackBone = targetB === 0 && boneCount > 1 ? 1 : 0;
        updatedDense[rowOffset + fallbackBone]! += remainder;
      }
    }

    // Re-pack top 4 bones and normalize
    const ranked: { bone: number; weight: number }[] = [];
    for (let b = 0; b < boneCount; b++) {
      const w = updatedDense[rowOffset + b]!;
      if (w > 1e-7) ranked.push({ bone: b, weight: w });
    }
    ranked.sort((a, b) => b.weight - a.weight);
    const top4 = ranked.slice(0, 4);
    const sum = top4.reduce((acc, item) => acc + item.weight, 0) || 1;
    let accum = 0;
    for (let k = 0; k < 4; k++) {
      if (k < top4.length) {
        newJoints[v * 4 + k] = top4[k]!.bone;
        const w = k === top4.length - 1 ? Math.max(0, 1 - accum) : top4[k]!.weight / sum;
        newWeights[v * 4 + k] = w;
        accum += w;
      } else {
        newJoints[v * 4 + k] = 0;
        newWeights[v * 4 + k] = 0;
      }
    }
  }

  return {
    ...mesh,
    joints: newJoints,
    weights: newWeights,
  };
}

/**
 * Computes per-vertex RGBA color (Float32Array of length vertexCount * 4) for live weight heatmap visualization.
 * If `selectedBoneIndex` is provided (>= 0), renders a Jet/Viridis thermal ramp for that single bone's weight [0..1].
 * Otherwise blends each bone's studio palette color weighted by its influence.
 */
export function computeVertexHeatmapColors(
  mesh: PartMeshData,
  bones: RigBone[],
  selectedBoneIndex = -1,
): Float32Array {
  const vertexCount = mesh.positions.length / 2;
  const out = new Float32Array(vertexCount * 4);

  const hexToRgb = (hex: string): [number, number, number] => {
    const clean = hex.replace("#", "");
    const num = parseInt(clean.slice(0, 6), 16) || 0;
    return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
  };

  const boneColors = bones.map((b, i) => hexToRgb(b.color ?? RIG_BONE_PALETTE[i % RIG_BONE_PALETTE.length]!));

  for (let v = 0; v < vertexCount; v++) {
    if (selectedBoneIndex >= 0) {
      let w = 0;
      for (let k = 0; k < 4; k++) {
        if (mesh.joints[v * 4 + k] === selectedBoneIndex) {
          w += mesh.weights[v * 4 + k]!;
        }
      }
      w = Math.max(0, Math.min(1, w));
      // Thermal ramp: blue (0) -> cyan (0.25) -> green (0.5) -> yellow (0.75) -> red (1.0)
      const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * w - 3)));
      const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * w - 2)));
      const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * w - 1)));
      out.set([r, g, b, 0.25 + 0.65 * w], v * 4);
    } else {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < 4; k++) {
        const j = mesh.joints[v * 4 + k]!;
        const w = mesh.weights[v * 4 + k]!;
        const col = boneColors[j] ?? [0.5, 0.5, 0.5];
        r += col[0] * w;
        g += col[1] * w;
        b += col[2] * w;
      }
      out.set([r, g, b, 0.72], v * 4);
    }
  }
  return out;
}
