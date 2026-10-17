"use client";

import { useEffect, useState } from "react";
import { RIG_BONE_PALETTE } from "@/core/schema";
import { useStudioStore, type StudioMode } from "@/store/useStudioStore";
import { AiAgentPanel } from "./AiAgentPanel";
import { LeftToolOptionsPane } from "./LeftToolOptionsPane";
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

export function StudioApp() {
  const {
    project,
    mode,
    selectedBone,
    selectedPart,
    activeClip,
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
    showHitboxes,
    showSlotStage,
    isolatePart,
    brushRadius,
    lockedBones,
    hiddenParts,
    history,
    historyIndex,
    setMode,
    selectBone,
    selectPart,
    setActiveClip,
    setCurrentTime,
    setIsPlaying,
    setPlaybackSpeed,
    undo,
    redo,
    jumpToHistory,
    addBone,
    setBrushRadius,
    toggleOverlay,
    toggleBoneLock,
    togglePartVisibility,
    movePartLayerOrder,
    deleteBoneKeyframe,
    addAnimationEventAtCurrentTime,
    deleteAnimationEvent,
    bakeCurrentClipSprings,
  } = useStudioStore();

  // Right-Center Dock Tab: Layers | Bones | History
  const [layersTab, setLayersTab] = useState<"layers" | "bones" | "history">("layers");
  const [showAiCopilot, setShowAiCopilot] = useState(true);
  const [dopeSheetExpanded, setDopeSheetExpanded] = useState(false);
  const [eventType, setEventType] = useState("OnHit");

  const [newBoneName, setNewBoneName] = useState("");
  const [exportData, setExportData] = useState<ExportBundlePreview | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportTab, setExportTab] = useState<"unity" | "spine" | "sheet">("unity");
  const [showUserManual, setShowUserManual] = useState(false);
  const [saveBadge, setSaveBadge] = useState<string>("Saved");

  const currentBoneObj = project.bones.find((b) => b.name === selectedBone) ?? project.bones[0]!;
  const currentClipObj = project.animations[activeClip];

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

  // Single-key Photoshop shortcuts: O (Import PSD), A (Auto Studio), V (Pose), P (Rig Pin), M (Mesh), B (Weight Brush), W (Liquify FFD)
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
      if (key === "o" || key === "k") setMode("import");
      else if (key === "a") setMode("auto");
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

  const reversedLayers = [...project.parts].reverse();

  return (
    <div className="relative h-screen w-screen overflow-hidden select-none">
      {/* 1. Full-Bleed 100% Spatial Canvas Stage (No Top Bar Obstructing the Stage) */}
      <StudioViewport />

      {/* 2. Spatial Workspace Columns:
          [Left Group: Vertical Tool Rail (Import PSD above Auto) + Contextual Tool Options Pane]
          [Unobstructed Center Canvas]
          [Right Group: Layers/Bones/History Stack + Extreme-Right AI Copilot] */}
      <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-3.5 gap-3">
        {/* MAIN WORKSPACE ROW */}
        <div className="flex-1 min-h-0 flex items-stretch justify-between gap-3">
          {/* LEFT GROUP: [1. Vertical Tool Rail] + [2. Contextual Photoshop Tool Options Pane] */}
          <div className="flex items-stretch gap-3 shrink-0">
            {/* 1. Far-Left Vertical Tool Rail (Import PSD tab placed at the very top above Auto) */}
            <aside className="pointer-events-auto w-15 rounded-[26px] liquid-glass py-2.5 px-1.5 flex flex-col items-center justify-between shrink-0">
              <div className="space-y-1.5 flex flex-col items-center w-full">
                {(
                  [
                    {
                      id: "import",
                      key: "PSD",
                      sub: "Import",
                      label: "Import PSD / Cut PNG & Document Setup (O)",
                    },
                    {
                      id: "auto",
                      key: "A",
                      sub: "Auto",
                      label: "1-Click Auto Studio: Visual Physics & 14 Game Actions (A)",
                    },
                    {
                      id: "animate",
                      key: "V",
                      sub: "Pose",
                      label: "Move / Free Transform Pose Tool (V)",
                    },
                    {
                      id: "rig",
                      key: "P",
                      sub: "Rig",
                      label: "Bone & IK Pin Tool (P)",
                    },
                    {
                      id: "mesh",
                      key: "M",
                      sub: "Mesh",
                      label: "Puppet Warp Delaunay Mesh Tool (M)",
                    },
                    {
                      id: "weights",
                      key: "B",
                      sub: "Brush",
                      label: "GPU Weight Paint Brush Tool (B)",
                    },
                    {
                      id: "liquify",
                      key: "W",
                      sub: "Warp",
                      label: "Liquify FFD Vertex Sculpt Tool (W)",
                    },
                  ] as { id: StudioMode; key: string; sub: string; label: string }[]
                ).map((tool) => {
                  const active = mode === tool.id;
                  return (
                    <button
                      key={tool.id}
                      onClick={() => setMode(tool.id)}
                      title={tool.label}
                      className={`w-11 h-10 rounded-2xl font-bold text-xs flex flex-col items-center justify-center transition ${
                        active
                          ? "liquid-glass-active"
                          : tool.id === "import"
                            ? "liquid-glass-button text-cyan-200 border-cyan-400/35 hover:text-white"
                            : "liquid-glass-button text-slate-300 hover:text-white"
                      }`}
                    >
                      <span className={tool.key === "PSD" ? "text-[10px] tracking-tight" : "text-xs"}>
                        {tool.key}
                      </span>
                      <span className="text-[8px] font-normal opacity-80">{tool.sub}</span>
                    </button>
                  );
                })}
              </div>

              <div className="w-8 h-px bg-white/15 my-0.5" />

              {/* Viewport Guide & Overlay Toggles */}
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
                    className={`w-11 py-1 rounded-xl text-[9px] font-semibold transition ${
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

            {/* 2. Contextual Photoshop Tool Options Pane (Provides full controls for whichever tool is clicked) */}
            <LeftToolOptionsPane onShipToUnity={handleRunExport} />
          </div>

          {/* Center Canvas Spacer */}
          <div className="flex-1 pointer-events-none" />

          {/* RIGHT GROUP: [3. Photoshop Layers / Bones / History Dock] + [4. Extreme-Right AI Copilot] */}
          <div className="flex items-stretch gap-3 shrink-0">
            {/* 3. Right-Center Dock: Global Actions Header + Photoshop Layers / Bones / History Stack */}
            <aside className="pointer-events-auto w-76 rounded-[26px] liquid-glass flex flex-col overflow-hidden shrink-0">
              {/* Compact Action Header (Undo, Redo, Save, Export Unity, AI Copilot, Guide) */}
              <div className="p-3 border-b border-white/12 space-y-2.5 shrink-0">
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-gradient-to-tr from-cyan-400 to-sky-200 shadow-[0_0_10px_#38bdf8]" />
                    <span className="font-bold text-xs text-white tracking-tight">Kinetic Pro</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={undo}
                      disabled={historyIndex <= 0}
                      title="Undo (⌘Z)"
                      className="px-2 py-0.5 rounded-full liquid-glass-button text-[11px] font-bold text-slate-200 disabled:opacity-35"
                    >
                      ↶
                    </button>
                    <button
                      onClick={redo}
                      disabled={historyIndex >= history.length - 1}
                      title="Redo (⇧⌘Z)"
                      className="px-2 py-0.5 rounded-full liquid-glass-button text-[11px] font-bold text-slate-200 disabled:opacity-35"
                    >
                      ↷
                    </button>
                    <button
                      onClick={() => void handleSaveProject()}
                      title="Save Project (⌘S)"
                      className="px-2.5 py-0.5 rounded-full liquid-glass-button text-[10.5px] font-semibold text-sky-200"
                    >
                      {saveBadge}
                    </button>
                    <button
                      onClick={() => setShowUserManual(true)}
                      title="Interactive User Manual (?)"
                      className="px-2 py-0.5 rounded-full liquid-glass-button text-[10.5px] font-bold text-amber-200"
                    >
                      ?
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    onClick={handleRunExport}
                    disabled={isExporting}
                    className="py-1.5 rounded-full text-[11px] font-bold bg-gradient-to-b from-emerald-300 to-emerald-500 text-slate-950 shadow-[0_0_14px_rgba(52,211,153,0.4)] hover:brightness-110 transition disabled:opacity-50"
                  >
                    {isExporting ? "Baking..." : "Export Unity"}
                  </button>
                  <button
                    onClick={() => setShowAiCopilot(!showAiCopilot)}
                    className={`py-1.5 rounded-full text-[11px] font-bold transition ${
                      showAiCopilot ? "liquid-glass-active" : "liquid-glass-button text-slate-200"
                    }`}
                  >
                    {showAiCopilot ? "Hide AI Copilot" : "AI Copilot"}
                  </button>
                </div>
              </div>

              {/* Photoshop Layers | Bones | History Stack */}
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

      {/* 4. Interactive User Manual & Step-by-Step Guided Tour Modal */}
      <UserManualModal
        isOpen={showUserManual}
        onClose={() => setShowUserManual(false)}
        onTriggerExport={handleRunExport}
      />
    </div>
  );
}
