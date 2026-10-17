/**
 * Flipbook Sprite Sheet Metadata & Baker (`src/exporters/spritesheet-exporter.ts`)
 *
 * Generates `<id>.sprites.json` metadata + grid/packed sprite sheet layout for Unity's
 * flipbook SpriteRenderer / UI Image importer.
 */

import type { SpineForgeProject } from "../core/schema";

export type SpriteSheetFrameMeta = {
  clip: string;
  frameIndex: number;
  time: number;
  /** Pixel rect in top-left sheet coordinates. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Unity bottom-left Y coordinate for Sprite.Create / SpriteMetaData. */
  unityY: number;
  /** Normalized pivot [0.5, 0.025] matching root bone feet. */
  pivotX: number;
  pivotY: number;
};

export type UnitySpriteSheetManifest = {
  format: "SpineForgeSpriteSheet";
  version: "1.0.0";
  id: string;
  texturePage: string;
  sheetWidth: number;
  sheetHeight: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  pixelsPerUnit: number;
  clips: {
    name: string;
    fps: number;
    loop: boolean;
    startFrame: number;
    frameCount: number;
  }[];
  frames: SpriteSheetFrameMeta[];
};

export function buildSpriteSheetManifest(
  project: SpineForgeProject,
  options: {
    cellHeight?: number;
    columns?: number;
    fps?: number;
    clipNames?: string[];
    pixelsPerUnit?: number;
  } = {},
): UnitySpriteSheetManifest {
  const cellHeight = options.cellHeight ?? 256;
  const cols = options.columns ?? 8;
  const fps = options.fps ?? 12;
  const ppu = options.pixelsPerUnit ?? 100;

  const spanW = project.width * (1 + (project.frame.left ?? 0.25) + (project.frame.right ?? 0.25));
  const spanH = project.height * (1 + (project.frame.top ?? 0.2) + (project.frame.bottom ?? 0.05));
  const cellWidth = Math.max(32, Math.round((cellHeight * spanW) / spanH));

  const clipList = options.clipNames ?? Object.keys(project.animations);
  const clipsMeta: UnitySpriteSheetManifest["clips"] = [];
  const frames: SpriteSheetFrameMeta[] = [];

  let globalFrame = 0;
  for (const clipName of clipList) {
    const clip = project.animations[clipName];
    if (!clip) continue;
    const count = Math.max(4, Math.round(clip.duration * fps));
    const startFrame = globalFrame;

    for (let i = 0; i < count; i++) {
      const col = globalFrame % cols;
      const row = Math.floor(globalFrame / cols);
      frames.push({
        clip: clipName,
        frameIndex: i,
        time: Number(((i / count) * clip.duration).toFixed(4)),
        x: col * cellWidth,
        y: row * cellHeight,
        w: cellWidth,
        h: cellHeight,
        unityY: 0, // Filled once total sheetHeight is known
        pivotX: 0.5,
        pivotY: 0.05,
      });
      globalFrame++;
    }

    clipsMeta.push({
      name: clipName,
      fps,
      loop: clip.loop,
      startFrame,
      frameCount: count,
    });
  }

  const totalRows = Math.max(1, Math.ceil(globalFrame / cols));
  const sheetWidth = cols * cellWidth;
  const sheetHeight = totalRows * cellHeight;

  for (const f of frames) {
    f.unityY = sheetHeight - f.y - f.h;
  }

  return {
    format: "SpineForgeSpriteSheet",
    version: "1.0.0",
    id: project.id,
    texturePage: `${project.id}-sheet.png`,
    sheetWidth,
    sheetHeight,
    cellWidth,
    cellHeight,
    columns: cols,
    pixelsPerUnit: ppu,
    clips: clipsMeta,
    frames,
  };
}
