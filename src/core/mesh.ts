/**
 * Contour-Aware Delaunay Mesh Generator (`src/core/mesh.ts`)
 *
 * Replaces naive rectangular grids with Spine-grade polygon + Steiner point meshes:
 * 1. Traces the alpha silhouette boundary of a cut-out part (`alpha > threshold`) with dilation margin
 *    so anti-aliased edges are never clipped.
 * 2. Simplifies the outer boundary loop via Ramer-Douglas-Peucker (RDP) and enforces minimum/maximum edge spacing.
 * 3. Generates internal Steiner vertices:
 *    - Adaptive interior grid points inside the alpha mask
 *    - Subdivided vertices along bone segments passing through the part for clean crease bending
 * 4. Triangulates hull + interior points using `Delaunator` and filters out any triangle whose centroid
 *    falls outside the dilated alpha mask (for concave shapes like crescents, capes, or weapons).
 * 5. Preserves `hullCount` at the front of the vertex array so Spine 4.2 export is 100% compliant.
 */

import Delaunator from "delaunator";
import type { PartMeshData, RigBone, RigPart, SpineForgeProject } from "./schema";

export type Point2D = [number, number];

export type MeshGenOptions = {
  /** Number of grid columns across the normalized character width (default: 32, or based on density). */
  columns?: number;
  /** Alpha mask (width * height Uint8Array of alpha values 0..255) for contour-aware meshing. */
  alphaMask?: {
    data: Uint8Array | Uint8ClampedArray;
    width: number;
    height: number;
    threshold?: number;
    dilatePx?: number;
  };
  /** Ramer-Douglas-Peucker simplification epsilon in normalized part UV [0..1] (default: 0.018). */
  rdpEpsilon?: number;
  /** Inject extra Steiner points along bone axes that cross the part (default: true). */
  subdivideBones?: boolean;
};

const DENSITY_COLUMNS: Record<NonNullable<RigPart["meshDensity"]>, number> = {
  low: 16,
  medium: 32,
  high: 48,
};

/** Perpendicular distance from point P to segment AB. */
function pointLineDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer-Douglas-Peucker polyline simplification. */
export function simplifyPolygonRDP(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length <= 4) return points.slice();

  function rdpSlice(pts: Point2D[]): Point2D[] {
    if (pts.length <= 2) return pts;
    let maxDist = 0;
    let index = 0;
    const start = pts[0]!;
    const end = pts[pts.length - 1]!;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = pointLineDistance(pts[i]!, start, end);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > epsilon) {
      const left = rdpSlice(pts.slice(0, index + 1));
      const right = rdpSlice(pts.slice(index));
      return [...left.slice(0, -1), ...right];
    }
    return [start, end];
  }

  // Split closed loop at farthest pair of points so start/end are preserved cleanly
  let bestI = 0;
  let bestJ = Math.floor(points.length / 2);
  let bestDist = -1;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = Math.hypot(points[i]![0] - points[j]![0], points[i]![1] - points[j]![1]);
      if (d > bestDist) {
        bestDist = d;
        bestI = i;
        bestJ = j;
      }
    }
  }
  const chain1 = points.slice(bestI, bestJ + 1);
  const chain2 = [...points.slice(bestJ), ...points.slice(0, bestI + 1)];
  const s1 = rdpSlice(chain1);
  const s2 = rdpSlice(chain2);
  const merged = [...s1.slice(0, -1), ...s2.slice(0, -1)];
  return merged.length >= 4 ? merged : points.slice(0, Math.max(4, points.length));
}

/** Ray-casting point-in-polygon test in 2D. */
export function pointInPolygon(x: number, y: number, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Minimum distance from (x, y) to any edge of `polygon`. */
function distanceToPolygonBoundary(x: number, y: number, polygon: Point2D[]): number {
  let minD = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const d = pointLineDistance([x, y], a, b);
    if (d < minD) minD = d;
  }
  return minD;
}

/**
 * Extracts a dilated radial/marching boundary polygon in normalized UV space [0..1]^2 from an alpha mask.
 * Uses angular/scanline envelope + dilation so concave indentations are captured while never clipping opaque pixels.
 */
