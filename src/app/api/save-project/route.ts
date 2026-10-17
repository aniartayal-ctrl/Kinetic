import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { SpineForgeProject } from "@/core/schema";

export async function POST(request: Request) {
  try {
    const { project } = (await request.json()) as { project: SpineForgeProject };
    if (!project?.id) {
      return NextResponse.json({ error: "Invalid project payload" }, { status: 400 });
    }
    const json = JSON.stringify(project, null, 2) + "\n";

    const presetDir = path.join(process.cwd(), "public", "presets", project.id);
    mkdirSync(presetDir, { recursive: true });
    const presetFile = path.join(presetDir, `${project.id}.project.json`);
    writeFileSync(presetFile, json);

    const exportDir = path.join(process.cwd(), "exports", project.id);
    mkdirSync(exportDir, { recursive: true });
    const exportFile = path.join(exportDir, `${project.id}.project.json`);
    writeFileSync(exportFile, json);

    return NextResponse.json({
      saved: true,
      paths: [presetFile, exportFile],
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 },
    );
  }
}
