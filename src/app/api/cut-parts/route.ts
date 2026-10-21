import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { resolveInside, toSafeProjectId } from "@/server/safe-paths";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB covers large layered PSDs

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const configRaw = (formData.get("config") as string | null) ?? "{}";
    const projectId = toSafeProjectId(formData.get("projectId") as string | null);

    if (!file) {
      return NextResponse.json({ error: "Missing image or PSD file" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File is larger than 200 MB" }, { status: 413 });
    }
    try {
      JSON.parse(configRaw);
    } catch {
      return NextResponse.json({ error: "Cut config is not valid JSON" }, { status: 400 });
    }

    const outDir = resolveInside(path.join(process.cwd(), "public", "presets"), projectId);
    mkdirSync(outDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = file.name.toLowerCase().endsWith(".psd") ? ".psd" : ".png";
    const srcPath = path.join(outDir, `source${ext}`);
    writeFileSync(srcPath, buffer);

    const scriptPath = path.join(process.cwd(), "vision", "part_cutter.py");

    if (ext === ".psd") {
      const { stdout } = await execFileAsync("python3", [scriptPath, "psd", srcPath, outDir], {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
      });
      const parsed = JSON.parse(stdout);
      return NextResponse.json({ projectId, ...parsed });
    } else {
      const cfgPath = path.join(outDir, "cut-config.json");
      writeFileSync(cfgPath, configRaw);
      const { stdout } = await execFileAsync("python3", [scriptPath, "cut", srcPath, outDir, "--config", cfgPath], {
        maxBuffer: 64 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
      });
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
  return NextResponse.json({ visionWorker: "ready", unityPackageReady: existsSync(pkgPath) });
}
