"use client";

import { useEffect, useState } from "react";
import {
  EASE_BACK_OUT,
  EASE_POWER2_IN,
  EASE_POWER2_IN_OUT,
  EASE_SINE_IN_OUT,
  sampleTransformTrack,
} from "@/core/animator";
import { BUILTIN_PRESETS } from "@/core/presets";
import { RIG_BONE_PALETTE, type CurveType } from "@/core/schema";
import type { AutoWeightMode, FfdLiquifyMode, WeightBrushMode } from "@/core/weights";
import { useStudioStore, type StudioMode } from "@/store/useStudioStore";
import { AiAgentPanel } from "./AiAgentPanel";
import { AutoModeDock } from "./AutoModeDock";
import { StudioViewport } from "./StudioViewport";
import { CanvasCoachPill, UserManualModal } from "./UserManualModal";

type ExportBundlePreview = {
  id: string;
  atlasDataUrl: string;
  spriteSheetDataUrl: string;
  spineJson: string;
  spineAtlasTxt: string;
  unitySfRigJson: string;
  spriteSheetJson: string;
  zipBase64: string;
};

const BEZIER_PRESETS: { id: string; label: string; curve: CurveType; svgPath: string }[] = [
  { id: "sine", label: "Smooth Sine", curve: EASE_SINE_IN_OUT, svgPath: "M 4 28 C 18 28, 26 4, 40 4" },
  { id: "easeInOut", label: "Power Ease", curve: EASE_POWER2_IN_OUT, svgPath: "M 4 28 C 22 28, 22 4, 40 4" },
  { id: "backOut", label: "Overshoot", curve: EASE_BACK_OUT, svgPath: "M 4 28 C 12 2, 26 0, 40 6" },
  { id: "powerIn", label: "Slam In", curve: EASE_POWER2_IN, svgPath: "M 4 28 C 26 28, 34 18, 40 4" },
  { id: "linear", label: "Linear", curve: "linear", svgPath: "M 4 28 L 40 4" },
  { id: "stepped", label: "Stepped", curve: "stepped", svgPath: "M 4 28 L 24 28 L 24 4 L 40 4" },
];

