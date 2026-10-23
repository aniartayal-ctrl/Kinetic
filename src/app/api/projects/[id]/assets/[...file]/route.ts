import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http";
import { resolveProjectAsset } from "@/server/projects";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".json": "application/json",
  ".psd": "image/vnd.adobe.photoshop",
};

/**
 * Serves imported layer images from projects/<id>/assets. Files written at run time are not
 * served from public/ by `next start`, so imports are streamed through this route instead.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; file: string[] }> }) {
  try {
    const { id, file } = await params;
    const target = resolveProjectAsset(id, file);
    if (!existsSync(target) || !statSync(target).isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(readFileSync(target)), {
      headers: {
        "Content-Type": TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    return errorResponse(err, "Could not read asset");
  }
}
