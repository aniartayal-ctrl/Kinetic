#!/usr/bin/env python3
"""Packages SpineForge.app as a standalone native macOS application bundle with:
- Apple Metal 120Hz ProMotion binary (`Contents/MacOS/SpineForge`)
- Apple Metal GPU CLI (`Contents/MacOS/spineforge-metal-cli`)
- iOS 26 / macOS 26 Liquid Glass Squircle App Icon (`Contents/Resources/AppIcon.icns`)
- Self-contained preset rigs & textures (`Contents/Resources/presets/`)
- Ad-hoc code signature (`codesign --force --deep --sign -`)
"""

from __future__ import annotations

import math
import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
APP_BUNDLE = ROOT / "SpineForge.app"


def make_liquid_glass_icon(size: int = 1024) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = int(size * 0.08)
    radius = int(size * 0.225)
    box = [margin, margin, size - margin, size - margin]

    # Deep Solarium dark-blue base squircle
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(base)
    bdraw.rounded_rectangle(box, radius=radius, fill=(8, 15, 34, 255))

    # Glowing cyan/indigo radial aura inside squircle
    aura = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    adraw = ImageDraw.Draw(aura)
    adraw.ellipse(
        [int(size * 0.16), int(size * 0.12), int(size * 0.84), int(size * 0.82)],
        fill=(34, 211, 238, 125),
    )
    adraw.ellipse(
        [int(size * 0.28), int(size * 0.35), int(size * 0.78), int(size * 0.88)],
        fill=(139, 92, 246, 110),
    )
    aura = aura.filter(ImageFilter.GaussianBlur(radius=size * 0.08))
    img = Image.alpha_composite(base, aura)

    # Liquid Glass Specular Rim & Inner Refraction
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle(
        box,
        radius=radius,
        outline=(186, 230, 253, 210),
        width=max(2, int(size * 0.012)),
    )

    # Draw stylized 2D Skeletal Bone + Delaunay Diamond Prism in center
    cx, cy = size // 2, size // 2
    pts = [
        (cx, int(size * 0.23)),
        (int(size * 0.72), cy),
        (cx, int(size * 0.77)),
        (int(size * 0.28), cy),
    ]
    draw.polygon(pts, fill=(14, 165, 233, 75), outline=(103, 232, 249, 240))
    draw.line([pts[0], pts[2]], fill=(255, 255, 255, 230), width=max(2, int(size * 0.018)))
    draw.line([pts[1], pts[3]], fill=(125, 211, 252, 190), width=max(2, int(size * 0.012)))

    for px, py in pts + [(cx, cy)]:
        r = int(size * 0.032) if (px, py) == (cx, cy) else int(size * 0.024)
        draw.ellipse([px - r, py - r, px + r, py + r], fill=(255, 255, 255, 255), outline=(14, 165, 233, 255))

    return img


def build_icns(dest_icns: Path) -> None:
    master = make_liquid_glass_icon(1024)
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "AppIcon.iconset"
        iconset.mkdir(parents=True, exist_ok=True)
        for s in [16, 32, 128, 256, 512]:
            master.resize((s, s), Image.Resampling.LANCZOS).save(iconset / f"icon_{s}x{s}.png")
            master.resize((s * 2, s * 2), Image.Resampling.LANCZOS).save(iconset / f"icon_{s}x{s}@2x.png")
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(dest_icns)], check=True)


def package_app() -> None:
    if APP_BUNDLE.exists():
        shutil.rmtree(APP_BUNDLE)

    macos_dir = APP_BUNDLE / "Contents" / "MacOS"
    res_dir = APP_BUNDLE / "Contents" / "Resources"
    macos_dir.mkdir(parents=True, exist_ok=True)
    res_dir.mkdir(parents=True, exist_ok=True)

    release_dir = ROOT / "macos-metal" / ".build" / "release"
    shutil.copy2(release_dir / "SpineForge", macos_dir / "SpineForge")
    shutil.copy2(release_dir / "spineforge-metal-cli", macos_dir / "spineforge-metal-cli")
    (macos_dir / "SpineForge").chmod(0o755)
    (macos_dir / "spineforge-metal-cli").chmod(0o755)

    # Build AppIcon.icns
    build_icns(res_dir / "AppIcon.icns")

    # Copy presets & exported .project.json files into Resources/presets/ so the .app is 100% self-contained
    presets_dst = res_dir / "presets"
    shutil.copytree(ROOT / "public" / "presets", presets_dst)
    for preset_id in ["astral-forge", "sands-of-solara"]:
        proj_json = ROOT / "exports" / preset_id / f"{preset_id}.project.json"
        if proj_json.exists():
            shutil.copy2(proj_json, presets_dst / preset_id / f"{preset_id}.project.json")
            # Also copy into public/presets/<id>/ for local runs
            shutil.copy2(proj_json, ROOT / "public" / "presets" / preset_id / f"{preset_id}.project.json")

    info_plist = {
        "CFBundleName": "SpineForge",
        "CFBundleDisplayName": "SpineForge Studio",
        "CFBundleIdentifier": "com.spineforge.macos.metal",
        "CFBundleVersion": "1.0.0",
        "CFBundleShortVersionString": "1.0.0",
        "CFBundlePackageType": "APPL",
        "CFBundleExecutable": "SpineForge",
        "CFBundleIconFile": "AppIcon",
        "LSMinimumSystemVersion": "14.0",
        "NSHighResolutionCapable": True,
        "NSSupportsAutomaticGraphicsSwitching": True,
        "NSPrincipalClass": "NSApplication",
    }
    with (APP_BUNDLE / "Contents" / "Info.plist").open("wb") as f:
        plistlib.dump(info_plist, f)

    subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(APP_BUNDLE)], check=True)
    print(f"Packaged and signed native macOS Metal app -> {APP_BUNDLE}")

    kinetic_bundle = ROOT / "Kinetic Pro.app"
    if kinetic_bundle.exists():
        shutil.rmtree(kinetic_bundle)
    shutil.copytree(APP_BUNDLE, kinetic_bundle)
    kinetic_plist_path = kinetic_bundle / "Contents" / "Info.plist"
    with kinetic_plist_path.open("rb") as f:
        kp = plistlib.load(f)
    kp["CFBundleName"] = "Kinetic Pro"
    kp["CFBundleDisplayName"] = "Kinetic Pro"
    kp["CFBundleIdentifier"] = "com.apple-style.kineticpro.metal"
    with kinetic_plist_path.open("wb") as f:
        plistlib.dump(kp, f)
    subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(kinetic_bundle)], check=True)
    print(f"Packaged and signed flagship Apple-ecosystem app -> {kinetic_bundle}")


if __name__ == "__main__":
    package_app()
