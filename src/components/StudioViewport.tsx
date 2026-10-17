"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { SpineForgeAnimator } from "@/core/animator";
import { RIG_BONE_PALETTE } from "@/core/schema";
import { applyAffine, buildSkeleton, deformMeshVerticesCPU } from "@/core/solver";
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
    updateBone,
    applyWeightBrush,
    applyLiquifyBrush,
    setBoneKeyframeAtCurrentTime,
    setCurrentTime,
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

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastNow) / 1000) * playbackSpeed;
      lastNow = now;

      const store = useStudioStore.getState();
      const renderer = rendererRef.current;
      const animator = animatorRef.current;
      const ghostAnim = ghostAnimatorRef.current;
      const overlay = overlayCanvasRef.current;

      if (renderer && animator && overlay) {
        const clip = store.project.animations[store.activeClip];
        const duration = clip?.duration ?? 2.4;
        let evalTime = store.currentTime;
        if (store.isPlaying && store.mode !== "rig" && store.mode !== "mesh") {
          evalTime = (store.currentTime + dt) % duration;
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
        const frame = animator.evaluateAt(
          evalTime,
          store.mode === "rig" || store.mode === "mesh" ? 0 : dt,
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
        if (store.showSlashTrail && ghostAnim && store.activeClip !== "idle" && store.mode === "animate") {
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
    return () => cancelAnimationFrame(rafId);
  }, [playbackSpeed, setCurrentTime]);

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
      draggingBoneRef.current = {
        boneName: closestBone,
        startRigX: pt.x,
        startRigY: pt.y,
        origX: mode === "rig" ? boneObj.x : pose.x,
        origY: mode === "rig" ? boneObj.y : pose.y,
        origR: pose.r,
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

    if (mode === "rig") {
      updateBone(drag.boneName, {
        x: Number(Math.max(0, Math.min(1, drag.origX + dx / project.width)).toFixed(4)),
        y: Number(Math.max(0, Math.min(1, drag.origY + dy / project.height)).toFixed(4)),
      });
    } else if (mode === "animate") {
      if (drag.boneName.startsWith("ik-") || drag.boneName === "root" || e.shiftKey) {
        setBoneKeyframeAtCurrentTime(drag.boneName, {
          x: Number((drag.origX + dx).toFixed(1)),
          y: Number((drag.origY + dy).toFixed(1)),
        });
      } else {
        setBoneKeyframeAtCurrentTime(drag.boneName, {
          r: Number((drag.origR + dx * 0.45).toFixed(2)),
        });
      }
    }
  };

  const handlePointerUp = () => {
    isPaintingRef.current = false;
    draggingBoneRef.current = null;
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
        onPointerLeave={handlePointerUp}
        className={`absolute inset-0 w-full h-full ${
          mode === "weights" || mode === "liquify" ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
        }`}
      />
    </div>
  );
}