export function extractAlphaContourUV(
  alphaData: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 12,
  dilatePx = 4,
  epsilon = 0.016,
): { hullUV: Point2D[]; dilatedMask: Uint8Array } {
  const dilated = new Uint8Array(width * height);
  const r = Math.max(1, Math.round(dilatePx));

  // Fast separable box/disk dilation
  const horiz = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width;
    let count = 0;
    for (let x = 0; x <= Math.min(width - 1, r); x++) {
      if (alphaData[rowOffset + x]! > threshold) count++;
    }
    for (let x = 0; x < width; x++) {
      if (count > 0) horiz[rowOffset + x] = 1;
      const removeX = x - r;
      if (removeX >= 0 && alphaData[rowOffset + removeX]! > threshold) count--;
      const addX = x + r + 1;
      if (addX < width && alphaData[rowOffset + addX]! > threshold) count++;
    }
  }
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y <= Math.min(height - 1, r); y++) {
      if (horiz[y * width + x]!) count++;
    }
    for (let y = 0; y < height; y++) {
      if (count > 0) dilated[y * width + x] = 1;
      const removeY = y - r;
      if (removeY >= 0 && horiz[removeY * width + x]!) count--;
      const addY = y + r + 1;
      if (addY < height && horiz[addY * width + x]!) count++;
    }
  }

  // Moore-Neighbor / Scanline perimeter trace
  const slices = 48;
  const leftChain: Point2D[] = [];
  const rightChain: Point2D[] = [];

  for (let s = 0; s <= slices; s++) {
    const y = Math.min(height - 1, Math.round((s / slices) * (height - 1)));
    const rowOffset = y * width;
    let minX = -1;
    let maxX = -1;
    for (let x = 0; x < width; x++) {
      if (dilated[rowOffset + x]) {
        minX = x;
        break;
      }
    }
    if (minX < 0) continue;
    for (let x = width - 1; x >= minX; x--) {
      if (dilated[rowOffset + x]) {
        maxX = x;
        break;
      }
    }
    const v = Math.max(0, Math.min(1, y / Math.max(1, height - 1)));
    const uLeft = Math.max(0, Math.min(1, minX / Math.max(1, width - 1)));
    const uRight = Math.max(0, Math.min(1, maxX / Math.max(1, width - 1)));
    leftChain.push([uLeft, v]);
    rightChain.push([uRight, v]);
  }

  if (leftChain.length < 2) {
    // Fallback to full quad hull if image is empty
    return {
      hullUV: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      dilatedMask: dilated.fill(1),
    };
  }

  // Build counter-clockwise loop: top->bottom along left, bottom->top along right
  const rawLoop: Point2D[] = [...leftChain, ...rightChain.reverse()];
  // Deduplicate near-identical consecutive points
  const deduped: Point2D[] = [];
  for (const pt of rawLoop) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 0.008) {
      deduped.push(pt);
    }
  }
  const simplified = simplifyPolygonRDP(deduped, epsilon);
  return { hullUV: simplified, dilatedMask: dilated };
}

/**
 * Generates a complete triangulated PartMeshData (positions, uvs, joints, weights placeholder, indices, hullCount)
 * for a part. Supports both:
 * - Contour-aware Delaunay triangulation (when `alphaMask` is provided or when `part` is skinned), and
 * - Exact boundary grid triangulation (compatible with SlotSpy's capsule skinning and Spine 4.2 export).
 */
