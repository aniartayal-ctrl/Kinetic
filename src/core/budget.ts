/**
 * Performance budget for slot symbols and characters (`src/core/budget.ts`).
 *
 * Measures the rig the way a runtime will pay for it: real atlas packing, texture memory,
 * mesh cost, bone influences, constraints and draw-call breaks. Each metric is compared to a
 * target profile. Targets are studio rules of thumb, not certification limits; adjust them to
 * match your studio's technical requirements.
 */

import { MaxRectsPacker } from "maxrects-packer";
import type { SpineForgeProject } from "./schema";

export type BudgetStatus = "good" | "warn" | "over";

export type BudgetMetric = {
  id: string;
  label: string;
  value: number;
  /** Display string for the value (with unit). */
  display: string;
  target: number;
  status: BudgetStatus;
  /** One-line advice shown when the metric is not "good". */
  advice: string;
};

export type BudgetTarget = {
  id: "mobile-symbol" | "mobile-hero" | "desktop-hero";
  label: string;
  /** Scale the art is shipped at relative to the project canvas (e.g. 0.5 for @0.5x mobile). */
  exportScale: number;
  maxAtlasSize: number;
  maxTextureMB: number;
  maxVertices: number;
  maxBones: number;
  maxInfluencesPerVertex: number;
  maxDrawCalls: number;
  maxConstraints: number;
};

export const BUDGET_TARGETS: Record<BudgetTarget["id"], BudgetTarget> = {
  "mobile-symbol": {
    id: "mobile-symbol",
    label: "Mobile symbol",
    exportScale: 0.5,
    maxAtlasSize: 1024,
    maxTextureMB: 2,
    maxVertices: 600,
    maxBones: 20,
    maxInfluencesPerVertex: 2,
    maxDrawCalls: 1,
    maxConstraints: 4,
  },
  "mobile-hero": {
    id: "mobile-hero",
    label: "Mobile hero / big win",
    exportScale: 0.5,
    maxAtlasSize: 2048,
    maxTextureMB: 8,
    maxVertices: 2000,
    maxBones: 45,
    maxInfluencesPerVertex: 4,
    maxDrawCalls: 3,
    maxConstraints: 12,
  },
  "desktop-hero": {
    id: "desktop-hero",
    label: "Desktop hero",
    exportScale: 1,
    maxAtlasSize: 4096,
    maxTextureMB: 32,
    maxVertices: 4000,
    maxBones: 70,
    maxInfluencesPerVertex: 4,
    maxDrawCalls: 4,
    maxConstraints: 20,
  },
};

export type BudgetReport = {
  target: BudgetTarget;
  metrics: BudgetMetric[];
  atlas: { pages: number; width: number; height: number; fillPct: number };
  /** Overall status: the worst metric. */
  status: BudgetStatus;
  /** 0..100, share of metrics within target. */
  score: number;
};

function grade(value: number, target: number): BudgetStatus {
  if (value <= target) return "good";
  if (value <= target * 1.25) return "warn";
  return "over";
}

function pot(n: number): number {
  let p = 64;
  while (p < n) p <<= 1;
  return p;
}

/** Packs every part at the export scale into pages no larger than `maxSize`. */
export function measureAtlas(project: SpineForgeProject, scale: number, maxSize: number, padding = 2) {
  const packer = new MaxRectsPacker(maxSize, maxSize, padding, { smart: true, pot: true, square: false, allowRotation: false });
  let usedArea = 0;
  const pageOf: Record<string, number> = {};
  for (const part of project.parts) {
    const w = Math.max(1, Math.round(part.w * project.width * scale));
    const h = Math.max(1, Math.round(part.h * project.height * scale));
    usedArea += w * h;
    packer.add(Math.min(w, maxSize), Math.min(h, maxSize), { name: part.name });
  }
  packer.bins.forEach((bin, i) => {
    for (const r of bin.rects) pageOf[(r.data as { name: string }).name] = i;
  });
  const pages = packer.bins.map((b) => ({ w: pot(b.width), h: pot(b.height) }));
  const totalArea = pages.reduce((s, p) => s + p.w * p.h, 0);
  const largest = pages.reduce((m, p) => (p.w * p.h > m.w * m.h ? p : m), { w: 0, h: 0 });
  return {
    pages: pages.length,
    width: largest.w,
    height: largest.h,
    bytes: totalArea * 4,
    fillPct: totalArea > 0 ? Math.round((usedArea / totalArea) * 100) : 0,
    pageOf,
  };
}

