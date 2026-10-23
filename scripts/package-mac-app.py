#!/usr/bin/env python3
"""Packages SpineForge.app as a standalone native macOS application bundle with:
- Apple Metal 120Hz ProMotion binary (`Contents/MacOS/SpineForge`)
- Apple Metal GPU CLI (`Contents/MacOS/spineforge-metal-cli`)
- Kinetic Pro app icon (`Contents/Resources/AppIcon.icns`, built by `npm run brand`)
- Self-contained preset rigs & textures (`Contents/Resources/presets/`)
- Ad-hoc code signature (`codesign --force --deep --sign -`)
"""

from __future__ import annotations

import plistlib
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP_BUNDLE = ROOT / "SpineForge.app"
BRAND_ICNS = ROOT / "public" / "brand" / "AppIcon.icns"


def build_icns(dest_icns: Path) -> None:
    """Copies the brand icon (`npm run brand` renders it from scripts/brand.mjs)."""
    if not BRAND_ICNS.exists():
        raise SystemExit("public/brand/AppIcon.icns is missing: run `npm run brand` first.")
    shutil.copy2(BRAND_ICNS, dest_icns)


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
