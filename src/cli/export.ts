#!/usr/bin/env node
/**
 * SpineForge CLI Exporter (`src/cli/export.ts`)
 *
 * Usage:
 *   npm run export:cli -- [preset-or-project.json | all]
 *
 * Outputs to `exports/<id>/`:
 *   - `<id>.spine.json` + `<id>.atlas.txt` + `<id>.png` (Spine 4.2 bundle)
 *   - `<id>.sfrig.json` + `<id>.png` (Zero-dependency Unity C# runtime bundle)
 *   - `<id>-sheet.png` + `<id>.sprites.json` (Baked Flipbook Sprite Sheet bundle)
 *   - `<id>-unity-bundle.zip`
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BUILTIN_PRESETS } from "../core/presets";
import { validateProject, type SpineForgeProject } from "../core/schema";
import { buildCompleteUnityExportBundle } from "../exporters/node-bundle-builder";

async function run() {
  const arg = process.argv[2] ?? "all";
  const targets: SpineForgeProject[] = [];

  if (arg === "all") {
    for (const factory of Object.values(BUILTIN_PRESETS)) {
      targets.push(factory());
    }
  } else if (BUILTIN_PRESETS[arg]) {
    targets.push(BUILTIN_PRESETS[arg]!());
  } else if (existsSync(arg)) {
    const loaded = JSON.parse(readFileSync(arg, "utf8")) as SpineForgeProject;
    targets.push(loaded);
  } else {
    console.error(`Unknown preset or file "${arg}". Available presets: ${Object.keys(BUILTIN_PRESETS).join(", ")}`);
    process.exit(1);
  }

  for (const project of targets) {
    const errors = validateProject(project);
    if (errors.length > 0) {
      console.error(`Validation failed for ${project.id}:\n` + errors.join("\n"));
      process.exit(1);
    }

    const outDir = path.join(process.cwd(), "exports", project.id);
    console.log(`Exporting "${project.title}" (${project.id}) -> ${outDir} ...`);
    const bundle = await buildCompleteUnityExportBundle(project, {
      outDir,
      sheetCellHeight: 220,
      sheetFps: 12,
      useAlphaContourMeshes: true,
    });
    const zipPath = path.join(outDir, `${project.id}-unity-bundle.zip`);
    writeFileSync(zipPath, bundle.zipBuffer);
    console.log(
      `  [OK] Spine 4.2 JSON (${(bundle.spineJson.length / 1024).toFixed(1)} KB) + Atlas (${(bundle.atlasPng.byteLength / 1024).toFixed(1)} KB)`,
    );
    console.log(
      `  [OK] Unity Custom .sfrig.json (${(bundle.unitySfRigJson.length / 1024).toFixed(1)} KB)`,
    );
    console.log(
      `  [OK] Baked Flipbook Sprite Sheet (${(bundle.spriteSheetPng.byteLength / 1024).toFixed(1)} KB) + .sprites.json`,
    );
    console.log(`  [OK] Complete Unity Bundle ZIP -> ${zipPath}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
