"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { SpineForgeAnimator } from "@/core/animator";
import { getSlotStageContext } from "@/core/batch-symbols-and-slot-stage";
import { compute25DParallaxBoneOffsets } from "@/core/parallax-and-lipsync";
import { patchKeyAt, snapTime, type Channel } from "@/core/keyframes";
import { RIG_BONE_PALETTE, type TransformKey } from "@/core/schema";
import {
  BONUS_WHEEL_WEDGES,
  evaluateBigWinChoreography,
  evaluateBonusWheelChoreography,
  evaluateTumbleCascadeChoreography,
  type SlotSuiteStageMode,
} from "@/core/slot-animation-suite";
import { applyAffine, buildSkeleton, deformMeshVerticesCPU } from "@/core/solver";
import { evaluateElementalVfx, generateUnity2DColliders } from "@/core/vfx-colliders-profiler";
import { SpineForgeWebGLRenderer, type GhostFramePass } from "@/core/webgl-renderer";
import { buildPartMesh, computeVertexHeatmapColors } from "@/core/weights";
import { useStudioStore } from "@/store/useStudioStore";

export function StudioViewport() {
  const {
    project,
    mode,
    selectedBone,
    selectedPart,
    activeClip,
    currentTime,
    playbackSpeed,
    heatmapSingleBone,
    selectBone,
    previewBone,
    applyWeightBrush,
    applyLiquifyBrush,
    transformTool,
    editActiveClip,
    commitPreview,
    swapToPreviousTool,
    setCurrentTime,
    setParallaxConfig,
    showSlotStage,
    slotStageMode,
    slotOrientation,
    setSlotStageMode,
    setSlotOrientation,
    requestDocument,
  } = useStudioStore();

  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SpineForgeWebGLRenderer | null>(null);
  const animatorRef = useRef<SpineForgeAnimator | null>(null);
  const ghostAnimatorRef = useRef<SpineForgeAnimator | null>(null);
  const pointerRigPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastBrushRigPosRef = useRef<{ x: number; y: number } | null>(null);
  const draggingBoneRef = useRef<{
    boneName: string;
    startRigX: number;
    startRigY: number;
    origX: number;
    origY: number;
    origR: number;
    origSx: number;
    origSy: number;
    /** Track and frame at drag start; every move re-derives from these, so drags never accumulate drift. */
    origTrack: TransformKey[];
    time: number;
    lastTool: "rotate" | "translate" | "scale" | "pivot";
    moved: boolean;
  } | null>(null);
  const isPaintingRef = useRef(false);
  const [loadedProjectId, setLoadedProjectId] = useState<string>("");

  // Decode part images and initialize WebGL2 renderer
  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    if (!glCanvas) return;

    let cancelled = false;
    const images: Record<string, HTMLImageElement> = {};

    Promise.all(
      project.parts.map((part) => {
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            images[part.name] = img;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = part.src;
        });
      }),
    ).then(() => {
      if (cancelled) return;
      rendererRef.current?.destroy();
      const skeleton = buildSkeleton(project);
      const renderer = new SpineForgeWebGLRenderer(glCanvas, skeleton, images, {
        preserveDrawingBuffer: true,
      });
      rendererRef.current = renderer;
      animatorRef.current = new SpineForgeAnimator(project, activeClip);
      ghostAnimatorRef.current = new SpineForgeAnimator(project, activeClip);
      setLoadedProjectId(project.id + ":" + project.parts.length);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.parts.length]);

  // Sync mesh weight changes & heatmap colors to GPU buffers
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const selectedBoneIdx = heatmapSingleBone
      ? project.bones.findIndex((b) => b.name === selectedBone)
      : -1;

    for (const part of project.parts) {
      const mesh = part.mesh ?? buildPartMesh(project, part);
      const heat = computeVertexHeatmapColors(mesh, project.bones, selectedBoneIdx);
      renderer.updatePartWeightsAndHeatmap(part.name, mesh, heat);
    }
    animatorRef.current = new SpineForgeAnimator(project, activeClip);
    ghostAnimatorRef.current = new SpineForgeAnimator(project, activeClip);
  }, [project, selectedBone, heatmapSingleBone, activeClip, loadedProjectId]);

  // Main render & animation loop
  useEffect(() => {
    let rafId = 0;
    let lastNow = performance.now();
    // Render on demand: while playing, and for a short settle window after any state change or
    // pointer movement (physics and brush cursors need a few frames). Idle studios stay cool.
    let lastState: unknown = null;
    let lastActivity = performance.now();
    const SETTLE_MS = 1500;
    const onActivity = () => {
      lastActivity = performance.now();
    };
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("resize", onActivity);

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastNow) / 1000) * playbackSpeed;
      lastNow = now;

      const store = useStudioStore.getState();
      if (store !== lastState) {
        lastState = store;
        lastActivity = now;
      }
      if (!store.isPlaying && now - lastActivity > SETTLE_MS) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const renderer = rendererRef.current;
      const animator = animatorRef.current;
      const ghostAnim = ghostAnimatorRef.current;
      const overlay = overlayCanvasRef.current;

      if (renderer && animator && overlay) {
        const clip = store.project.animations[store.activeClip];
        const duration = clip?.duration ?? 2.4;
        let evalTime = store.currentTime;
        if (store.isPlaying && store.mode !== "rig" && store.mode !== "mesh") {
          evalTime = (((store.currentTime + dt * store.playDirection) % duration) + duration) % duration;
          setCurrentTime(evalTime);
        } else if (store.mode === "rig" || store.mode === "mesh") {
          evalTime = 0;
        }

        // Compute Onion-Skinning ghost passes if enabled
        const ghostFrames: GhostFramePass[] = [];
        if (store.showOnionSkin && ghostAnim && store.mode !== "rig" && store.mode !== "mesh") {
          ghostAnim.setClip(store.activeClip);
          const prevFrame = ghostAnim.evaluateAt(
            ((evalTime - 0.14) % duration + duration) % duration,
            0,
          );
          const prevSkin = new Float32Array(prevFrame.skin);
          const prevOrder = prevFrame.order.filter((n) => !store.hiddenParts.includes(n));

          const nextFrame = ghostAnim.evaluateAt((evalTime + 0.14) % duration, 0);
          const nextSkin = new Float32Array(nextFrame.skin);
          const nextOrder = nextFrame.order.filter((n) => !store.hiddenParts.includes(n));

          ghostFrames.push(
            { skin: prevSkin, order: prevOrder, tint: [0.15, 0.85, 1.0, 0.22] },
            { skin: nextSkin, order: nextOrder, tint: [1.0, 0.38, 0.78, 0.18] },
          );
        }

        animator.setClip(store.activeClip);
        const parallaxOffsets = compute25DParallaxBoneOffsets(store.project, store.parallax, evalTime);
        const frame = animator.evaluateAt(
          evalTime,
          store.mode === "rig" || store.mode === "mesh" ? 0 : dt,
          store.mode === "rig" || store.mode === "mesh" ? undefined : parallaxOffsets,
        );

        const visibleOrder = frame.order.filter((name) => !store.hiddenParts.includes(name));
        const activeSkinObj = store.project.skins?.find((s) => s.name === store.activeSkinName);
        const lightRad = (store.lightAngleDeg * Math.PI) / 180;
        const lightDir: [number, number, number] = [
          Math.cos(lightRad) * 0.75,
          Math.sin(lightRad) * 0.75,
          0.68,
        ];

        renderer.draw({
          skin: frame.skin,
          order: visibleOrder,
          deforms: frame.deforms,
          flash: frame.fx.flash,
          heatmapMix: store.showHeatmap ? 0.78 : 0,
          selectedPart: store.selectedPart,
          isolateSelectedPart: store.isolatePart,
          skinTintHex: activeSkinObj?.tint,
          rimHex: activeSkinObj?.rimColor,
          flashHex: activeSkinObj?.flashColor,
          lightDir,
          lightIntensity: store.enable3DRelight ? store.lightIntensity : 0,
          ghostFrames,
        });

        // Draw 2D gizmo overlay (wireframe, motion arcs, weapon slash trails, capsules, bones, brush cursor)
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(overlay.clientWidth * dpr));
        const h = Math.max(1, Math.round(overlay.clientHeight * dpr));
        if (overlay.width !== w || overlay.height !== h) {
          overlay.width = w;
          overlay.height = h;
        }

        const ctx = overlay.getContext("2d")!;
        ctx.clearRect(0, 0, w, h);
        const { scale, offsetX, offsetY } = renderer.getViewMetrics(w, h);
        const toScreen = (rx: number, ry: number): [number, number] => [
          rx * scale + offsetX,
          ry * scale + offsetY,
        ];

        // 0A. Weapon Slash Ribbon Trail (when showSlashTrail is active during action clips)
        if (store.showSlashTrail && ghostAnim && store.activeClip !== "idle" && (store.mode === "animate" || store.mode === "auto")) {
          const weaponIdx = store.project.bones.findIndex((b) => b.name === "weapon");
          if (weaponIdx >= 0) {
            const trailSteps = 10;
            const spanSec = 0.18;
            const outerPts: [number, number][] = [];
            const innerPts: [number, number][] = [];
            ghostAnim.setClip(store.activeClip);
            for (let s = 0; s <= trailSteps; s++) {
              const sampleT = Math.max(0, evalTime - ((trailSteps - s) / trailSteps) * spanSec);
              const tf = ghostAnim.evaluateAt(sampleT, 0);
              const wMat = tf.world[weaponIdx]!;
              const tipLen = 0.24 * store.project.height;
              const baseLen = 0.08 * store.project.height;
              const [ox, oy] = applyAffine(wMat, 0, tipLen);
              const [ix, iy] = applyAffine(wMat, 0, baseLen);
              outerPts.push(toScreen(ox, oy));
              innerPts.push(toScreen(ix, iy));
            }
            if (outerPts.length >= 2) {
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(outerPts[0]![0], outerPts[0]![1]);
              for (let i = 1; i < outerPts.length; i++) ctx.lineTo(outerPts[i]![0], outerPts[i]![1]);
              for (let i = innerPts.length - 1; i >= 0; i--) ctx.lineTo(innerPts[i]![0], innerPts[i]![1]);
              ctx.closePath();
              const grad = ctx.createLinearGradient(
                outerPts[0]![0],
                outerPts[0]![1],
                outerPts[outerPts.length - 1]![0],
                outerPts[outerPts.length - 1]![1],
              );
              grad.addColorStop(0, "rgba(56, 189, 248, 0.0)");
              grad.addColorStop(0.6, "rgba(56, 189, 248, 0.24)");
              grad.addColorStop(1, "rgba(250, 204, 21, 0.55)");
              ctx.fillStyle = grad;
              ctx.fill();
              ctx.restore();
            }
          }
        }

        // 0A-2. GPU Elemental VFX & Particle System (Lightning Bolts, Fire Aura, Shockwaves, Coin Fountain, Star Sparks)
        if (store.activeVfx !== "none") {
          const weaponIdx = store.project.bones.findIndex((b) => b.name === "weapon");
          const wMat = weaponIdx >= 0 ? frame.world[weaponIdx]! : frame.world[0]!;
          const rMat = frame.world[0]!;
          const vfxPrims = evaluateElementalVfx(
            store.project,
            store.activeVfx,
            evalTime,
            [wMat[4], wMat[5]],
            [rMat[4], rMat[5]],
          );
          ctx.save();
          for (const prim of vfxPrims) {
            ctx.globalAlpha = Math.max(0, Math.min(1, prim.alpha));
            if (prim.kind === "bolt" && prim.points.length >= 2) {
              ctx.strokeStyle = prim.color;
              ctx.lineWidth = prim.width;
              ctx.shadowColor = "#38bdf8";
              ctx.shadowBlur = 12;
              ctx.beginPath();
              const [sx0, sy0] = toScreen(prim.points[0]![0], prim.points[0]![1]);
              ctx.moveTo(sx0, sy0);
              for (let i = 1; i < prim.points.length; i++) {
                const [sxi, syi] = toScreen(prim.points[i]![0], prim.points[i]![1]);
                ctx.lineTo(sxi, syi);
              }
              ctx.stroke();
            } else if (prim.kind === "ring") {
              const [cx, cy] = toScreen(prim.x, prim.y);
              ctx.strokeStyle = prim.color;
              ctx.lineWidth = prim.width;
              ctx.beginPath();
              ctx.ellipse(cx, cy, prim.rx * scale, prim.ry * scale, 0, 0, Math.PI * 2);
              ctx.stroke();
            } else if (prim.kind === "particle") {
              const [px, py] = toScreen(prim.x, prim.y);
              const pr = prim.radius * scale;
              ctx.fillStyle = prim.color;
              ctx.beginPath();
              if (prim.shape === "coin") {
                ctx.ellipse(
                  px,
                  py,
                  Math.max(2, Math.abs(Math.cos(prim.rotation)) * pr),
                  pr,
                  0,
                  0,
                  Math.PI * 2,
                );
              } else {
                ctx.arc(px, py, pr, 0, Math.PI * 2);
              }
              ctx.fill();
            }
          }
          ctx.restore();
        }

        // 0A-3. Unity 2D Hitbox & PolygonCollider2D Overlay (when showHitboxes is enabled)
        if (store.showHitboxes) {
          const colliders = generateUnity2DColliders(store.project, 100);
          ctx.save();
          for (const col of colliders) {
            const bIdx = store.project.bones.findIndex((b) => b.name === col.boneName);
            const m = bIdx >= 0 ? frame.world[bIdx]! : frame.world[0]!;
            const stroke =
              col.role === "hitbox_weapon"
                ? "#f43f5e"
                : col.role === "hurtbox_head"
                  ? "#38bdf8"
                  : "#22c55e";
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 2]);
            ctx.beginPath();
            col.polygonPathsMeters.forEach(([lxMeters, lyMeters], idx) => {
              const localPxX = lxMeters * 100;
              const localPxY = -lyMeters * 100;
              const [wx, wy] = applyAffine(m, localPxX, localPxY);
              const [sx, sy] = toScreen(wx, wy);
              if (idx === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            });
            ctx.closePath();
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.restore();
        }

        // 0B. Selected Bone Motion Arc Trajectory (when showMotionArcs is active)
        if (store.showMotionArcs && ghostAnim && store.selectedBone) {
          const selIdx = store.project.bones.findIndex((b) => b.name === store.selectedBone);
          if (selIdx > 0) {
            const arcSteps = 28;
            ctx.save();
            ctx.strokeStyle = "rgba(250, 204, 21, 0.65)";
            ctx.lineWidth = 1.6;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ghostAnim.setClip(store.activeClip);
            for (let s = 0; s <= arcSteps; s++) {
              const st = (s / arcSteps) * duration;
              const af = ghostAnim.evaluateAt(st, 0);
              const m = af.world[selIdx]!;
              const [sx, sy] = toScreen(m[4], m[5]);
              if (s === 0) ctx.moveTo(sx, sy);
              else ctx.lineTo(sx, sy);
            }
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
        }

        // 1. Draw Delaunay Mesh Wireframe
        if (store.showMeshWireframe) {
          for (const partName of visibleOrder) {
            if (store.isolatePart && store.selectedPart && store.selectedPart !== partName) continue;
            const part = store.project.parts.find((p) => p.name === partName);
            if (!part?.mesh) continue;
            const isSelectedPart = store.selectedPart === partName;
            const deformed = deformMeshVerticesCPU(part.mesh, frame.skin, frame.deforms[partName]);
            const indices = part.mesh.indices;

            ctx.strokeStyle = isSelectedPart ? "rgba(103, 232, 249, 0.58)" : "rgba(148, 163, 184, 0.18)";
            ctx.lineWidth = isSelectedPart ? 1.25 : 0.75;
            ctx.beginPath();
            for (let t = 0; t < indices.length; t += 3) {
              const a = indices[t]!;
              const b = indices[t + 1]!;
              const c = indices[t + 2]!;
              const [ax, ay] = toScreen(deformed[a * 2]!, deformed[a * 2 + 1]!);
              const [bx, by] = toScreen(deformed[b * 2]!, deformed[b * 2 + 1]!);
              const [cx, cy] = toScreen(deformed[c * 2]!, deformed[c * 2 + 1]!);
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.lineTo(cx, cy);
              ctx.closePath();
            }
            ctx.stroke();

            if (isSelectedPart && (store.mode === "mesh" || store.mode === "weights" || store.mode === "liquify")) {
              const vCount = deformed.length / 2;
              for (let v = 0; v < vCount; v++) {
                const [vx, vy] = toScreen(deformed[v * 2]!, deformed[v * 2 + 1]!);
                const isHull = v < part.mesh.hullCount;
                ctx.fillStyle = isHull ? "#67e8f9" : "rgba(248, 250, 252, 0.85)";
                ctx.beginPath();
                ctx.arc(vx, vy, isHull ? 2.5 : 1.7, 0, Math.PI * 2);
                ctx.fill();
              }
            }
          }
        }

        // 2. Draw Capsule Weight Envelopes
        if (store.showCapsules) {
          store.project.bones.forEach((bone, bIdx) => {
            if (!bone.regions) return;
            const col = bone.color ?? RIG_BONE_PALETTE[bIdx % RIG_BONE_PALETTE.length]!;
            const isSel = bone.name === store.selectedBone;
            ctx.strokeStyle = col;
            ctx.lineWidth = isSel ? 2.2 : 1.2;
            ctx.setLineDash([6, 4]);
            for (const [ax, ay, bx, by, radius] of bone.regions) {
              const [sax, say] = toScreen(ax * store.project.width, ay * store.project.height);
              const [sbx, sby] = toScreen(bx * store.project.width, by * store.project.height);
              const rPx = radius * store.project.height * scale;
              ctx.beginPath();
              ctx.arc(sax, say, rPx, 0, Math.PI * 2);
              ctx.arc(sbx, sby, rPx, 0, Math.PI * 2);
              ctx.stroke();
            }
            ctx.setLineDash([]);
          });
        }

        // 3. Draw Bone Hierarchy & IK Gizmos
        if (store.showBones) {
          const skeleton = animator.skeleton;
          store.project.bones.forEach((bone, i) => {
            const worldMat = frame.world[i]!;
            const [bx, by] = toScreen(worldMat[4], worldMat[5]);
            const pIdx = skeleton.parents[i]!;
            const col = bone.color ?? RIG_BONE_PALETTE[i % RIG_BONE_PALETTE.length]!;
            const isSelected = bone.name === store.selectedBone;
            const isIkTarget = bone.name.startsWith("ik-");

            if (pIdx >= 0 && !isIkTarget) {
              const pMat = frame.world[pIdx]!;
              const [px, py] = toScreen(pMat[4], pMat[5]);
              ctx.strokeStyle = isSelected ? "#ffffff" : col;
              ctx.lineWidth = isSelected ? 3 : 2;
              ctx.beginPath();
              ctx.moveTo(px, py);
              ctx.lineTo(bx, by);
              ctx.stroke();
            }

            const lenPx = (bone.length ?? 0.06) * store.project.height;
            const [tipRigX, tipRigY] = applyAffine(worldMat, lenPx, 0);
            const [tx, ty] = toScreen(tipRigX, tipRigY);

            if (isIkTarget) {
              ctx.strokeStyle = isSelected ? "#fde047" : "#ffffff";
              ctx.lineWidth = 2;
              const s = isSelected ? 9 : 7;
              ctx.beginPath();
              ctx.moveTo(bx, by - s);
              ctx.lineTo(bx + s, by);
              ctx.lineTo(bx, by + s);
              ctx.lineTo(bx - s, by);
              ctx.closePath();
              ctx.stroke();
            } else {
              ctx.beginPath();
              ctx.arc(bx, by, isSelected ? 6.5 : 4.8, 0, Math.PI * 2);
              ctx.fillStyle = isSelected ? "#ffffff" : col;
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = "#040711";
              ctx.stroke();

              ctx.strokeStyle = col;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(bx, by);
              ctx.lineTo(tx, ty);
              ctx.stroke();
            }

            if (isSelected || bone.spring) {
              ctx.font = "600 11px -apple-system, SF Mono, ui-monospace, monospace";
              ctx.fillStyle = isSelected ? "#ffffff" : "rgba(226, 232, 240, 0.85)";
              const badge = bone.spring ? `${bone.name} · spring` : bone.name;
              ctx.fillText(badge, bx + 10, by - 5);
            }
          });
        }

        // 4. Draw Brush Cursor when in Weight Painter or Liquify FFD mode
        if ((store.mode === "weights" || store.mode === "liquify") && pointerRigPosRef.current) {
          const [cx, cy] = toScreen(pointerRigPosRef.current.x, pointerRigPosRef.current.y);
          const rScreen = store.brushRadius * scale;
          ctx.strokeStyle =
            store.mode === "liquify"
              ? "#c084fc"
              : store.brushMode === "subtract"
                ? "#fb7185"
                : store.brushMode === "smooth"
                  ? "#38bdf8"
                  : "#34d399";
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(cx, cy, rScreen, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("resize", onActivity);
    };
  }, [playbackSpeed, setCurrentTime]);

  // Test hook for scripts/smoke-ui.mjs, only when the page is opened with ?test.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("test")) return;
    const w = window as unknown as { __kineticTest?: Record<string, unknown> };
    w.__kineticTest = {
      ...w.__kineticTest,
      boneScreen: (name: string) => {
        const overlay = overlayCanvasRef.current;
        const renderer = rendererRef.current;
        const animator = animatorRef.current;
        const s = useStudioStore.getState();
        const idx = s.project.bones.findIndex((b) => b.name === name);
        if (!overlay || !renderer || !animator || idx < 0) return null;
        const m = animator.evaluateAt(s.mode === "rig" || s.mode === "mesh" ? 0 : s.currentTime, 0).world[idx]!;
        const rect = overlay.getBoundingClientRect();
        const dpr = overlay.width / Math.max(1, rect.width);
        const { scale, offsetX, offsetY } = renderer.getViewMetrics(overlay.width, overlay.height);
        return { x: rect.left + (m[4] * scale + offsetX) / dpr, y: rect.top + (m[5] * scale + offsetY) / dpr };
      },
      state: () => {
        const s = useStudioStore.getState();
        const clip = s.project.animations[s.activeClip];
        return {
          mode: s.mode,
          transformTool: s.transformTool,
          currentTime: s.currentTime,
          isPlaying: s.isPlaying,
          playDirection: s.playDirection,
          historyIndex: s.historyIndex,
          fps: clip?.fps ?? 30,
          loop: clip?.loop ?? false,
        };
      },
      boneKeys: (bone: string) => {
        const s = useStudioStore.getState();
        return s.project.animations[s.activeClip]?.boneTracks[bone] ?? [];
      },
      project: () => {
        const p = useStudioStore.getState().project;
        return { id: p.id, title: p.title, bones: p.bones.length, parts: p.parts.length, clips: Object.keys(p.animations).length };
      },
    };
  }, []);

  const eventToRigCoords = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const overlay = overlayCanvasRef.current;
    const renderer = rendererRef.current;
    if (!overlay || !renderer) return null;
    const rect = overlay.getBoundingClientRect();
    const dpr = overlay.width / Math.max(1, rect.width);
    const canvasX = (e.clientX - rect.left) * dpr;
    const canvasY = (e.clientY - rect.top) * dpr;
    const { scale, offsetX, offsetY } = renderer.getViewMetrics(overlay.width, overlay.height);
    return {
      x: (canvasX - offsetX) / scale,
      y: (canvasY - offsetY) / scale,
    };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // right-click swaps tools (onContextMenu); never start a drag with it
    const pt = eventToRigCoords(e);
    if (!pt) return;
    pointerRigPosRef.current = pt;
    lastBrushRigPosRef.current = pt;

    if (mode === "weights" && selectedPart) {
      isPaintingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      applyWeightBrush(selectedPart, pt.x, pt.y);
      return;
    }

    if (mode === "liquify" && selectedPart) {
      isPaintingRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      applyLiquifyBrush(selectedPart, pt.x, pt.y, 0, 0);
      return;
    }

    const animator = animatorRef.current;
    if (!animator) return;
    const evalTime = mode === "rig" || mode === "mesh" ? 0 : currentTime;
    const frame = animator.evaluateAt(evalTime, 0);

    let closestBone: string | null = null;
    let minDist = 28;
    project.bones.forEach((bone, i) => {
      const m = frame.world[i]!;
      const d = Math.hypot(pt.x - m[4], pt.y - m[5]);
      if (d < minDist) {
        minDist = d;
        closestBone = bone.name;
      }
    });

    if (closestBone) {
      selectBone(closestBone);
      const boneObj = project.bones.find((b) => b.name === closestBone)!;
      const bIdx = project.bones.indexOf(boneObj);
      const pose = frame.poses[bIdx]!;
      const clip = project.animations[activeClip];
      // Keys land on whole frames, as in Spine; the playhead jumps to that frame.
      const keyTime = clip ? snapTime(currentTime, clip.fps || 30, clip.duration) : 0;
      if (mode === "animate" && clip && Math.abs(keyTime - currentTime) > 1e-4) setCurrentTime(keyTime);
      draggingBoneRef.current = {
        boneName: closestBone,
        startRigX: pt.x,
        startRigY: pt.y,
        origX: mode === "rig" ? boneObj.x : pose.x,
        origY: mode === "rig" ? boneObj.y : pose.y,
        origR: pose.r,
        origSx: pose.sx,
        origSy: pose.sy,
        origTrack: clip?.boneTracks[closestBone] ?? [],
        time: keyTime,
        lastTool: mode === "rig" ? "pivot" : "rotate",
        moved: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pt = eventToRigCoords(e);
    if (!pt) return;
    const prevPt = lastBrushRigPosRef.current ?? pt;
    pointerRigPosRef.current = pt;
    lastBrushRigPosRef.current = pt;

    // Update 2.5D Parallax Look-At target from cursor position on canvas
    const normX = Math.max(-1, Math.min(1, (pt.x / Math.max(1, project.width) - 0.5) * 2));
    const normY = Math.max(-1, Math.min(1, (pt.y / Math.max(1, project.height) - 0.4) * 2));
    if (useStudioStore.getState().parallax.enabled && !draggingBoneRef.current && !isPaintingRef.current) {
      setParallaxConfig({ lookX: Number(normX.toFixed(2)), lookY: Number(normY.toFixed(2)) });
    }

    if (isPaintingRef.current && mode === "weights" && selectedPart) {
      applyWeightBrush(selectedPart, pt.x, pt.y);
      return;
    }

    if (isPaintingRef.current && mode === "liquify" && selectedPart) {
      applyLiquifyBrush(selectedPart, pt.x, pt.y, pt.x - prevPt.x, pt.y - prevPt.y);
      return;
    }

    const drag = draggingBoneRef.current;
    if (!drag) return;
    const dx = pt.x - drag.startRigX;
    const dy = pt.y - drag.startRigY;

    if (!drag.moved && Math.hypot(dx, dy) < 2) return;

    if (mode === "rig") {
      drag.moved = true;
      previewBone(drag.boneName, {
        x: Number(Math.max(0, Math.min(1, drag.origX + dx / project.width)).toFixed(4)),
        y: Number(Math.max(0, Math.min(1, drag.origY + dy / project.height)).toFixed(4)),
      });
    } else if (mode === "animate") {
      // B (pose): IK targets and root move, other bones rotate, ⇧ moves. C / V / X force one transform,
      // and ⇧ refines it as in Spine: 15° rotation steps, axis lock, uniform scale.
      const isPose = transformTool === "pose";
      const tool: "rotate" | "translate" | "scale" = isPose
        ? drag.boneName.startsWith("ik-") || drag.boneName === "root" || e.shiftKey
          ? "translate"
          : "rotate"
        : transformTool;
      const refine = !isPose && e.shiftKey;
      const patch: Partial<Record<Channel, number>> = {};
      if (tool === "rotate") {
        const delta = dx * 0.45;
        patch.r = drag.origR + (refine ? Math.round(delta / 15) * 15 : delta);
      } else if (tool === "translate") {
        const lockY = refine && Math.abs(dx) >= Math.abs(dy);
        const lockX = refine && !lockY;
        patch.x = drag.origX + (lockX ? 0 : dx);
        patch.y = drag.origY + (lockY ? 0 : dy);
      } else {
        const fx = Math.max(0.01, 1 + dx * 0.005);
        const fy = refine ? fx : Math.max(0.01, 1 - dy * 0.005);
        patch.sx = drag.origSx * fx;
        patch.sy = drag.origSy * fy;
      }
      drag.moved = true;
      drag.lastTool = tool;
      editActiveClip(
        (c) => ({ ...c, boneTracks: { ...c.boneTracks, [drag.boneName]: patchKeyAt(drag.origTrack, drag.time, patch) } }),
        null,
      );
    }
  };

  const handlePointerUp = () => {
    const drag = draggingBoneRef.current;
    const painted = isPaintingRef.current;
    isPaintingRef.current = false;
    draggingBoneRef.current = null;
    // One undo step per drag or brush stroke.
    if (drag?.moved) {
      const verb = { rotate: "Rotated", translate: "Moved", scale: "Scaled", pivot: "Moved pivot of" }[drag.lastTool];
      commitPreview(`${verb} ${drag.boneName}`);
    }
    if (painted && selectedPart) commitPreview(mode === "weights" ? `Painted weights on ${selectedPart}` : `Warped ${selectedPart}`);
  };

  return (
    <div className="fixed inset-0 bg-[#040711] overflow-hidden select-none">
      {/* iOS 26 Solarium Ambient Spatial Light Stage */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 50% 42%, rgba(56, 189, 248, 0.14) 0%, rgba(99, 102, 241, 0.07) 35%, rgba(4, 7, 17, 0.95) 75%), radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 28px 28px",
        }}
      />

      <canvas ref={glCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      <canvas
        ref={overlayCanvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={(e) => {
          e.preventDefault();
          swapToPreviousTool();
        }}
        onPointerLeave={() => {
          handlePointerUp();
          setParallaxConfig({ lookX: 0, lookY: 0 });
        }}
        className={`absolute inset-0 w-full h-full ${
          mode === "weights" || mode === "liquify" ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
        }`}
      />

      {/* In-Viewport Slot Game Animation Suite Stage Director */}
      {showSlotStage && (
        <div
          className={`absolute left-1/2 top-18 -translate-x-1/2 z-10 pointer-events-auto rounded-[28px] liquid-glass p-4 border border-amber-400/40 shadow-[0_0_60px_rgba(251,191,36,0.22)] flex flex-col items-center gap-3 ${
            slotOrientation === "portrait_9_16" ? "w-[360px]" : "w-[540px]"
          }`}
        >
          {(() => {
            const stageCtx = getSlotStageContext(project.id);
            const activeStage: SlotSuiteStageMode =
              slotStageMode === "off" ? "reel_tumble_cascade" : slotStageMode;
            const clipDur = Math.max(0.5, project.animations[activeClip]?.duration ?? 2.0);
            const normProgress = (currentTime % clipDur) / clipDur;
            const bigWinFrame = evaluateBigWinChoreography(normProgress, 100, 75);
            const tumbleFrame = evaluateTumbleCascadeChoreography(project.id, currentTime, 2.0);
            const wheelFrame = evaluateBonusWheelChoreography(normProgress);
            const baseDir = project.id.includes("solara")
              ? "/presets/sands-of-solara"
              : "/presets/astral-forge";

            return (
              <>
                {/* Top Stage Director Bar: 7 Slot Animation Modes + 16:9 / 9:16 Orientation Switcher */}
                <div className="flex flex-wrap items-center justify-between w-full gap-1.5 text-[10px]">
                  <div className="flex flex-wrap items-center gap-1 p-0.5 rounded-full liquid-glass-well">
                    {(
                      [
                        { id: "reel_tumble_cascade", label: "Tumble & 500×" },
                        { id: "big_win_ladder", label: "Big Win" },
                        { id: "expanding_wild_reel", label: "1×3 Wild" },
                        { id: "bonus_wheel", label: "Bonus Wheel" },
                        { id: "scatter_anticipation", label: "2-Scatter" },
                        { id: "feature_splash", label: "Splash" },
                        { id: "hold_and_spin_coins", label: "Coins" },
                      ] as { id: SlotSuiteStageMode; label: string }[]
                    ).map((m) => (
                      <button
                        key={m.id}
                        onClick={() => setSlotStageMode(m.id)}
                        className={`px-2 py-0.5 rounded-full font-bold transition ${
                          activeStage === m.id
                            ? "bg-amber-400 text-slate-950"
                            : "text-slate-300 hover:text-white"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() =>
                      setSlotOrientation(
                        slotOrientation === "landscape_16_9" ? "portrait_9_16" : "landscape_16_9",
                      )
                    }
                    className="px-2.5 py-0.5 rounded-full liquid-glass-button font-mono text-sky-200"
                  >
                    {slotOrientation === "landscape_16_9" ? "16:9 Desktop" : "9:16 Portrait"}
                  </button>
                </div>

                {/* Top Ornate 9-Slice Win / Multiplier Plaque */}
                <div
                  style={{ transform: `scale(${activeStage === "big_win_ladder" ? bigWinFrame.plaqueScale : tumbleFrame.plaqueBounceScale})` }}
                  className="px-5 py-1.5 rounded-full bg-gradient-to-r from-amber-500/30 via-yellow-400/40 to-amber-500/30 border border-amber-300/60 text-xs font-extrabold tracking-wider text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.35)] transition-transform"
                >
                  {activeStage === "big_win_ladder"
                    ? `${bigWinFrame.activeTier.label} · $${bigWinFrame.currentPayout.toLocaleString("en-US", { minimumFractionDigits: 2 })} (${bigWinFrame.currentMultiplier}×)`
                    : activeStage === "scatter_anticipation"
                      ? "⚡ 2 SCATTERS LANDED — REEL 3, 4, 5 ANTICIPATION! ⚡"
                      : activeStage === "hold_and_spin_coins"
                        ? "🪙 HOLD & SPIN RESPIN — 3 RESPINS REMAINING 🪙"
                        : tumbleFrame.plaqueMultiplierText}
                </div>

                {/* MODE 1: 4-Tier Big Win Celebration & Extruded Title Escalation */}
                {activeStage === "big_win_ladder" ? (
                  <div className="relative py-4 flex flex-col items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={stageCtx.winBanners[bigWinFrame.activeTier.tier]}
                      alt={bigWinFrame.activeTier.label}
                      style={{
                        transform: `scale(${bigWinFrame.bannerScale[0]}, ${bigWinFrame.bannerScale[1]})`,
                      }}
                      className="max-h-36 object-contain drop-shadow-[0_0_28px_rgba(251,191,36,0.65)] transition-transform duration-75"
                    />
                    <div className="mt-2 font-mono text-2xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-yellow-200 to-amber-400 drop-shadow">
                      ${bigWinFrame.currentPayout.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                ) : activeStage === "bonus_wheel" ? (
                  /* MODE: Interactive Bonus Wheel of Fortune + Clapper Pin Spring Deflection */
                  <div className="relative py-3 flex flex-col items-center justify-center">
                    {/* Top Clapper Pin with Spring Deflection */}
                    <div
                      style={{
                        transform: `rotate(${wheelFrame.clapperAngleDeg}deg)`,
                        transformOrigin: "50% 0%",
                      }}
                      className="z-20 -mb-3 w-5 h-7 bg-gradient-to-b from-amber-300 to-red-500 rounded-b-full border-2 border-white shadow-lg"
                    />
                    {/* 8-Wedge Rotating Multiplier Wheel */}
                    <div
                      style={{
                        transform: `rotate(${wheelFrame.wheelAngleDeg}deg)`,
                        background:
                          "conic-gradient(#facc15 0deg 45deg, #1e293b 45deg 90deg, #a855f7 90deg 135deg, #0f172a 135deg 180deg, #38bdf8 180deg 225deg, #1e293b 225deg 270deg, #10b981 270deg 315deg, #0f172a 315deg 360deg)",
                      }}
                      className="w-44 h-44 rounded-full border-4 border-amber-300 shadow-[0_0_32px_rgba(250,204,21,0.5)] relative flex items-center justify-center"
                    >
                      {BONUS_WHEEL_WEDGES.map((w, idx) => (
                        <span
                          key={idx}
                          style={{
                            transform: `rotate(${idx * 45 + 22.5}deg) translateY(-62px)`,
                          }}
                          className="absolute text-[8px] font-black text-white drop-shadow"
                        >
                          {w.label}
                        </span>
                      ))}
                      <div className="w-12 h-12 rounded-full bg-slate-950 border-2 border-amber-300 flex items-center justify-center text-[9px] font-black text-amber-300">
                        SPIN
                      </div>
                    </div>
                  </div>
                ) : activeStage === "feature_splash" ? (
                  /* MODE 4: Feature Intro / Outro 3D Splash Banner Choreographer */
                  <div className="relative py-3 flex flex-col items-center justify-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${baseDir}/title-free.webp`}
                      alt="Free Spins Splash"
                      style={{
                        transform: `scale(${1 + Math.sin(currentTime * 4) * 0.06})`,
                      }}
                      className="max-h-28 object-contain drop-shadow-[0_0_24px_rgba(56,189,248,0.65)]"
                    />
                    <div
                      style={{
                        backgroundImage: `url(${baseDir}/plaque.webp)`,
                        backgroundSize: "100% 100%",
                      }}
                      className="px-8 py-3 text-center text-xs font-extrabold text-amber-100 uppercase tracking-wider"
                    >
                      10 FREE SPINS AWARDED · ALL MULTIPLIERS ACCUMULATE!
                    </div>
                  </div>
                ) : (
                  /* MODES 2, 3, 5: 5×3 Tumble / Cascade Grid, 2-Scatter Reel Fire, or Hold & Spin Coins */
                  <div className="relative grid grid-cols-5 gap-2 p-2.5 rounded-2xl bg-slate-950/80 border border-amber-400/35">
                    {[0, 1, 2, 3, 4].map((cIdx) => {
                      const isAnticipationReel = activeStage === "scatter_anticipation" && cIdx >= 2;
                      return (
                        <div
                          key={cIdx}
                          className={`flex flex-col gap-2 rounded-xl p-0.5 transition ${
                            isAnticipationReel
                              ? "ring-2 ring-cyan-400 shadow-[0_0_24px_#38bdf8] bg-cyan-500/15 animate-pulse"
                              : ""
                          }`}
                        >
                          {[0, 1, 2].map((rIdx) => {
                            const cellState =
                              tumbleFrame.cells.find((cell) => cell.col === cIdx && cell.row === rIdx) ??
                              tumbleFrame.cells[0]!;
                            const sym =
                              stageCtx.symbols.find((s) => s.role === cellState.role) ?? stageCtx.symbols[0]!;
                            const isCoinMode = activeStage === "hold_and_spin_coins";
                            const jackpotBadge =
                              cIdx === 2 && rIdx === 1
                                ? "GRAND 1000×"
                                : (cIdx + rIdx) % 2 === 0
                                  ? "MAJOR 100×"
                                  : "25×";

                            return (
                              <button
                                key={`${cIdx}-${rIdx}`}
                                onClick={() => requestDocument({ kind: "symbol", id: sym.role, title: sym.label })}
                                title={`Click to rig & animate ${sym.label}`}
                                style={{
                                  transform: `translateY(${cellState.offsetY * 22}px) scale(${cellState.scaleX}, ${cellState.scaleY})`,
                                  opacity: cellState.opacity,
                                }}
                                className={`relative w-14 h-14 rounded-xl p-1 flex flex-col items-center justify-center transition ${
                                  cellState.isWinning
                                    ? "bg-amber-400/20 border-2 border-amber-400 shadow-[0_0_14px_rgba(250,204,21,0.5)]"
                                    : "bg-white/5 border border-white/10"
                                }`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={isCoinMode ? stageCtx.coinSrc : sym.src}
                                  alt={sym.label}
                                  className="w-10 h-10 object-contain"
                                />
                                {(cellState.multiplierBadge || isCoinMode) && (
                                  <span className="absolute -bottom-1 px-1.5 py-0.2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-mono text-[8px] font-black shadow">
                                    {isCoinMode ? jackpotBadge : cellState.multiplierBadge}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}

                    {/* Multiplier Projectile Beam flying from center orb to Top Total-Win Plaque */}
                    {activeStage === "reel_tumble_cascade" && tumbleFrame.multiplierBeam && (
                      <div
                        style={{
                          bottom: `${35 + tumbleFrame.multiplierBeam.progress * 65}%`,
                          left: "50%",
                          transform: "translate(-50%, 50%)",
                        }}
                        className="absolute z-20 px-2.5 py-1 rounded-full bg-cyan-300 text-slate-950 font-mono text-xs font-black shadow-[0_0_24px_#38bdf8] pointer-events-none"
                      >
                        ⚡ {tumbleFrame.multiplierBeam.label}
                      </div>
                    )}

                    {/* 1×3 Full-Reel Expanding Wild Unfurl on Center Reel 3 */}
                    {activeStage === "expanding_wild_reel" && (
                      <div
                        style={{
                          transform: `scaleY(${Math.min(1, 0.35 + normProgress * 0.95)})`,
                          transformOrigin: "50% 50%",
                        }}
                        className="absolute inset-y-2 left-[40.5%] w-[19%] z-20 rounded-xl bg-gradient-to-b from-amber-400/90 via-sky-500/85 to-purple-600/90 border-2 border-amber-200 shadow-[0_0_32px_rgba(250,204,21,0.75)] flex flex-col items-center justify-between p-1.5 pointer-events-none"
                      >
                        <span className="text-[9px] font-black uppercase text-slate-950 bg-amber-200 px-1.5 rounded-full">
                          WILD
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={project.src}
                          alt="Expanding Wild Hero"
                          className="h-28 object-contain drop-shadow"
                        />
                        <span className="text-[11px] font-mono font-black text-white bg-slate-950/80 px-2 py-0.5 rounded-full border border-amber-300">
                          {Math.min(100, Math.max(2, Math.round(normProgress * 100)))}×
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