export function computeBudget(project: SpineForgeProject, target: BudgetTarget): BudgetReport {
  const atlas = measureAtlas(project, target.exportScale, target.maxAtlasSize);
  const textureMB = atlas.bytes / (1024 * 1024);

  let vertices = 0;
  let maxInfluences = 1;
  for (const part of project.parts) {
    const mesh = part.mesh;
    if (!mesh) {
      vertices += 4;
      continue;
    }
    const vCount = mesh.positions.length / 2;
    vertices += vCount;
    for (let v = 0; v < vCount; v++) {
      let n = 0;
      for (let k = 0; k < 4; k++) if ((mesh.weights[v * 4 + k] ?? 0) > 1e-3) n++;
      if (n > maxInfluences) maxInfluences = n;
    }
  }

  // Runtimes batch consecutive slots that share a texture page and blend mode.
  let drawCalls = 0;
  let lastKey = "";
  for (const part of project.parts) {
    const key = `${atlas.pageOf[part.name] ?? 0}|${part.blendMode ?? "normal"}`;
    if (key !== lastKey) drawCalls++;
    lastKey = key;
  }

  const constraints =
    (project.ikConstraints?.length ?? 0) +
    project.bones.filter((b) => b.spring).length +
    project.bones.filter((b) => b.follow).length;

  const m = (
    id: string,
    label: string,
    value: number,
    targetValue: number,
    display: string,
    advice: string,
  ): BudgetMetric => ({ id, label, value, target: targetValue, display, status: grade(value, targetValue), advice });

  const metrics: BudgetMetric[] = [
    m("texture", "Texture memory", textureMB, target.maxTextureMB, `${textureMB.toFixed(1)} MB`,
      "Ship at a lower scale, trim transparent padding, or split rarely-seen parts to their own page."),
    m("pages", "Atlas pages", atlas.pages, 1, `${atlas.pages} × ${atlas.width}²`,
      `Parts do not fit one ${target.maxAtlasSize}px page. Each extra page adds a draw call.`),
    m("vertices", "Mesh vertices", vertices, target.maxVertices, vertices.toLocaleString(),
      "Lower mesh density on rigid parts; keep dense meshes only where they bend."),
    m("influences", "Bones per vertex", maxInfluences, target.maxInfluencesPerVertex, `${maxInfluences}`,
      "Prune weights to fewer bones per vertex; each influence costs skinning time."),
    m("bones", "Bones", project.bones.length, target.maxBones, `${project.bones.length}`,
      "Merge bones that never move independently."),
    m("drawcalls", "Draw calls", drawCalls, target.maxDrawCalls, `${drawCalls}`,
      "Group additive/screen slots together in draw order so they batch."),
    m("constraints", "Constraints", constraints, target.maxConstraints, `${constraints}`,
      "Each IK, physics or follow constraint is solved every frame; bake the ones that never change."),
  ];

  const order: BudgetStatus[] = ["good", "warn", "over"];
  const status = metrics.reduce<BudgetStatus>((w, x) => (order.indexOf(x.status) > order.indexOf(w) ? x.status : w), "good");
  const score = Math.round((metrics.filter((x) => x.status === "good").length / metrics.length) * 100);

  return { target, metrics, atlas: { pages: atlas.pages, width: atlas.width, height: atlas.height, fillPct: atlas.fillPct }, status, score };
}
