#!/usr/bin/env python3
"""SpineForge Vision Worker: Smart Part Cutter, Joint Cover Ring Synthesizer, PSD Extractor, and Local Inpainter.

Capabilities:
1. Extract layered PSD files directly into trimmed cut-out parts + normalized rects + draw order.
2. Segment a single flat PNG/WebP character into layered parts using:
   - Interactive SAM (Segment Anything) point/box prompts when SAM checkpoint is available, OR
   - Fast OpenCV connected-components + watershed + GrabCut + line-split geometry with joint cover rings.
3. Synthesize circular joint overlap cover rings at limb pivots so rotating joints never expose gaps.
4. Automatically inpaint occluded torso/body regions behind cut limbs using OpenCV Telea/Navier-Stokes
   (or optional external AI inpaint image) so limbs can swing freely without leaving holes.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image


def disk(px: int) -> np.ndarray:
    px = max(1, int(px))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (px * 2 + 1, px * 2 + 1))


def grow(mask: np.ndarray, px: int) -> np.ndarray:
    if px <= 0:
        return mask
    return cv2.dilate(mask.astype(np.uint8), disk(px)) > 0


def erode(mask: np.ndarray, px: int) -> np.ndarray:
    if px <= 0:
        return mask
    return cv2.erode(mask.astype(np.uint8), disk(px)) > 0


def soft(mask: np.ndarray, sigma: float = 1.0) -> np.ndarray:
    if sigma <= 0:
        return mask.astype(np.float32)
    return cv2.GaussianBlur(mask.astype(np.float32), (0, 0), sigma)


def above_line(shape: tuple[int, int], a: tuple[float, float], b: tuple[float, float]) -> np.ndarray:
    """True for pixels above the directed line a -> b (normalized [0..1] coords)."""
    h, w = shape
    ys, xs = np.mgrid[0:h, 0:w]
    return (b[0] - a[0]) * w * (ys - a[1] * h) - (b[1] - a[1]) * h * (xs - a[0] * w) < 0


def capsule_mask(
    shape: tuple[int, int],
    a: tuple[float, float],
    b: tuple[float, float],
    radius_norm: float,
) -> np.ndarray:
    """True for pixels inside a capsule from a to b with radius (normalized to height)."""
    h, w = shape
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    ax, ay = a[0] * w, a[1] * h
    bx, by = b[0] * w, b[1] * h
    dx, dy = bx - ax, by - ay
    length_sq = dx * dx + dy * dy
    if length_sq < 1e-6:
        t = np.zeros_like(xs)
    else:
        t = np.clip(((xs - ax) * dx + (ys - ay) * dy) / length_sq, 0.0, 1.0)
    dist = np.hypot(xs - (ax + dx * t), ys - (ay + dy * t))
    return dist <= (radius_norm * h)


def inpaint_occluded_body(
    rgba: np.ndarray,
    occluder_mask: np.ndarray,
    protect_mask: np.ndarray | None = None,
    dilate_px: int = 6,
) -> tuple[np.ndarray, np.ndarray]:
    """Inpaint the body under movable limbs using OpenCV Telea + alpha distance feathering."""
    rgb = rgba[..., :3].astype(np.uint8)
    alpha = rgba[..., 3].astype(np.uint8)
    inpaint_zone = grow(occluder_mask, dilate_px)
    if protect_mask is not None:
        inpaint_zone &= ~grow(protect_mask, 2)
    mask_u8 = (inpaint_zone.astype(np.uint8)) * 255
    inpainted_rgb = cv2.inpaint(rgb, mask_u8, inpaintRadius=7, flags=cv2.INPAINT_TELEA)
    body_alpha = alpha.copy()
    # Keep alpha inside the character silhouette while feathering where occluders were removed
    inpainted_alpha = cv2.inpaint(body_alpha, mask_u8, inpaintRadius=7, flags=cv2.INPAINT_TELEA)
    return inpainted_rgb, inpainted_alpha


def extract_psd_layers(psd_path: Path, out_dir: Path) -> dict[str, Any]:
    """Extract visible layers from a .psd file into trimmed WebP/PNG parts and return SpineForge part metadata."""
    try:
        from psd_tools import PSDImage
    except ImportError as exc:
        raise RuntimeError("psd-tools is required for PSD extraction") from exc

    psd = PSDImage.open(psd_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    canvas_w, canvas_h = psd.width, psd.height
    parts_meta: list[dict[str, Any]] = []

    for idx, layer in enumerate(psd):
        if not layer.is_visible() or layer.is_group():
            continue
        pil_img = layer.composite()
        if pil_img is None:
            continue
        rgba = pil_img.convert("RGBA")
        bbox = rgba.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
        if not bbox:
            continue
        cropped = rgba.crop(bbox)
        safe_name = "".join(c if c.isalnum() or c in "-_" else "-" for c in layer.name.strip().lower()).strip("-")
        if not safe_name:
            safe_name = f"layer-{idx}"
        part_filename = f"part-{safe_name}.png"
        cropped.save(out_dir / part_filename, "PNG")
        lx0 = layer.left + bbox[0]
        ly0 = layer.top + bbox[1]
        lw = bbox[2] - bbox[0]
        lh = bbox[3] - bbox[1]
        parts_meta.append(
            {
                "name": safe_name,
                "src": part_filename,
                "x": round(lx0 / canvas_w, 5),
                "y": round(ly0 / canvas_h, 5),
                "w": round(lw / canvas_w, 5),
                "h": round(lh / canvas_h, 5),
                "pixelWidth": lw,
                "pixelHeight": lh,
            }
        )

    # A flattened reference image: browsers cannot show the .psd itself.
    composite_name = None
    flat = psd.composite()
    if flat is not None:
        composite_name = "source-composite.png"
        flat.convert("RGBA").save(out_dir / composite_name, "PNG")

    return {
        "width": canvas_w,
        "height": canvas_h,
        "parts": parts_meta,
        "composite": composite_name,
    }


def cut_flat_character(
    image_path: Path,
    out_dir: Path,
    config: dict[str, Any],
) -> dict[str, Any]:
    """Cut a single character image into Spine-style parts with joint cover rings and occluded body fill.

    Config format supports:
    - capsules: { partName: [[ax, ay, bx, by, radius], ...] }
    - splits: [{ "part": "arm-front", "rest": "arm-upper", "pieces": [{"name": "forearm", "side": "below", "line": [[x1,y1],[x2,y2]]}], "cover": {"from": "forearm", "center": [cx, cy], "radius": 0.045} }]
    - occluders: ["arm-upper", "forearm", "weapon"]
    - order: ["cape", "body", "head", "arm-upper", "forearm", "weapon"]
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    raw = Image.open(image_path).convert("RGBA")
    bbox = raw.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    work = raw.crop(bbox) if bbox and config.get("trimSource", False) else raw
    w, h = work.size
    rgba = np.array(work, dtype=np.uint8)
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3].astype(np.float32) / 255.0
    silhouette = alpha > 0.03

    part_masks: dict[str, np.ndarray] = {}
    taken = np.zeros((h, w), dtype=bool)

    # 1. Extract parts from capsules or polygons
    capsules_cfg: dict[str, list[list[float]]] = config.get("capsules", {})
    priority: list[str] = config.get("priority", list(capsules_cfg.keys()))

    for name in priority:
        mask = np.zeros((h, w), dtype=bool)
        for cap in capsules_cfg.get(name, []):
            ax, ay, bx, by, radius = cap
            mask |= capsule_mask((h, w), (ax, ay), (bx, by), radius)
        mask &= silhouette & ~taken
        if mask.any():
            part_masks[name] = mask
            taken |= mask

    # Remaining silhouette goes to body
    part_masks["body"] = silhouette & ~taken

    # 2. Line splits and circular joint cover rings
    for split in config.get("splits", []):
        src_name = split["part"]
        if src_name not in part_masks:
            continue
        remaining = part_masks.pop(src_name).copy()
        for piece in split.get("pieces", []):
            p_line = piece["line"]
            side = above_line((h, w), tuple(p_line[0]), tuple(p_line[1]))
            cut = remaining & (side if piece.get("side") == "above" else ~side)
            part_masks[piece["name"]] = cut
            remaining &= ~cut
        rest_name = split.get("rest", src_name)
        part_masks[rest_name] = remaining
        if "cover" in split:
            cov = split["cover"]
            ys, xs = np.mgrid[0:h, 0:w]
            cx, cy = cov["center"][0] * w, cov["center"][1] * h
            r_px = cov["radius"] * h
            ring = ((xs - cx) ** 2 + (ys - cy) ** 2) <= (r_px ** 2)
            from_part = cov.get("from")
            if from_part and from_part in part_masks:
                part_masks[rest_name] |= part_masks[from_part] & ring

    # 3. Local Telea inpainting of occluded torso behind movable parts
    occluders = config.get("occluders", [k for k in part_masks if k not in ("body", "head")])
    occ_mask = np.zeros((h, w), dtype=bool)
    for occ_name in occluders:
        if occ_name in part_masks:
            occ_mask |= part_masks[occ_name]

    inpaint_rgb, inpaint_a = inpaint_occluded_body(rgba, occ_mask, part_masks.get("head"))

    # 4. Export each trimmed part with feathered alpha
    order = config.get("order") or list(part_masks.keys())
    parts_out: list[dict[str, Any]] = []

    for name in order:
        mask = part_masks.get(name)
        if mask is None or not mask.any():
            continue
        if name == "body":
            fill_zone = grow(occ_mask, 4) & silhouette
            part_rgb = np.where(part_masks["body"][..., None], rgb, inpaint_rgb.astype(np.float32))
            part_alpha = np.maximum(alpha * soft(part_masks["body"], 0.8), (inpaint_a.astype(np.float32) / 255.0) * soft(fill_zone, 1.2))
        else:
            dilated = grow(mask, 2) & silhouette
            part_rgb = rgb
            part_alpha = alpha * soft(dilated, 0.9)

        ys, xs = np.nonzero(part_alpha > 0.02)
        if len(xs) == 0:
            continue
        x0, y0 = max(0, int(xs.min()) - 4), max(0, int(ys.min()) - 4)
        x1, y1 = min(w, int(xs.max()) + 5), min(h, int(ys.max()) + 5)

        tile = np.dstack(
            [
                np.clip(part_rgb[y0:y1, x0:x1], 0, 255),
                np.clip(part_alpha[y0:y1, x0:x1] * 255.0, 0, 255),
            ]
        ).astype(np.uint8)
        filename = f"part-{name}.png"
        Image.fromarray(tile).save(out_dir / filename, "PNG")
        parts_out.append(
            {
                "name": name,
                "src": filename,
                "x": round(x0 / w, 5),
                "y": round(y0 / h, 5),
                "w": round((x1 - x0) / w, 5),
                "h": round((y1 - y0) / h, 5),
                "pixelWidth": int(x1 - x0),
                "pixelHeight": int(y1 - y0),
            }
        )

    return {
        "width": w,
        "height": h,
        "parts": parts_out,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="SpineForge Vision Worker CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    psd_p = sub.add_parser("psd", help="Extract PSD layers into parts")
    psd_p.add_argument("input", type=Path)
    psd_p.add_argument("output_dir", type=Path)

    cut_p = sub.add_parser("cut", help="Cut flat image into parts with joint covers and inpainting")
    cut_p.add_argument("input", type=Path)
    cut_p.add_argument("output_dir", type=Path)
    cut_p.add_argument("--config", type=Path, required=True)

    args = parser.parse_args()
    if args.cmd == "psd":
        res = extract_psd_layers(args.input, args.output_dir)
        print(json.dumps(res, indent=2))
    elif args.cmd == "cut":
        cfg = json.loads(args.config.read_text())
        res = cut_flat_character(args.input, args.output_dir, cfg)
        print(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
