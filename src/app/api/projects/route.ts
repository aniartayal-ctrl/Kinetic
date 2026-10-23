import path from "node:path";
import { NextResponse } from "next/server";
import type { SpineForgeProject } from "@/core/schema";
import { blockCrossSite, errorResponse, readJson } from "@/server/http";
import { listProjects, saveProjectFile } from "@/server/projects";

export const dynamic = "force-dynamic";

/** Lists saved projects, newest first. */
export async function GET() {
  try {
    return NextResponse.json({ projects: listProjects() });
  } catch (err) {
    return errorResponse(err, "Could not list projects");
  }
}

/** Saves a project to projects/<id>/<id>.project.json (previous version goes to backups/). */
export async function POST(request: Request) {
  const blocked = blockCrossSite(request);
  if (blocked) return blocked;
  const body = await readJson<{ project?: SpineForgeProject }>(request);
  if (body instanceof NextResponse) return body;
  if (!body.project || typeof body.project !== "object") {
    return NextResponse.json({ error: "Invalid project payload" }, { status: 400 });
  }
  try {
    const saved = saveProjectFile(body.project);
    const rel = (p: string) => path.relative(process.cwd(), p);
    return NextResponse.json({
      saved: true,
      id: body.project.id,
      file: rel(saved.file),
      savedAt: saved.savedAt,
      backup: saved.backup ? rel(saved.backup) : null,
      unchanged: saved.unchanged,
    });
  } catch (err) {
    return errorResponse(err, "Save failed");
  }
}
