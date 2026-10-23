#!/usr/bin/env node
/**
 * Kinetic Pro app icon ("Implied"): the stem and leg of the K are drawn, the upper arm is left to
 * the eye, and the AI spark sits where it would end.
 *
 * One geometry, every size the app ships (`npm run brand`):
 *   public/brand/kinetic-icon.svg         app icon on the macOS grid (1024 canvas, 824 tile)
 *   public/brand/kinetic-icon-small.svg   heavier strokes for 16–64 px (title bar, dialogs)
 *   public/brand/kinetic-mark.svg         glyph only, for dark backgrounds
 *   public/brand/kinetic-mark-mono.svg    one colour, for light backgrounds and print
 *   public/brand/kinetic-icon-1024.png    raster master
 *   public/brand/AppIcon.icns             Mac app icon (also copied into Kinetic Pro.app)
 *   src/app/icon.svg                      favicon, tile cropped to the box
 *   src/app/favicon.ico                   16/32/48 px for browsers without SVG favicons
 *   src/app/apple-icon.png                180 px full-bleed home-screen icon
 *
 * Rasters come from the Playwright Chromium the UI smoke test already uses.
 */
import { chromium } from "playwright";
import { copyFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (p) => path.join(ROOT, p);
const n = (v) => String(Math.round(v * 100) / 100);

// ── Geometry (1024 canvas) ──

function squircle(cx, cy, size, power = 5, steps = 360) {
  const a = size / 2;
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push(`${(cx + a * Math.sign(c) * Math.abs(c) ** (2 / power)).toFixed(2)},${(cy + a * Math.sign(s) * Math.abs(s) ** (2 / power)).toFixed(2)}`);
  }
  return `M${pts.join(" L")} Z`;
}

/** Four-point spark with concave sides. */
function sparkle(cx, cy, r, k = 0.13) {
  const p = (deg, d) => [cx + d * Math.cos((deg * Math.PI) / 180), cy + d * Math.sin((deg * Math.PI) / 180)];
  const f = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  let d = `M${f(p(-90, r))}`;
  for (let i = 0; i < 4; i++) d += ` Q${f(p(i * 90 - 45, k * r))} ${f(p(i * 90, r))}`;
  return `${d} Z`;
}

const TILE = squircle(512, 512, 824);
const WHITE = ["#FFFFFF", "#E3E5EA"];
const MINT = ["#7CF2BE", "#1FB49C"];
const INK = "#1D1D1F";

/** Stem, leg and spark. `heavy` thickens everything for 16–64 px. */
function glyph(heavy = false) {
  const w = heavy ? 128 : 112;
  const xs = 366;
  const J = [xs + w / 2 + 30, 522];
  const c = Math.SQRT1_2;
  const leg = 236;
  return {
    w,
    xs,
    top: 322,
    bottom: 746,
    J,
    leg,
    legEnd: [J[0] + leg * c, J[1] + leg * c],
    spark: [J[0] + 258 * c, J[1] - 258 * c],
    r: heavy ? 96 : 84,
  };
}

const linear = (id, [a, b], y1, y2) =>
  `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${n(y1)}" x2="0" y2="${n(y2)}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

function glyphDefs(g) {
  return linear("kp-ink", WHITE, g.top, g.bottom) + linear("kp-mint", MINT, g.spark[1] - g.r, g.legEnd[1] + g.w / 2);
}

function glyphShapes(g, fills) {
  return (
    `<rect x="${n(g.xs - g.w / 2)}" y="${g.top}" width="${g.w}" height="${g.bottom - g.top}" rx="${g.w / 2}" fill="${fills.stem}"/>` +
    `<rect x="${n(g.J[0] - g.w / 2)}" y="${n(g.J[1] - g.w / 2)}" width="${g.leg + g.w}" height="${g.w}" rx="${g.w / 2}" fill="${fills.leg}" transform="rotate(45 ${n(g.J[0])} ${n(g.J[1])})"/>` +
    `<path d="${sparkle(g.spark[0], g.spark[1], g.r)}" fill="${fills.spark}"/>`
  );
}

const COLOR = { stem: "url(#kp-ink)", leg: "url(#kp-mint)", spark: "url(#kp-mint)" };
const LIFT = `<filter id="kp-lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="16" flood-color="#000" flood-opacity="0.38"/></filter>`;

const doc = (viewBox, w, h, defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}" height="${n(h)}" viewBox="${viewBox}" role="img" aria-label="Kinetic Pro"><defs>${defs}</defs>${body}</svg>\n`;

