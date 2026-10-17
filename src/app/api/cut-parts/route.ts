import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const configRaw = (formData.get("config") as string | null) ?? "{}";
    const projectId = ((formData.get("projectId") as string | null) ?? "custom-hero")
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "-");

    if (!file) {
      return NextResponse.json({ error: "Missing image or PSD file" }, { status: 400 });
    }

    const outDir = path.join(process.cwd(), "public", "presets", projectId);
    mkdirSync(outDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.toLowerCase().endsWith(".psd") ? ".psd" : ".png";
    const srcPath = path.join(outDir, `source${ext}`);
    writeFileSync(srcPath, buffer);

    const scriptPath = path.join(process.cwd(), "vision", "part_cutter.py");

    if (ext === ".psd") {
      const { stdout } = await execFileAsync("python3", [scriptPath, "psd", srcPath, outDir]);
      const parsed = JSON.parse(stdout);
      return NextResponse.json({ projectId, ...parsed });
    } else {
      const cfgPath = path.join(outDir, "cut-config.json");
      writeFileSync(cfgPath, configRaw);
      const { stdout } = await execFileAsync("python3", [scriptPath, "cut", srcPath, outDir, "--config", cfgPath]);
      const parsed = JSON.parse(stdout);
      for (const p of parsed.parts ?? []) {
        p.src = `/presets/${projectId}/${p.src}`;
      }
      return NextResponse.json({
        projectId,
        heroSrc: `/presets/${projectId}/source.png`,
        ...parsed,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Part cutter failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  const pkgPath = path.join(process.cwd(), "unity-package", "com.spineforge.runtime", "package.json");
  return NextResponse.json({
    visionWorker: "ready",
    unityPackageReady: Boolean(readFileSync(pkgPath, { encoding: "utf8", flag: "r" })),
  });
}
