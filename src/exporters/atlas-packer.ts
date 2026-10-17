/**
 * Texture Atlas Packer (`src/exporters/atlas-packer.ts`)
 *
 * Uses `maxrects-packer` to pack trimmed part textures or baked flipbook frames into a single
 * power-of-two texture atlas, and formats Spine 4.2 `.atlas.txt` + Unity UV rect tables.
 */

import { MaxRectsPacker } from "maxrects-packer";

export type AtlasInputRegion = {
  name: string;
  width: number;
  height: number;
  /** Optional raw PNG/RGBA buffer when running in Node/API. */
  buffer?: Buffer;
};

export type PackedAtlasRegion = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Normalized UV bounds [u0, v0, u1, v1] in top-left origin [0..1]. */
  uvRect: [number, number, number, number];
};

export type PackedAtlasLayout = {
  pageName: string;
  width: number;
  height: number;
  padding: number;
  regions: Record<string, PackedAtlasRegion>;
  spineAtlasText: string;
};

function nextPowerOfTwo(n: number): number {
  let p = 64;
  while (p < n && p < 8192) p <<= 1;
  return p;
}

/**
 * Computes optimal bin-packed atlas coordinates and Spine 4.2 `.atlas.txt` string for a list of regions.
 */
export function computeAtlasLayout(
  pageName: string,
  inputs: AtlasInputRegion[],
  padding = 4,
): PackedAtlasLayout {
  const packer = new MaxRectsPacker(4096, 4096, padding, {
    smart: true,
    pot: true,
    square: false,
    allowRotation: false,
  });

  for (const item of inputs) {
    packer.add(Math.max(1, item.width), Math.max(1, item.height), { name: item.name });
  }

  const bin = packer.bins[0];
  const atlasW = bin ? nextPowerOfTwo(bin.width) : 256;
  const atlasH = bin ? nextPowerOfTwo(bin.height) : 256;

  const regions: Record<string, PackedAtlasRegion> = {};
  if (bin) {
    for (const rect of bin.rects) {
      const name = (rect.data as { name: string }).name;
      regions[name] = {
        name,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        uvRect: [
          rect.x / atlasW,
          rect.y / atlasH,
          (rect.x + rect.width) / atlasW,
          (rect.y + rect.height) / atlasH,
        ],
      };
    }
  }

  const spineLines: string[] = [
    pageName,
    `size: ${atlasW},${atlasH}`,
    "format: RGBA8888",
    "filter: Linear,Linear",
    "repeat: none",
  ];

  for (const item of inputs) {
    const r = regions[item.name];
    if (!r) continue;
    spineLines.push(
      item.name,
      `  bounds: ${r.x},${r.y},${r.width},${r.height}`,
      `  offsets: 0,0,${r.width},${r.height}`,
    );
  }

  return {
    pageName,
    width: atlasW,
    height: atlasH,
    padding,
    regions,
    spineAtlasText: spineLines.join("\n") + "\n",
  };
}
