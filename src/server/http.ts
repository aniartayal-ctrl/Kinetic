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

/**
 * Refuses writes that a different website triggers in the user's browser. The studio runs on
 * localhost, and browsers send simple cross-site POSTs (text/plain, form data) without a CORS check,
 * so without this any page could overwrite projects, run the part cutter or spend the API key.
 * Scripts and curl send neither header and are allowed.
 */
export function blockCrossSite(request: Request): NextResponse | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== "null") {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch {
      /* malformed origin */
    }
    if (host !== request.headers.get("host")) return NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
  } else if (origin === "null") {
    return NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
  }
  return null;
}