/** App icon on the macOS grid. `crop` frames the tile edge to edge (favicons); `shadow` adds the macOS tile shadow. */
function icon({ heavy = false, crop = false, shadow = false } = {}) {
  const g = glyph(heavy);
  const defs =
    `<linearGradient id="kp-tile" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2B2D33"/><stop offset="1" stop-color="#101114"/></linearGradient>` +
    `<radialGradient id="kp-sheen" cx="0.3" cy="0" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity="0.1"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    glyphDefs(g) +
    LIFT +
    (shadow ? `<filter id="kp-drop" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.3"/></filter>` : "");
  const body =
    `<path d="${TILE}" fill="url(#kp-tile)"${shadow ? ' filter="url(#kp-drop)"' : ""}/><path d="${TILE}" fill="url(#kp-sheen)"/>` +
    `<g filter="url(#kp-lift)">${glyphShapes(g, COLOR)}</g>`;
  return crop ? doc("96 96 832 832", 832, 832, defs, body) : doc("0 0 1024 1024", 1024, 1024, defs, body);
}

/** Square, edge-to-edge background: the platform rounds the corners (Apple touch icon). */
function fullBleed() {
  const g = glyph(false);
  const defs =
    linear("kp-tile", ["#2B2D33", "#101114"], 100, 924) +
    `<radialGradient id="kp-sheen" gradientUnits="userSpaceOnUse" cx="347.2" cy="100" r="741.6"><stop offset="0" stop-color="#fff" stop-opacity="0.1"/><stop offset="0.6" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    glyphDefs(g) +
    LIFT;
  const body =
    `<rect x="100" y="100" width="824" height="824" fill="url(#kp-tile)"/><rect x="100" y="100" width="824" height="824" fill="url(#kp-sheen)"/>` +
    `<g filter="url(#kp-lift)">${glyphShapes(g, COLOR)}</g>`;
  return doc("100 100 824 824", 824, 824, defs, body);
}

/** The glyph alone, cropped to its bounds. */
function mark(mono = false) {
  const g = glyph(false);
  const h = g.w / 2;
  const x0 = Math.min(g.xs - h, g.spark[0] - g.r) - 16;
  const y0 = Math.min(g.top, g.spark[1] - g.r) - 16;
  const x1 = Math.max(g.xs + h, g.legEnd[0] + h, g.spark[0] + g.r) + 16;
  const y1 = Math.max(g.bottom, g.legEnd[1] + h) + 16;
  const fills = mono ? { stem: INK, leg: INK, spark: INK } : COLOR;
  return doc(`${n(x0)} ${n(y0)} ${n(x1 - x0)} ${n(y1 - y0)}`, x1 - x0, y1 - y0, mono ? "" : glyphDefs(g), glyphShapes(g, fills));
}

// ── Containers: both formats hold PNGs as-is ──

function ico(images) {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const o = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, o);
    head.writeUInt8(size >= 256 ? 0 : size, o + 1);
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(png.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map((im) => im.png)]);
}

function icns(entries) {
  const chunks = entries.map(([type, png]) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, "ascii");
    h.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([h, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

// ── Build ──

const files = {
  "public/brand/kinetic-icon.svg": icon({ shadow: true }),
  "public/brand/kinetic-icon-small.svg": icon({ heavy: true }),
  "public/brand/kinetic-mark.svg": mark(),
  "public/brand/kinetic-mark-mono.svg": mark(true),
  "src/app/icon.svg": icon({ heavy: true, crop: true }),
};
for (const [p, svg] of Object.entries(files)) writeFileSync(at(p), svg);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 1 });
async function png(svg, size) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(`<html><body style="margin:0;background:transparent"><img id="i" src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`);
  await page.waitForFunction(() => {
    const img = document.getElementById("i");
    return img?.complete && img.naturalWidth > 0;
  });
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

try {
  const big = icon({ shadow: true });
  const small = icon({ heavy: true });
  const fav = files["src/app/icon.svg"];
  const master = await png(big, 1024);
  writeFileSync(at("public/brand/kinetic-icon-1024.png"), master);
  writeFileSync(at("src/app/apple-icon.png"), await png(fullBleed(), 180));
  writeFileSync(at("src/app/favicon.ico"), ico([{ size: 16, png: await png(fav, 16) }, { size: 32, png: await png(fav, 32) }, { size: 48, png: await png(fav, 48) }]));

  const s256 = await png(big, 256);
  const s512 = await png(big, 512);
  const appIcon = icns([
    ["ic11", await png(small, 32)],
    ["ic12", await png(small, 64)],
    ["ic07", await png(big, 128)],
    ["ic13", s256],
    ["ic08", s256],
    ["ic14", s512],
    ["ic09", s512],
    ["ic10", master],
  ]);
  writeFileSync(at("public/brand/AppIcon.icns"), appIcon);
  const bundled = at("Kinetic Pro.app/Contents/Resources/AppIcon.icns");
  if (existsSync(path.dirname(bundled))) copyFileSync(at("public/brand/AppIcon.icns"), bundled);
} finally {
  await browser.close();
}
console.log("Brand icons written: public/brand, src/app (icon.svg, favicon.ico, apple-icon.png), Kinetic Pro.app AppIcon.icns");