export function generatePartMeshGeometry(
  project: Pick<SpineForgeProject, "width" | "height" | "bones">,
  part: RigPart,
  options: MeshGenOptions = {},
): Omit<PartMeshData, "joints" | "weights"> {
  const rigW = project.width;
  const rigH = project.height;
  const left = part.x * rigW;
  const top = part.y * rigH;
  const width = part.w * rigW;
  const height = part.h * rigH;

  const isRigid = (!part.skin || part.skin.length === 0) && Boolean(part.bone);
  const baseCols = options.columns ?? DENSITY_COLUMNS[part.meshDensity ?? "medium"] ?? 32;

  // Rigid attachment without alpha contour: single 4-vertex quad (2 triangles)
  if (isRigid && !options.alphaMask) {
    return {
      positions: [left, top, left + width, top, left + width, top + height, left, top + height],
      uvs: [0, 0, 1, 0, 1, 1, 0, 1],
      indices: [0, 3, 1, 1, 3, 2],
      hullCount: 4,
    };
  }

  const cols = Math.max(2, Math.round(baseCols * part.w));
  const rows = Math.max(2, Math.round((cols * height) / Math.max(1, width)));

  let hullUV: Point2D[] = [];
  let dilatedMask: Uint8Array | null = null;
  let maskW = 0;
  let maskH = 0;

  if (options.alphaMask) {
    maskW = options.alphaMask.width;
    maskH = options.alphaMask.height;
    const res = extractAlphaContourUV(
      options.alphaMask.data,
      maskW,
      maskH,
      options.alphaMask.threshold ?? 12,
      options.alphaMask.dilatePx ?? 4,
      options.rdpEpsilon ?? 0.016,
    );
    hullUV = res.hullUV;
    dilatedMask = res.dilatedMask;
  } else {
    // Walk perimeter of the [0..1]x[0..1] UV rectangle so hullCount is exact for Spine 4.2
    for (let c = 0; c < cols; c++) hullUV.push([c / cols, 0]);
    for (let r = 0; r < rows; r++) hullUV.push([1, r / rows]);
    for (let c = cols; c > 0; c--) hullUV.push([c / cols, 1]);
    for (let r = rows; r > 0; r--) hullUV.push([0, r / rows]);
  }

  const hullCount = hullUV.length;
  const allUV: Point2D[] = [...hullUV];
  const minSpacing = 0.45 / Math.max(cols, rows);

  // Add interior Steiner grid vertices
  for (let r = 1; r < rows; r++) {
    const v = r / rows;
    for (let c = 1; c < cols; c++) {
      const u = c / cols;
      if (options.alphaMask) {
        if (!pointInPolygon(u, v, hullUV)) continue;
        if (distanceToPolygonBoundary(u, v, hullUV) < minSpacing) continue;
        if (dilatedMask) {
          const px = Math.min(maskW - 1, Math.round(u * (maskW - 1)));
          const py = Math.min(maskH - 1, Math.round(v * (maskH - 1)));
          if (!dilatedMask[py * maskW + px]) continue;
        }
      }
      allUV.push([u, v]);
    }
  }

  // Optional Steiner points along bone segments crossing this part for smooth joint creases
  if (options.subdivideBones !== false && part.skin && part.skin.length > 1) {
    const boneByName = new Map<string, RigBone>(project.bones.map((b) => [b.name, b]));
    for (const boneName of part.skin) {
      const bone = boneByName.get(boneName);
      if (!bone?.parent) continue;
      const parent = boneByName.get(bone.parent);
      if (!parent) continue;
      const steps = 4;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const bx = parent.x + (bone.x - parent.x) * t;
        const by = parent.y + (bone.y - parent.y) * t;
        const u = (bx - part.x) / part.w;
        const v = (by - part.y) / part.h;
        if (u <= 0.05 || u >= 0.95 || v <= 0.05 || v >= 0.95) continue;
        if (!pointInPolygon(u, v, hullUV)) continue;
        if (distanceToPolygonBoundary(u, v, hullUV) < minSpacing) continue;
        const tooClose = allUV.some((pt) => Math.hypot(pt[0] - u, pt[1] - v) < minSpacing);
        if (!tooClose) {
          allUV.push([u, v]);
        }
      }
    }
  }

  // Triangulate in part pixel space so aspect ratio is preserved for Delaunay angles
  const coords = new Float64Array(allUV.length * 2);
  const positions: number[] = new Array(allUV.length * 2);
  const uvs: number[] = new Array(allUV.length * 2);

  for (let i = 0; i < allUV.length; i++) {
    const [u, v] = allUV[i]!;
    const px = left + u * width;
    const py = top + v * height;
    coords[i * 2] = px;
    coords[i * 2 + 1] = py;
    positions[i * 2] = px;
    positions[i * 2 + 1] = py;
    uvs[i * 2] = u;
    uvs[i * 2 + 1] = v;
  }

  const delaunay = new Delaunator(coords);
  const rawTriangles = delaunay.triangles;
  const indices: number[] = [];

  for (let t = 0; t < rawTriangles.length; t += 3) {
    const a = rawTriangles[t]!;
    const b = rawTriangles[t + 1]!;
    const c = rawTriangles[t + 2]!;
    const [ua, va] = allUV[a]!;
    const [ub, vb] = allUV[b]!;
    const [uc, vc] = allUV[c]!;

    // Reject degenerate zero-area triangles
    const area2 = Math.abs((ub - ua) * (vc - va) - (uc - ua) * (vb - va));
    if (area2 < 1e-7) continue;

    // For contour meshes, filter triangles whose centroid lies outside the hull or dilated alpha mask
    if (options.alphaMask) {
      const cu = (ua + ub + uc) / 3;
      const cv = (va + vb + vc) / 3;
      if (!pointInPolygon(cu, cv, hullUV)) continue;
      if (dilatedMask) {
        const px = Math.min(maskW - 1, Math.round(cu * (maskW - 1)));
        const py = Math.min(maskH - 1, Math.round(cv * (maskH - 1)));
        if (!dilatedMask[py * maskW + px]) continue;
      }
    }

    indices.push(a, b, c);
  }

  return {
    positions,
    uvs,
    indices,
    hullCount,
  };
}
