import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http";
import { loadProjectFile } from "@/server/projects";

export const dynamic = "force-dynamic";

/** Loads one saved project. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ project: loadProjectFile(id) });
  } catch (err) {
    return errorResponse(err, "Could not open project");
  }
}
