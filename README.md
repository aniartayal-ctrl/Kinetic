# Kinetic Pro — Apple Metal 2D Mesh, Rigging & Slot Game Animation Suite for Unity

**Kinetic Pro** is a standalone 2D skeletal, contour Delaunay mesh, weight-painting, and slot game animation studio built with **Apple Metal GPU acceleration (`Kinetic Pro.app`)**, an **iOS 26 / macOS 26 Liquid Glass** Photoshop-adaptable workspace, an **AI Rigging Copilot (Cursor, Claude, ChatGPT, Grok)**, and a **3-Way Unity & Spine 4.2 Export Engine**.

📖 **[Read the Complete User Manual (`USER_MANUAL.md`)](./USER_MANUAL.md)**

![Kinetic Pro — 1-Click Auto Studio & Slot Stage Choreographer](./docs/screenshots/slot-suite-tumble.webp)

![Kinetic Pro — 4-Tier Big Win Escalation & Live Odometer](./docs/screenshots/slot-suite-bigwin.webp)

![Kinetic Pro — Interactive In-App User Manual & 3-Click Guided Tour](./docs/screenshots/user-manual-tour.webp)

---

## Core Capabilities

1. **1-Click Auto Studio (`A`) & Visual Physics Learner**
   - Inspects character/symbol silhouette geometry, aspect ratio, and part layout to automatically infer **Mass (`kg`)**, **Center of Mass (`COM`)**, **Gravity/Drag**, and per-part material types (`heavy_metal`, `cloth_silk`, `hair_plume`, `organic_limb`, `crystal_energy`, `gold_medallion`), configuring real-time spring stiffness, damping, wind sway, and `follow` inertia.
   - **Apple Vision Pose Detection (`VNDetectHumanBodyPoseRequest`)** on macOS for automatic anatomical bone placement.

2. **12 Principles of 2D Animation Engine & 14 Built-In Famous Game Actions**
   - Live dials for **Volume-Preserving Squash & Stretch** ($s_x \cdot s_y \approx 1.0$), **Anticipation**, **Follow-Through & Overlapping Action**, and **Exaggeration**.
   - **14 Built-in Animations**: `idle`, `anticipation`, `cheer` (15×), `strike` (30×), `power` (45×), `triumph` (60×), `bow`, `zeus-bolt` (Olympus Sky Cast), `berserk-spin` (Whirlwind Cleave), `hit-react`, `symbol-win`, `wild-expand`, `scatter-trigger`, and `chest-open`.

3. **Slot Game Animation Suite (`src/core/slot-animation-suite.ts`)**
   - **Tumble / Cascade & `500×` Multiplier Orb Beam**: 4-phase column-staggered gravity drop, payline pop, shatter, and multiplier projectile beam into the top plaque.
   - **4-Tier Big Win Escalation & Live Odometer**: Choreographs `NICE` → `MEGA` → `SUPERB` → `SENSATIONAL` banners with rolling payout counter and coin fountain.
   - **1×3 Expanding Wild Reel Unfurl**, **Interactive 8-Wedge Bonus Wheel of Fortune** (with clapper pin spring physics), **2-Scatter Reel Fire**, **Hold & Spin Coins**, **Batch 8-Symbol Auto-Rigger**, **Dual 16:9 / 9:16 Safe Zones**, and **WebAudio Procedural Sound FX Synthesizer**.

4. **Contour Delaunay Mesher, GPU Weight Painter & Liquify FFD (`W`)**
   - Alpha-silhouette marching contour tracer + Ramer-Douglas-Peucker simplifier + Steiner crease vertices + Delaunay triangulation.
   - **Apple Metal Compute Kernel (`compute_auto_weights`)** & WebGL2 4-bone Linear Blend Skinning, interactive Weight Brush (`B`), Liquify FFD vertex sculpt (`W`), Onion Skinning, Motion Arcs, Weapon Slash Trails, and 3D Normal-Map Point Relighting.

5. **Triple Unity & Spine 4.2 Export Pipeline + Zero-Dependency Unity C# Runtime (`com.spineforge.runtime`)**
   - **Zero-Dependency Unity Runtime**: Exports `<id>.sfrig.json` + `<id>.slotanim.json` + `<id>.png` with `SpineForgeAnimator.cs` (`MeshFilter`/`MeshRenderer`, 4-bone LBS, `PolygonCollider2D` hitboxes, multi-skins, and `OnAnimationEvent` triggers)—no Spine license required.
   - **Spine 4.2 Standard**: Exports `<id>.spine.json` + `<id>.atlas.txt` + `<id>.png`.
   - **Baked Flipbook Sprite Sheet & Transparent `.WebM` Video**: Bakes multi-clip sprite sheets (`<id>-sheet.png` + `<id>.sprites.json`) on the Apple Metal GPU in ~200ms.

---

## Quick Start

```bash
# 1. Launch the Native macOS Apple Metal App
open "/Users/amit.tayal/Kinetic/Kinetic Pro.app"

# 2. Start the WebGL2 Studio on http://localhost:3460
npm run dev

# 3. Run Unit Tests & Unity C# Runtime Verification
npm run verify:all

# 4. Export All Presets via CLI
npm run export:cli -- all
```
