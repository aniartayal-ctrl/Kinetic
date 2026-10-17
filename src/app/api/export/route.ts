import { NextResponse } from "next/server";
import type { SpineForgeProject } from "@/core/schema";
import { validateProject } from "@/core/schema";
import { buildCompleteUnityExportBundle } from "@/exporters/node-bundle-builder";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      project: SpineForgeProject;
      format?: "preview" | "zip";
      sheetCellHeight?: number;
      sheetFps?: number;
    };

    const project = body.project;
    const errors = validateProject(project);
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
    }

    const bundle = await buildCompleteUnityExportBundle(project, {
      sheetCellHeight: body.sheetCellHeight ?? 192,
      sheetFps: body.sheetFps ?? 10,
      useAlphaContourMeshes: true,
    });

    if (body.format === "zip") {
      return new NextResponse(new Uint8Array(bundle.zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${project.id}-unity-bundle.zip"`,
        },
      });
    }

    return NextResponse.json({
      id: bundle.id,
      atlasDataUrl: `data:image/png;base64,${bundle.atlasPng.toString("base64")}`,
      spriteSheetDataUrl: `data:image/png;base64,${bundle.spriteSheetPng.toString("base64")}`,
      spineJson: bundle.spineJson,
      spineAtlasTxt: bundle.spineAtlasTxt,
      unitySfRigJson: bundle.unitySfRigJson,
      spriteSheetJson: bundle.spriteSheetJson,
      zipBase64: bundle.zipBuffer.toString("base64"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