export function StudioApp() {
  const {
    project,
    mode,
    selectedBone,
    selectedPart,
    activeClip,
    activeSkinName,
    currentTime,
    isPlaying,
    playbackSpeed,
    showBones,
    showMeshWireframe,
    showHeatmap,
    showOnionSkin,
    showMotionArcs,
    showSlashTrail,
    enable3DRelight,
    lightAngleDeg,
    lightIntensity,
    showHitboxes,
    showSlotStage,
    isolatePart,
    brushMode,
    liquifyMode,
    brushRadius,
    brushStrength,
    heatmapSingleBone,
    lockedBones,
    hiddenParts,
    history,
    historyIndex,
    loadPreset,
    setMode,
    selectBone,
    selectPart,
    setActiveClip,
    setActiveSkin,
    setCurrentTime,
    setIsPlaying,
    setPlaybackSpeed,
    setLightParams,
    undo,
    redo,
    jumpToHistory,
    runOneClickAutoRig,
    updateBone,
    addBone,
    updateIkMix,
    regeneratePartMesh,
    resetPartLiquifyDeform,
    setBrushMode,
    setLiquifyMode,
    setBrushRadius,
    setBrushStrength,
    toggleOverlay,
    toggleBoneLock,
    togglePartVisibility,
    movePartLayerOrder,
    setBoneKeyframeAtCurrentTime,
    setBoneCurveAtCurrentTime,
    deleteBoneKeyframe,
    addAnimationEventAtCurrentTime,
    deleteAnimationEvent,
    regenerateAllProceduralClips,
    bakeCurrentClipSprings,
  } = useStudioStore();

  // Photoshop-style right dock tab: Layers | Bones | History
  const [layersTab, setLayersTab] = useState<"layers" | "bones" | "history">("layers");
  const [showAiCopilot, setShowAiCopilot] = useState(true);
  const [dopeSheetExpanded, setDopeSheetExpanded] = useState(false);
  const [activeCurveId, setActiveCurveId] = useState("sine");
  const [eventType, setEventType] = useState("OnHit");

  const [newBoneName, setNewBoneName] = useState("");
  const [weightAlgo, setWeightAlgo] = useState<AutoWeightMode>("hybrid");
  const [exportData, setExportData] = useState<ExportBundlePreview | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportTab, setExportTab] = useState<"unity" | "spine" | "sheet">("unity");
  const [showPartCutterModal, setShowPartCutterModal] = useState(false);
  const [showUserManual, setShowUserManual] = useState(false);
  const [cutterStatus, setCutterStatus] = useState<string>("");
  const [saveBadge, setSaveBadge] = useState<string>("Saved");

  const currentBoneObj = project.bones.find((b) => b.name === selectedBone) ?? project.bones[0]!;
  const currentPartObj = project.parts.find((p) => p.name === selectedPart) ?? project.parts[0]!;
  const currentClipObj = project.animations[activeClip];
  const currentBonePoseAtTime = sampleTransformTrack(
    currentClipObj?.boneTracks[currentBoneObj?.name ?? "root"],
    currentTime,
  );

  const handleSaveProject = async () => {
    setSaveBadge("Saving...");
    try {
      localStorage.setItem(`kinetic-pro:${project.id}`, JSON.stringify(project));
      const res = await fetch("/api/save-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project }),
      });
      if (res.ok) {
        setSaveBadge(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
      } else {
        setSaveBadge("Saved locally");
      }
    } catch {
      setSaveBadge("Saved locally");
    }
  };

  // Photoshop single-key hotkeys: V (Pose), P (Rig Pin), M (Mesh), B (Weight Brush), W (Liquify FFD), Cmd+Z / Shift+Cmd+Z (Undo/Redo), Cmd+S (Save)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveProject();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const key = e.key.toLowerCase();
      if (key === "a") setMode("auto");
      else if (key === "v") setMode("animate");
      else if (key === "p") setMode("rig");
      else if (key === "m") setMode("mesh");
      else if (key === "b") setMode("weights");
      else if (key === "w") setMode("liquify");
      else if (e.key === "[") setBrushRadius(Math.max(15, brushRadius - 10));
      else if (e.key === "]") setBrushRadius(Math.min(180, brushRadius + 10));
      else if (e.key === "?" || e.key === "/") setShowUserManual((v) => !v);
      else if (e.key === "Escape") setShowUserManual(false);
      else if (e.key === " ") {
        e.preventDefault();
        setIsPlaying(!isPlaying);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushRadius, isPlaying, project, redo, setBrushRadius, setIsPlaying, setMode, undo]);

  const handleRunExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, format: "preview", sheetCellHeight: 192, sheetFps: 10 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Export failed");
      setExportData(data);
      setMode("export");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadZip = () => {
    if (!exportData?.zipBase64) return;
    const bytes = Uint8Array.from(atob(exportData.zipBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.id}-unity-bundle.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportTransparentWebM = () => {
    const glCanvas = document.querySelector("canvas") as HTMLCanvasElement | null;
    if (!glCanvas || typeof glCanvas.captureStream !== "function") return;
    const stream = glCanvas.captureStream(30);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.id}-${activeClip}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };
    recorder.start();
    const durMs = Math.round((project.animations[activeClip]?.duration ?? 2.0) * 1000);
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, durMs);
  };

  const handleSmartCutUpload = async (file: File) => {
    setCutterStatus("Running Vision Part Cutter + Telea Body Inpainting...");
    try {
      const defaultCutConfig = {
        capsules: {
          head: [[0.5, 0.08, 0.5, 0.16, 0.09]],
          "arm-back": [[0.3, 0.25, 0.28, 0.48, 0.07]],
          "arm-front": [[0.72, 0.22, 0.85, 0.44, 0.08]],
          weapon: [[0.82, 0.45, 0.85, 0.92, 0.12]],
        },
        priority: ["weapon", "arm-front", "arm-back", "head"],
        occluders: ["weapon", "arm-front", "arm-back"],
        order: ["body", "head", "arm-back", "weapon", "arm-front"],
      };
      const form = new FormData();
      form.append("file", file);
      form.append("projectId", file.name.replace(/\.[^.]+$/, ""));
      form.append("config", JSON.stringify(defaultCutConfig));

      const res = await fetch("/api/cut-parts", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cut failed");
      setCutterStatus(`Cut ${data.parts?.length ?? 0} parts (${data.width}×${data.height}) with inpainted torso!`);
    } catch (err) {
      setCutterStatus(err instanceof Error ? err.message : "Failed");
    }
  };

  const reversedLayers = [...project.parts].reverse();
  const activeBezierPreset = BEZIER_PRESETS.find((b) => b.id === activeCurveId) ?? BEZIER_PRESETS[0]!;

  return (
    <div className="relative h-screen w-screen overflow-hidden select-none">
      {/* 1. Full-Bleed 100% Spatial Canvas Stage */}
      <StudioViewport />

      {/* 2. Photoshop-Adaptable Spatial Flex Workspace + Extreme-Right AI Agent Copilot */}
      <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-3.5 gap-3">
        {/* TOP BAR: Photoshop Menu + Contextual Tool Options Bar + Right Actions */}
        <header className="pointer-events-auto flex items-center justify-between gap-2.5 px-4 py-2 rounded-full liquid-glass-pill shrink-0">
          {/* Left: Brand + Document + 1-Click Auto-Rig + Multi-Skin Wardrobe */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-tr from-cyan-400 to-sky-200 shadow-[0_0_12px_#38bdf8] shrink-0" />
            <span className="font-bold tracking-tight text-sm text-white whitespace-nowrap">Kinetic Pro</span>

            <select
              value={project.id}
              onChange={(e) => loadPreset(e.target.value)}
              className="liquid-glass-well rounded-full px-3 py-1 text-xs font-medium text-sky-200 focus:outline-none cursor-pointer whitespace-nowrap shrink-0"
            >
              {Object.keys(BUILTIN_PRESETS).map((id) => (
                <option key={id} value={id} className="bg-slate-950 text-white">
                  {id === "astral-forge" ? "Astral Forge.psd" : "Sands of Solara.psd"}
                </option>
              ))}
            </select>

            {/* Multi-Skin / Tier Wardrobe Selector */}
            {project.skins && project.skins.length > 0 && (
              <select
                value={activeSkinName}
                onChange={(e) => setActiveSkin(e.target.value)}
                title="Switch Character Skin / Evolving Symbol Tier"
                className="liquid-glass-well rounded-full px-2.5 py-1 text-[11px] font-semibold text-amber-200 focus:outline-none cursor-pointer whitespace-nowrap shrink-0"
              >
                {project.skins.map((s) => (
                  <option key={s.name} value={s.name} className="bg-slate-950 text-white">
                    {s.label}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={() => {
                runOneClickAutoRig();
                setMode("auto");
              }}
              title="1-Click Auto Studio (A): Learn visual physics, mesh, rig, and synthesize all 14 famous game animations"
              className={`whitespace-nowrap shrink-0 px-3 py-1 rounded-full text-[11px] font-bold transition ${
                mode === "auto"
                  ? "liquid-glass-active"
                  : "liquid-glass-button text-cyan-200 border-cyan-400/35"
              }`}
            >
              1-Click Auto-Rig
            </button>

            <button
              onClick={() => setShowPartCutterModal(true)}
              className="liquid-glass-button whitespace-nowrap shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium text-slate-200"
            >
              Import PSD
            </button>
          </div>

          {/* Center: Photoshop Contextual Tool Options Bar (Adapts to active tool V / P / M / B / W) */}
          <div className="flex items-center gap-2 px-3.5 py-1 rounded-full liquid-glass-well text-xs overflow-x-auto">
            {mode === "liquify" ? (
              <>
                <span className="text-[11px] font-bold text-purple-300 whitespace-nowrap">
                  Liquify FFD (W):
                </span>
                {(["push", "inflate", "pinch", "restore"] as FfdLiquifyMode[]).map((lm) => (
                  <button
                    key={lm}
                    onClick={() => setLiquifyMode(lm)}
                    className={`whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize transition ${
                      liquifyMode === lm ? "liquid-glass-active" : "text-slate-300 hover:text-white"
                    }`}
                  >
                    {lm}
                  </button>
                ))}
                <div className="h-3.5 w-px bg-white/15 mx-1" />
                <span className="text-[11px] text-slate-300 whitespace-nowrap">Size: {brushRadius}px</span>
                <input
                  type="range"
                  min="15"
                  max="180"
                  value={brushRadius}
                  onChange={(e) => setBrushRadius(parseFloat(e.target.value))}
                  className="w-20 accent-purple-400"
                />
                <button
                  onClick={() => resetPartLiquifyDeform(currentPartObj.name)}
                  className="whitespace-nowrap px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-200 text-[10px] font-semibold"
                >
                  Reset FFD
                </button>
              </>
            ) : mode === "weights" ? (
              <>
                <span className="text-[11px] font-bold text-emerald-300 whitespace-nowrap">
                  Weight Brush (B):
                </span>
                {(["add", "subtract", "smooth", "replace"] as WeightBrushMode[]).map((bm) => (
                  <button
                    key={bm}
                    onClick={() => setBrushMode(bm)}
                    className={`whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize transition ${
                      brushMode === bm ? "liquid-glass-active" : "text-slate-300 hover:text-white"
                    }`}
                  >
                    {bm}
                  </button>
                ))}
                <div className="h-3.5 w-px bg-white/15 mx-1" />
                <span className="text-[11px] text-slate-300 whitespace-nowrap">Size: {brushRadius}px</span>
                <input
                  type="range"
                  min="15"
                  max="180"
                  value={brushRadius}
                  onChange={(e) => setBrushRadius(parseFloat(e.target.value))}
                  className="w-18 accent-emerald-400"
                />
                <span className="text-[11px] text-slate-300 whitespace-nowrap">
                  Flow: {Math.round(brushStrength * 100)}%
                </span>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={brushStrength}
                  onChange={(e) => setBrushStrength(parseFloat(e.target.value))}
                  className="w-16 accent-emerald-400"
                />
              </>
            ) : mode === "mesh" ? (
              <>
                <span className="text-[11px] font-bold text-sky-300 whitespace-nowrap">
                  Puppet Mesh (M):
                </span>
                {(["low", "medium", "high"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => regeneratePartMesh(currentPartObj.name, d, weightAlgo)}
                    className={`whitespace-nowrap px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize transition ${
                      (currentPartObj.meshDensity ?? "medium") === d
                        ? "liquid-glass-active"
                        : "text-slate-300 hover:text-white"
                    }`}
                  >
                    {d}
                  </button>
                ))}
                <div className="h-3.5 w-px bg-white/15 mx-1" />
                <select
                  value={weightAlgo}
                  onChange={(e) => {
                    const nextAlgo = e.target.value as AutoWeightMode;
                    setWeightAlgo(nextAlgo);
                    regeneratePartMesh(currentPartObj.name, currentPartObj.meshDensity ?? "medium", nextAlgo);
                  }}
                  className="bg-transparent text-[11px] text-sky-200 font-semibold focus:outline-none"
                >
                  <option value="hybrid" className="bg-slate-950">Kernel: Hybrid Capsule</option>
                  <option value="heat" className="bg-slate-950">Kernel: Geodesic Heat</option>
                  <option value="capsule" className="bg-slate-950">Kernel: Strict Envelopes</option>
                </select>
              </>
            ) : (
              <>
                <span className="text-[11px] font-bold text-sky-300 whitespace-nowrap">
                  {mode === "rig" ? "Bone Pin (P):" : "Transform Pose (V):"}
                </span>
                <span className="text-[11px] font-mono text-slate-200 whitespace-nowrap">
                  {currentBoneObj.name} ({currentBoneObj.x}, {currentBoneObj.y})
                </span>
                {project.ikConstraints[0] && (
                  <>
                    <div className="h-3.5 w-px bg-white/15 mx-1" />
                    <span className="text-[11px] text-slate-300 whitespace-nowrap">
                      IK Mix: {Math.round(project.ikConstraints[0].mix * 100)}%
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={project.ikConstraints[0].mix}
                      onChange={(e) => updateIkMix(project.ikConstraints[0]!.name, parseFloat(e.target.value))}
                      className="w-18 accent-sky-400"
                    />
                  </>
                )}
              </>
            )}
          </div>

          {/* Right: Undo/Redo + Save (⌘S) + Export Unity + AI Copilot Toggle */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={undo}
              disabled={historyIndex <= 0}
              title="Undo (⌘Z)"
              className="px-2.5 py-1.5 rounded-full liquid-glass-button text-xs font-bold text-slate-200 disabled:opacity-35"
            >
              ↶
            </button>
            <button
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              title="Redo (⇧⌘Z)"
              className="px-2.5 py-1.5 rounded-full liquid-glass-button text-xs font-bold text-slate-200 disabled:opacity-35"
            >
              ↷
            </button>
            <button
              onClick={() => void handleSaveProject()}
              title="Save Project to Disk & LocalStorage (⌘S)"
              className="whitespace-nowrap shrink-0 px-3 py-1.5 rounded-full liquid-glass-button text-xs font-semibold text-sky-200 hover:text-white"
            >
              {saveBadge}
            </button>
            <button
              onClick={handleRunExport}
              disabled={isExporting}
              className="whitespace-nowrap shrink-0 px-4 py-1.5 rounded-full text-xs font-bold tracking-tight bg-gradient-to-b from-emerald-300 to-emerald-500 text-slate-950 shadow-[0_0_18px_rgba(52,211,153,0.45)] hover:brightness-110 transition disabled:opacity-50"
            >
              {isExporting ? "Baking..." : "Export Unity"}
            </button>
            <button
              onClick={() => setShowAiCopilot(!showAiCopilot)}
              className={`whitespace-nowrap shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition ${
                showAiCopilot ? "liquid-glass-active" : "liquid-glass-button text-slate-200"
              }`}
            >
              AI Copilot
            </button>
            <button
              onClick={() => setShowUserManual(true)}
              title="Open Interactive User Manual & Guided Tour (?)"
              className="whitespace-nowrap shrink-0 px-3 py-1.5 rounded-full liquid-glass-button text-xs font-bold text-amber-200 hover:text-white"
            >
              ? Guide
            </button>
          </div>
        </header>

        {/* MIDDLE WORKSPACE ROW:
            [1. Left Photoshop Vertical Tool Rail]
            [2. Unobstructed Center Canvas]
            [3. Right-Center Photoshop Properties + Layers/Bones/History Stack]
            [4. Extreme-Right AI Agent Copilot Dock] */}
        <div className="flex-1 min-h-0 flex items-stretch justify-between gap-3">
          {/* 1. Far-Left Single-Column Photoshop Vertical Tool Rail */}
          <aside className="pointer-events-auto w-14 rounded-[26px] liquid-glass py-2.5 px-1.5 flex flex-col items-center justify-between shrink-0">
            <div className="space-y-1.5 flex flex-col items-center w-full">
              {(
                [
                  { id: "auto", key: "A", sub: "Auto", label: "1-Click Auto Studio: Visual Physics & 14 Game Actions (A)" },
                  { id: "animate", key: "V", sub: "Pose", label: "Move / Free Transform Pose (V)" },
                  { id: "rig", key: "P", sub: "Rig", label: "Bone & IK Pin Tool (P)" },
                  { id: "mesh", key: "M", sub: "Mesh", label: "Puppet Warp Delaunay Mesh (M)" },
                  { id: "weights", key: "B", sub: "Brush", label: "Weight Paint Brush (B)" },
                  { id: "liquify", key: "W", sub: "Warp", label: "Liquify FFD Vertex Sculpt (W)" },
                ] as { id: StudioMode; key: string; sub: string; label: string }[]
              ).map((tool) => {
                const active = mode === tool.id;
                return (
                  <button
                    key={tool.id}
                    onClick={() => setMode(tool.id)}
                    title={tool.label}
                    className={`w-10 h-9.5 rounded-2xl font-bold text-xs flex flex-col items-center justify-center transition ${
                      active ? "liquid-glass-active" : "liquid-glass-button text-slate-300 hover:text-white"
                    }`}
                  >
                    <span>{tool.key}</span>
                    <span className="text-[8px] font-normal opacity-75">{tool.sub}</span>
                  </button>
                );
              })}

              <button
                onClick={() => setShowPartCutterModal(true)}
                title="PSD Layer Extractor & Part Slice Knife (K)"
                className="w-10 h-9.5 rounded-2xl liquid-glass-button text-slate-300 hover:text-white font-bold text-xs flex flex-col items-center justify-center"
              >
                <span>K</span>
                <span className="text-[8px] font-normal opacity-75">Slice</span>
              </button>
            </div>

            <div className="w-7 h-px bg-white/15 my-0.5" />

            {/* Viewport Overlay Toggles (Bones, Grid, Heat, Onion Skin, Motion Arcs, Slash Trail, 3D Light, Solo) */}
            <div className="space-y-1 flex flex-col items-center w-full">
              {(
                [
                  { key: "showBones", short: "Bones", active: showBones },
                  { key: "showMeshWireframe", short: "Grid", active: showMeshWireframe },
                  { key: "showHeatmap", short: "Heat", active: showHeatmap },
                  { key: "showOnionSkin", short: "Onion", active: showOnionSkin },
                  { key: "showMotionArcs", short: "Arcs", active: showMotionArcs },
                  { key: "showSlashTrail", short: "Trail", active: showSlashTrail },
                  { key: "enable3DRelight", short: "3D Lit", active: enable3DRelight },
                  { key: "showHitboxes", short: "Box2D", active: showHitboxes },
                  { key: "showSlotStage", short: "Reels", active: showSlotStage },
                  { key: "isolatePart", short: "Solo", active: isolatePart },
                ] as const
              ).map((ov) => (
                <button
                  key={ov.key}
                  onClick={() => toggleOverlay(ov.key)}
                  title={`Toggle ${ov.short}`}
                  className={`w-10 py-1 rounded-xl text-[9px] font-semibold transition ${
                    ov.active
                      ? "bg-sky-400/25 text-sky-200 border border-sky-300/40"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {ov.short}
                </button>
              ))}
            </div>
          </aside>

          {/* 1B. Floating 1-Click Auto Studio Dock (Visual Physics Learner, 12 Principles & 14 Famous Game Actions) */}
          {mode === "auto" && <AutoModeDock onShipToUnity={handleRunExport} />}

          {/* Center Canvas Spacer */}
          <div className="flex-1 pointer-events-none" />

          {/* Right Group: [Photoshop Properties + Layers/Bones/History Dock] + [Extreme-Right AI Copilot Window] */}
          <div className="flex items-stretch gap-3 shrink-0">
            {/* 3. Right-Center Dock: Photoshop Properties (Top) + Layers/Bones/History Stack (Bottom) */}
            <aside className="pointer-events-auto w-76 rounded-[26px] liquid-glass flex flex-col overflow-hidden shrink-0">
              {/* Top Half: Photoshop Properties + Bezier Graph + 3D Normal Relight */}
              <div className="p-3.5 border-b border-white/12 space-y-2.5 overflow-y-auto max-h-[52%]">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-sky-300">
                    Properties — {mode === "mesh" || mode === "weights" || mode === "liquify" ? currentPartObj.name : currentBoneObj.name}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {project.width}×{project.height}
                  </span>
                </div>

                {/* Transform / Pose Coordinates */}
                <div className="p-2.5 rounded-2xl liquid-glass-well space-y-2 text-xs">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-300 font-semibold">Transform ({currentBoneObj.name})</span>
                    <button
                      onClick={() =>
                        setBoneKeyframeAtCurrentTime(currentBoneObj.name, {
                          r: currentBonePoseAtTime.r,
                          x: currentBonePoseAtTime.x,
                          y: currentBonePoseAtTime.y,
                          sx: currentBonePoseAtTime.sx,
                          sy: currentBonePoseAtTime.sy,
                          curve: activeBezierPreset.curve,
                        })
                      }
                      className="px-2 py-0.5 rounded-full bg-purple-500/25 border border-purple-400/40 text-purple-200 text-[10px] font-semibold"
                    >
                      + Key ({currentTime.toFixed(2)}s)
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">Angle °</span>
                      <input
                        type="number"
                        step="1"
                        value={Number(currentBonePoseAtTime.r.toFixed(1))}
                        onChange={(e) =>
                          setBoneKeyframeAtCurrentTime(currentBoneObj.name, {
                            ...currentBonePoseAtTime,
                            r: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full bg-white/8 border border-white/15 rounded-xl px-2 py-1 font-mono text-white text-xs"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">ΔX px</span>
                      <input
                        type="number"
                        step="1"
                        value={Number(currentBonePoseAtTime.x.toFixed(1))}
                        onChange={(e) =>
                          setBoneKeyframeAtCurrentTime(currentBoneObj.name, {
                            ...currentBonePoseAtTime,
                            x: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full bg-white/8 border border-white/15 rounded-xl px-2 py-1 font-mono text-white text-xs"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-slate-400">ΔY px</span>
                      <input
                        type="number"
                        step="1"
                        value={Number(currentBonePoseAtTime.y.toFixed(1))}
                        onChange={(e) =>
                          setBoneKeyframeAtCurrentTime(currentBoneObj.name, {
                            ...currentBonePoseAtTime,
                            y: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="w-full bg-white/8 border border-white/15 rounded-xl px-2 py-1 font-mono text-white text-xs"
                      />
                    </label>
                  </div>
                </div>

                {/* Visual Cubic Bezier Curve Graph Editor */}
                <div className="p-2.5 rounded-2xl liquid-glass-well space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-cyan-200">Bezier Interpolation Graph</span>
                    <svg width="44" height="32" viewBox="0 0 44 32" className="rounded bg-black/40 border border-white/10">
                      <path
                        d={activeBezierPreset.svgPath}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {BEZIER_PRESETS.map((bp) => (
                      <button
                        key={bp.id}
                        onClick={() => {
                          setActiveCurveId(bp.id);
                          setBoneCurveAtCurrentTime(currentBoneObj.name, bp.curve);
                        }}
                        className={`py-1 px-1.5 rounded-lg text-[10px] font-medium truncate transition ${
                          activeCurveId === bp.id
                            ? "bg-sky-400/25 text-sky-200 border border-sky-300/40"
                            : "bg-white/5 text-slate-400 hover:text-white"
                        }`}
                      >
                        {bp.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Real-Time 3D Normal-Map Point Relighting */}
                <div className="p-2.5 rounded-2xl liquid-glass-well space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-amber-200">3D Normal Relight</span>
                    <span className="text-[10px] font-mono text-slate-300">
                      {lightAngleDeg}° · {Math.round(lightIntensity * 100)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="-180"
                      max="180"
                      value={lightAngleDeg}
                      onChange={(e) => setLightParams(parseFloat(e.target.value), lightIntensity)}
                      title="Light Direction Angle"
                      className="flex-1 accent-amber-400"
                    />
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={lightIntensity}
                      onChange={(e) => setLightParams(lightAngleDeg, parseFloat(e.target.value))}
                      title="Light Intensity"
                      className="w-20 accent-amber-400"
                    />
                  </div>
                </div>
              </div>

              {/* Bottom Half: Photoshop Layers | Bones | History Stack */}
              <div className="flex-1 flex flex-col min-h-0 p-3">
                <div className="grid grid-cols-3 p-0.5 rounded-full liquid-glass-well text-[11px] mb-2.5 shrink-0">
                  <button
                    onClick={() => setLayersTab("layers")}
                    className={`whitespace-nowrap py-1 rounded-full font-semibold transition ${
                      layersTab === "layers" ? "bg-white/20 text-white shadow-sm" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Layers ({project.parts.length})
                  </button>
                  <button
                    onClick={() => setLayersTab("bones")}
                    className={`whitespace-nowrap py-1 rounded-full font-semibold transition ${
                      layersTab === "bones" ? "bg-white/20 text-white shadow-sm" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Bones ({project.bones.length})
                  </button>
                  <button
                    onClick={() => setLayersTab("history")}
                    className={`whitespace-nowrap py-1 rounded-full font-semibold transition ${
                      layersTab === "history" ? "bg-white/20 text-white shadow-sm" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    History ({history.length})
                  </button>
                </div>

                {layersTab === "layers" ? (
                  <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
                    {reversedLayers.map((part) => {
                      const isSelected = part.name === selectedPart;
                      const isHidden = hiddenParts.includes(part.name);
                      const isSkinned = Boolean(part.skin && part.skin.length > 1);
                      const vCount = part.mesh ? part.mesh.positions.length / 2 : 4;
                      return (
                        <div
                          key={part.name}
                          onClick={() => selectPart(part.name)}
                          className={`flex items-center justify-between px-2.5 py-2 rounded-2xl border text-xs cursor-pointer transition ${
                            isSelected
                              ? "bg-white/18 border-white/35 text-white shadow"
                              : "bg-white/5 border-white/8 text-slate-300 hover:bg-white/10"
                          } ${isHidden ? "opacity-45" : ""}`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePartVisibility(part.name);
                              }}
                              title={isHidden ? "Show Layer" : "Hide Layer"}
                              className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                                isHidden ? "bg-rose-500/25 text-rose-300" : "bg-white/10 text-sky-300"
                              }`}
                            >
                              {isHidden ? "–" : "●"}
                            </button>

                            <div className="min-w-0">
                              <div className="font-semibold truncate">{part.name}</div>
                              <div className="text-[10px] text-slate-400">
                                {vCount}v · {isSkinned ? `Mesh (${part.skin!.length}B)` : `Rigid (${part.bone})`}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                movePartLayerOrder(part.name, "up");
                              }}
                              title="Bring Forward (⌘])"
                              className="w-5 h-5 rounded-full liquid-glass-button text-[10px] flex items-center justify-center"
                            >
                              ↑
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                movePartLayerOrder(part.name, "down");
                              }}
                              title="Send Backward (⌘[)"
                              className="w-5 h-5 rounded-full liquid-glass-button text-[10px] flex items-center justify-center"
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : layersTab === "bones" ? (
                  <div className="flex-1 flex flex-col min-h-0">
                    <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
                      {project.bones.map((bone, idx) => {
                        const isSelected = bone.name === selectedBone;
                        const isLocked = lockedBones.includes(bone.name);
                        const col = bone.color ?? RIG_BONE_PALETTE[idx % RIG_BONE_PALETTE.length];
                        return (
                          <div
                            key={bone.name}
                            onClick={() => selectBone(bone.name)}
                            className={`flex items-center justify-between px-3 py-1.5 rounded-2xl text-xs cursor-pointer transition ${
                              isSelected
                                ? "bg-white/18 text-white border border-white/30"
                                : "hover:bg-white/8 text-slate-300 border border-transparent"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: col }}
                              />
                              <span className="font-medium truncate">{bone.name}</span>
                              {bone.spring && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-200">
                                  Spring
                                </span>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleBoneLock(bone.name);
                              }}
                              className={`text-[9px] px-2 py-0.5 rounded-full ${
                                isLocked ? "bg-rose-500/30 text-rose-200" : "bg-white/8 text-slate-400"
                              }`}
                            >
                              {isLocked ? "Locked" : "Free"}
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mt-2 pt-2 border-t border-white/10 flex gap-1.5 shrink-0">
                      <input
                        type="text"
                        placeholder="New bone..."
                        value={newBoneName}
                        onChange={(e) => setNewBoneName(e.target.value)}
                        className="flex-1 min-w-0 liquid-glass-well rounded-full px-3 py-1 text-xs text-white focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          if (!newBoneName.trim()) return;
                          addBone(
                            currentBoneObj.name,
                            newBoneName,
                            Math.min(0.95, currentBoneObj.x + 0.05),
                            Math.max(0.05, currentBoneObj.y - 0.08),
                          );
                          setNewBoneName("");
                        }}
                        className="whitespace-nowrap px-3 py-1 rounded-full liquid-glass-button text-xs font-semibold text-sky-200"
                      >
                        + Add
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Photoshop History Stack Tab */
                  <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
                    {history.map((snap, idx) => {
                      const isCurrent = idx === historyIndex;
                      const isFuture = idx > historyIndex;
                      return (
                        <div
                          key={snap.id}
                          onClick={() => jumpToHistory(idx)}
                          className={`flex items-center justify-between px-3 py-2 rounded-2xl text-xs cursor-pointer transition ${
                            isCurrent
                              ? "bg-sky-400/25 border border-sky-300/40 text-white font-semibold"
                              : isFuture
                                ? "opacity-40 hover:opacity-75 text-slate-400"
                                : "bg-white/5 hover:bg-white/10 text-slate-300"
                          }`}
                        >
                          <span className="truncate">{snap.label}</span>
                          <span className="text-[10px] font-mono text-slate-400 shrink-0 ml-2">
                            {snap.timestamp}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </aside>

            {/* 4. EXTREME-RIGHT DOCK: AI Agent Copilot Window (ChatGPT, Cursor, Claude, Grok) */}
            {showAiCopilot && <AiAgentPanel onTriggerExport={handleRunExport} />}
          </div>
        </div>

        {/* Live Contextual Canvas Coach Pill */}
        <CanvasCoachPill onOpenManual={() => setShowUserManual(true)} />

        {/* BOTTOM ROW: Photoshop Video Timeline, Unity AnimationEvents & Keyframe Dope Sheet Dock */}
        <footer
          className={`pointer-events-auto rounded-[28px] liquid-glass transition-all duration-300 flex flex-col overflow-hidden shrink-0 ${
            dopeSheetExpanded ? "h-56" : "h-14"
          }`}
        >
          <div className="px-5 h-14 flex items-center gap-3 text-xs shrink-0">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`whitespace-nowrap shrink-0 px-4 py-1.5 rounded-full font-bold transition ${
                isPlaying
                  ? "bg-amber-400 text-slate-950 shadow-[0_0_16px_rgba(251,191,36,0.5)]"
                  : "liquid-glass-active"
              }`}
            >
              {isPlaying ? "Pause" : "Play"}
            </button>

            <div className="flex items-center gap-1 p-1 rounded-full liquid-glass-well shrink-0">
              <select
                value={activeClip}
                onChange={(e) => setActiveClip(e.target.value)}
                className="bg-transparent px-2.5 py-0.5 text-[11px] font-bold text-sky-300 focus:outline-none cursor-pointer"
              >
                {Object.keys(project.animations).map((clipName) => (
                  <option key={clipName} value={clipName} className="bg-slate-950 text-white">
                    Clip: {clipName} ({project.animations[clipName]!.duration}s)
                  </option>
                ))}
              </select>
              {(["idle", "anticipation", "strike", "zeus-bolt", "symbol-win", "chest-open"] as const).map(
                (clipName) =>
                  project.animations[clipName] ? (
                    <button
                      key={clipName}
                      onClick={() => setActiveClip(clipName)}
                      className={`whitespace-nowrap shrink-0 px-2 py-0.5 rounded-full text-[10.5px] font-semibold capitalize transition ${
                        activeClip === clipName
                          ? "bg-white/22 text-white shadow-sm"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {clipName}
                    </button>
                  ) : null,
              )}
            </div>

            {/* Scrubber + Unity Event Markers Overlay */}
            <div className="flex-1 flex items-center gap-3 min-w-[140px]">
              <div className="relative flex-1 flex items-center">
                <input
                  type="range"
                  min={0}
                  max={currentClipObj?.duration ?? 2.4}
                  step={0.01}
                  value={currentTime}
                  onChange={(e) => {
                    setIsPlaying(false);
                    setCurrentTime(parseFloat(e.target.value));
                  }}
                  className="w-full accent-sky-300 cursor-pointer"
                />
                {/* Render Unity AnimationEvent flags along the scrubber */}
                {(currentClipObj?.events ?? []).map((ev, idx) => {
                  const pct = Math.max(0, Math.min(100, (ev.time / (currentClipObj?.duration ?? 2.4)) * 100));
                  return (
                    <button
                      key={`${ev.name}-${idx}`}
                      onClick={() => {
                        setIsPlaying(false);
                        setCurrentTime(ev.time);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        deleteAnimationEvent(ev.time, ev.name);
                      }}
                      title={`Unity AnimationEvent: ${ev.name} (${ev.stringParam ?? ""}) @ ${ev.time}s — Right-click to remove`}
                      style={{ left: `${pct}%` }}
                      className="absolute -top-2.5 -translate-x-1/2 px-1.5 py-0.2 rounded-full bg-amber-400 text-slate-950 text-[8px] font-extrabold shadow"
                    >
                      ⚡{ev.name}
                    </button>
                  );
                })}
              </div>
              <span className="font-mono text-xs text-slate-300 whitespace-nowrap shrink-0">
                <strong className="text-white">{currentTime.toFixed(2)}s</strong> /{" "}
                {(currentClipObj?.duration ?? 2.4).toFixed(1)}s
              </span>
            </div>

            {/* Add Unity AnimationEvent Trigger Control */}
            <div className="flex items-center gap-1 liquid-glass-well rounded-full px-2 py-0.5 shrink-0">
              <select
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                className="bg-transparent text-[11px] text-amber-200 font-semibold focus:outline-none"
              >
                <option value="OnHit" className="bg-slate-950">⚡ OnHit</option>
                <option value="SpawnVFX" className="bg-slate-950">✨ SpawnVFX</option>
                <option value="PlaySFX" className="bg-slate-950">🔊 PlaySFX</option>
                <option value="CameraShake" className="bg-slate-950">💥 CameraShake</option>
              </select>
              <button
                onClick={() => addAnimationEventAtCurrentTime(eventType, `fx_${activeClip}_${eventType.toLowerCase()}`, 1.0)}
                title="Add Unity AnimationEvent & Spine Event at Playhead"
                className="px-2 py-0.5 rounded-full bg-amber-400/25 text-amber-200 text-[10px] font-bold hover:bg-amber-400/40"
              >
                + Event
              </button>
            </div>

            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              className="liquid-glass-well rounded-full px-2 py-1 text-[11px] text-slate-200 shrink-0"
            >
              <option value={0.25} className="bg-slate-950">0.25×</option>
              <option value={0.5} className="bg-slate-950">0.5×</option>
              <option value={1} className="bg-slate-950">1.0×</option>
              <option value={1.5} className="bg-slate-950">1.5×</option>
            </select>

            <button
              onClick={bakeCurrentClipSprings}
              className="whitespace-nowrap shrink-0 px-2.5 py-1 rounded-full liquid-glass-button text-[11px] font-semibold text-amber-200"
            >
              Bake Springs
            </button>

            <button
              onClick={() => setDopeSheetExpanded(!dopeSheetExpanded)}
              className="whitespace-nowrap shrink-0 px-3 py-1 rounded-full liquid-glass-button text-[11px] font-semibold text-sky-200"
            >
              {dopeSheetExpanded ? "Hide Dope Sheet" : "Dope Sheet"}
            </button>
          </div>

          {dopeSheetExpanded && (
            <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-1 border-t border-white/10 pt-2">
              {project.bones.map((bone, idx) => {
                const keys = currentClipObj?.boneTracks[bone.name] ?? [];
                const duration = currentClipObj?.duration ?? 2.4;
                const col = bone.color ?? RIG_BONE_PALETTE[idx % RIG_BONE_PALETTE.length];
                return (
                  <div
                    key={bone.name}
                    onClick={() => selectBone(bone.name)}
                    className={`flex items-center gap-3 h-5 rounded-lg px-2 ${
                      bone.name === selectedBone ? "bg-white/12" : "hover:bg-white/5"
                    }`}
                  >
                    <span className="w-28 text-[11px] font-mono truncate shrink-0 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col }} />
                      {bone.name}
                    </span>
                    <div className="relative flex-1 h-3 rounded-full liquid-glass-well">
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-sky-300/80 pointer-events-none"
                        style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }}
                      />
                      {keys.map((k, kIdx) => {
                        const leftPct = Math.max(0, Math.min(100, (k.time / duration) * 100));
                        return (
                          <button
                            key={kIdx}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (e.altKey) {
                                deleteBoneKeyframe(bone.name, k.time);
                              } else {
                                setIsPlaying(false);
                                setCurrentTime(k.time);
                                selectBone(bone.name);
                              }
                            }}
                            title={`${bone.name} @ ${k.time}s (r=${k.r ?? 0}°) — Alt+Click to delete`}
                            style={{ left: `${leftPct}%` }}
                            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-2.5 w-2.5 rotate-45 bg-cyan-300 hover:bg-white shadow-[0_0_8px_#67e8f9] border border-slate-950"
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </footer>
      </div>

      {/* 3. Floating Liquid Glass Export Modal Overlay */}
      {mode === "export" && exportData && (
        <div className="fixed inset-0 z-40 bg-slate-950/65 backdrop-blur-xl flex items-center justify-center p-8">
          <div className="max-w-5xl w-full rounded-[32px] liquid-glass p-6 space-y-5 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-white/15 pb-4">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                  Triple Unity + Spine 4.2 Bundle Ready (Includes Events, Multi-Skins & FFD)
                </span>
                <h2 className="text-xl font-bold text-white mt-0.5">{project.title}</h2>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setMode("animate")}
                  className="whitespace-nowrap px-4 py-2 rounded-full liquid-glass-button text-xs font-semibold text-slate-200"
                >
                  Close Preview
                </button>
                <button
                  onClick={handleExportTransparentWebM}
                  className="whitespace-nowrap px-4 py-2 rounded-full liquid-glass-button text-xs font-bold text-amber-200"
                >
                  Export Transparent .WebM Video
                </button>
                <button
                  onClick={handleDownloadZip}
                  className="whitespace-nowrap px-5 py-2 rounded-full liquid-glass-active text-xs font-bold"
                >
                  Download Complete .ZIP Bundle
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              {(
                [
                  { id: "unity", label: "Zero-Dependency Unity Runtime (.sfrig.json)" },
                  { id: "spine", label: "Spine 4.2 (.json + .atlas.txt)" },
                  { id: "sheet", label: "Baked Flipbook Sprite Sheet (.sprites.json)" },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setExportTab(t.id)}
                  className={`whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-semibold transition ${
                    exportTab === t.id ? "liquid-glass-active" : "liquid-glass-button text-slate-300"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-5 flex-1 min-h-0">
              <div className="rounded-2xl liquid-glass-well p-4 flex flex-col items-center justify-center overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={exportTab === "sheet" ? exportData.spriteSheetDataUrl : exportData.atlasDataUrl}
                  alt="Exported Atlas"
                  className="max-h-80 object-contain rounded-xl border border-white/10"
                />
              </div>
              <div className="rounded-2xl liquid-glass-well p-4 flex flex-col min-h-0">
                <pre className="flex-1 overflow-auto text-[11px] font-mono text-cyan-200">
                  {exportTab === "unity"
                    ? exportData.unitySfRigJson.slice(0, 6000)
                    : exportTab === "spine"
                      ? `// --- ${project.id}.atlas.txt ---\n${exportData.spineAtlasTxt}\n// --- ${project.id}.json ---\n${exportData.spineJson.slice(0, 5000)}`
                      : exportData.spriteSheetJson.slice(0, 6000)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Liquid Glass Smart Part Cutter & PSD Importer Modal */}
      {showPartCutterModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xl flex items-center justify-center p-4">
          <div className="rounded-[28px] liquid-glass max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                Photoshop .PSD Layer Importer & Smart Part Knife
              </h3>
              <button
                onClick={() => setShowPartCutterModal(false)}
                className="whitespace-nowrap px-3 py-1 rounded-full liquid-glass-button text-xs text-slate-200"
              >
                Done
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Upload a layered Photoshop <code className="text-sky-300">.psd</code> file or a flat <code className="text-sky-300">.png/.webp</code> character. Kinetic Pro preserves layer order, generates circular joint cover rings, and inpaints occluded torso areas.
            </p>
            <input
              type="file"
              accept=".png,.webp,.psd"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleSmartCutUpload(f);
              }}
              className="block w-full text-xs text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-sky-400 file:text-slate-950 cursor-pointer"
            />
            {cutterStatus && (
              <div className="p-3 rounded-2xl liquid-glass-well text-xs font-mono text-emerald-300">
                {cutterStatus}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Interactive User Manual & Step-by-Step Guided Tour Modal */}
      <UserManualModal
        isOpen={showUserManual}
        onClose={() => setShowUserManual(false)}
        onTriggerExport={handleRunExport}
      />
    </div>
  );
}
