import { NextResponse } from "next/server";
import { ProjectFileError } from "./projects";
import { UnsafePathError } from "./safe-paths";

/** Maps known errors to 4xx responses; anything unexpected is a 500. */
export function errorResponse(err: unknown, fallback = "Request failed"): NextResponse {
  const status = err instanceof ProjectFileError ? err.status : err instanceof UnsafePathError ? 400 : 500;
  return NextResponse.json({ error: err instanceof Error ? err.message : fallback }, { status });
}

/** Parses a JSON body, answering 400 instead of 500 when it is not JSON. */
export async function readJson<T>(request: Request): Promise<T | NextResponse> {
  try {
    return (await request.json()) as T;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
}
