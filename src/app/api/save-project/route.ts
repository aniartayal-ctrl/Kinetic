import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { SpineForgeProject } from "@/core/schema";
import { validateProject } from "@/core/schema";
import { UnsafePathError, assertSafeProjectId, resolveInside } from "@/server/safe-paths";

export async function POST(request: Request) {
  try {
    const { project } = (await request.json()) as { project: SpineForgeProject };
    if (!project || typeof project !== "object") {
      return NextResponse.json({ error: "Invalid project payload" }, { status: 400 });
    }
    const id = assertSafeProjectId(project.id);
    const errors = validateProject(project);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
    }

    const json = JSON.stringify(project, null, 2) + "\n";
    const paths: string[] = [];
    for (const root of [path.join(process.cwd(), "public", "presets"), path.join(process.cwd(), "exports")]) {
      const dir = resolveInside(root, id);
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${id}.project.json`);
      writeFileSync(file, json);
      paths.push(file);
    }

    return NextResponse.json({ saved: true, paths, timestamp: new Date().toISOString() });
  } catch (err) {
    const status = err instanceof UnsafePathError ? 400 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Save failed" }, { status });
  }
}
