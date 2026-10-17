"use client";

import { useEffect, useState } from "react";
import { RIG_BONE_PALETTE } from "@/core/schema";
import { buildBrowserUnityExportBundle } from "@/exporters/browser-bundle-builder";
import { useStudioStore, type StudioMode } from "@/store/useStudioStore";
import { AiAgentPanel } from "./AiAgentPanel";
import { LeftToolOptionsPane, type ExportBundlePreviewData } from "./LeftToolOptionsPane";
import { StudioViewport } from "./StudioViewport";
import { UserManualModal } from "./UserManualModal";

/** Crisp inline SVG icons for the Photoshop Left Tool Rail (Magic Wand, PSD, Unity Cube, AI Copilot, Layers, etc.) */
function ToolRailIcon({ id }: { id: string }) {
  switch (id) {
    case "import":
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
          <path d="M12 10v6" />
          <path d="m9 13 3-3 3 3" />
        </svg>
      );
    case "auto":
      // Photoshop Magic Wand Icon
      return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 4-1 1 6 6 1-1a2.83 2.83 0 1 0-4-4Z" />
          <path d="m13 6-9.5 9.5a2.12 2.12 0 1 0 3 3L16 9" />
          <path d="M6 2v3" />
          <path d="M4.5 3.5h3" />
          <path d="M20 15v3" />
          <path d="M18.5 16.5h3" />
        </svg>
      );
    case "animate":
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 9-3 3 3 3" />
          <path d="m9 5 3-3 3 3" />
          <path d="m15 19-3 3-3-3" />
          <path d="m19 9 3 3-3 3" />
          <line x1="2" x2="22" y1="12" y2="12" />
          <line x1="12" x2="12" y1="2" y2="22" />
        </svg>
      );
    case "rig":
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <line x1="8.12" x2="15.88" y1="8.12" y2="15.88" />
        </svg>
      );
    case "mesh":
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 19 22 19 12 2" />
          <line x1="12" x2="12" y1="2" y2="19" />
          <line x1="7" x2="17" y1="11" y2="11" />
        </svg>
      );
    case "weights":
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z" />
          <path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7" />
        </svg>
      );
    case "liquify":
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
          <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
          <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
        </svg>
      );
    case "export":
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <path d="m3.3 7 8.7 5 8.7-5" />
          <path d="M12 22V12" />
        </svg>
      );
    case "copilot":
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
        </svg>
      );
    case "layers":
      return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      );
    case "undo":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" />
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        </svg>
      );
    case "redo":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6" />
          <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
        </svg>
      );
    case "showBones":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="7" cy="7" r="2.5" />
          <circle cx="17" cy="17" r="2.5" />
          <line x1="8.8" y1="8.8" x2="15.2" y2="15.2" />
        </svg>
      );
    case "showMeshWireframe":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
      );
    case "showHeatmap":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2c1.5 3.5 4 5.5 4 9a4 4 0 1 1-8 0c0-2 1-3.5 2-5.5" />
          <path d="M12 22a7 7 0 0 0 7-7c0-3.5-2-6-4-8" />
        </svg>
      );
    case "showOnionSkin":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="12" r="5" strokeDasharray="2 2" />
          <circle cx="15" cy="12" r="5" />
        </svg>
      );
    case "showMotionArcs":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 17C6 7 18 7 21 17" strokeDasharray="3 2" />
          <circle cx="12" cy="9.5" r="2" />
        </svg>
      );
    case "showSlashTrail":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20C10 18 16 12 20 4" />
          <path d="M9 21c5-2 9-6 12-12" />
        </svg>
      );
    case "enable3DRelight":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
        </svg>
      );
    case "showHitboxes":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="4 2" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      );
    case "showSlotStage":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <line x1="9" y1="4" x2="9" y2="20" />
          <line x1="15" y1="4" x2="15" y2="20" />
          <line x1="2" y1="12" x2="22" y2="12" />
        </svg>
      );
    case "isolatePart":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "help":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
      );
    default:
      return null;
  }
}

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
    runOneClickAutoRig,
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

  // Photoshop-style Hideable & Stackable Dock State
  const [leftPaneOpen, setLeftPaneOpen] = useState(true);
  const [showLayersPane, setShowLayersPane] = useState(true);
  const [layersShaded, setLayersShaded] = useState(false);
  const [showAiCopilot, setShowAiCopilot] = useState(true);
  // Stack Layers & AI Copilot vertically in a single column (Photoshop Dock style) vs side-by-side
  const [stackRightDock, setStackRightDock] = useState(true);

  const [layersTab, setLayersTab] = useState<"layers" | "bones" | "history">("layers");
  const [dopeSheetExpanded, setDopeSheetExpanded] = useState(false);
  const [timelineDock, setTimelineDock] = useState<"bottom" | "top">("bottom");
  const [eventType, setEventType] = useState("OnHit");

  const [newBoneName, setNewBoneName] = useState("");
  const [exportData, setExportData] = useState<ExportBundlePreviewData | null>(null);
  const [isExporting, setIsExporting] = useState(false);
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

  const handleRunExport = async () => {
    setIsExporting(true);
    setLeftPaneOpen(true);
    setMode("export");
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project, format: "preview", sheetCellHeight: 192, sheetFps: 10 }),
      });
      if (res.ok) {
        const data = await res.json();
        setExportData(data);
      } else {
        const fallback = await buildBrowserUnityExportBundle(project);
        setExportData(fallback);
      }
    } catch {
      const fallback = await buildBrowserUnityExportBundle(project);
      setExportData(fallback);
    } finally {
      setIsExporting(false);
    }
  };

  // Clicking a tool in the Left Rail: if already active & open, toggles the left pane closed; otherwise opens it
  const handleSelectLeftTool = (targetMode: StudioMode) => {
    if (targetMode === "auto") {
      runOneClickAutoRig();
    }
    if (targetMode === "export" && !exportData && !isExporting) {
      void handleRunExport();
      return;
    }
    if (mode === targetMode && leftPaneOpen) {
      setLeftPaneOpen(false);
    } else {
      setMode(targetMode);
      setLeftPaneOpen(true);
    }
  };

  // Single-key Photoshop shortcuts
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
      if (key === "o") handleSelectLeftTool("import");
      else if (key === "a") handleSelectLeftTool("auto");
      else if (key === "v") handleSelectLeftTool("animate");
      else if (key === "p") handleSelectLeftTool("rig");
      else if (key === "m") handleSelectLeftTool("mesh");
      else if (key === "b") handleSelectLeftTool("weights");
      else if (key === "w") handleSelectLeftTool("liquify");
      else if (key === "e") handleSelectLeftTool("export");
      else if (key === "c") setShowAiCopilot((v) => !v);
      else if (key === "l") setShowLayersPane((v) => !v);
      else if (e.key === "Tab") {
        e.preventDefault();
        const anyOpen = leftPaneOpen || showLayersPane || showAiCopilot;
        setLeftPaneOpen(!anyOpen);
        setShowLayersPane(!anyOpen);
        setShowAiCopilot(!anyOpen);
      } else if (e.key === "[") setBrushRadius(Math.max(15, brushRadius - 10));
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
  }, [brushRadius, isPlaying, leftPaneOpen, mode, project, redo, showAiCopilot, showLayersPane, undo]);

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
      {/* 1. Full-Bleed 100% Spatial Canvas Stage */}
      <StudioViewport />

      {/* 2. Photoshop Dockable, Stackable & Hideable Workspace (Supports Stacking Timeline at Top or Bottom) */}
      <div
        className={`fixed inset-0 z-20 pointer-events-none flex justify-between p-3 gap-2.5 ${
          timelineDock === "top" ? "flex-col-reverse" : "flex-col"
        }`}
      >
        <div className="flex-1 min-h-0 flex items-stretch justify-between gap-2.5">
          {/* LEFT DOCK: [1. Unified Photoshop Vertical Tool Rail] + [2. Hideable/Stackable Tool Options Pane] */}
          <div className="flex items-stretch gap-2.5 shrink-0">
            {/* 1. Far-Left Unified Photoshop Vertical Tool Rail:
                - Import PSD (top)
                - Magic Wand 1-Click Auto-Rig (below Import PSD)
                - Pose (V), Rig (P), Mesh (M), Brush (B), Warp (W)
                - Export Unity (E)
                - AI Copilot (C)
                - Layers Dock Toggle (L) */}
            {/* 1. Far-Left Unified 2-Column Photoshop Tool Palette:
                Every tool AND every viewport/stage tool uses the exact same icon + label button format */}
            <aside className="pointer-events-auto w-26 rounded-[26px] liquid-glass py-2.5 px-2 flex flex-col items-center justify-between shrink-0 overflow-y-auto">
              <div className="grid grid-cols-2 gap-1.5 w-full">
                {(
                  [
                    {
                      id: "import",
                      sub: "PSD",
                      label: "Import PSD / Cut PNG & Document Setup (O) — Click to open/hide pane",
                    },
                    {
                      id: "auto",
                      sub: "Auto",
                      label: "Magic Wand 1-Click Auto-Rig & Visual Physics (A) — Click to open/hide pane",
                    },
                    {
                      id: "animate",
                      sub: "Pose V",
                      label: "Move / Free Transform Pose Tool (V) — Click to open/hide pane",
                    },
                    {
                      id: "rig",
                      sub: "Rig P",
                      label: "Bone & IK Pin Tool (P) — Click to open/hide pane",
                    },
                    {
                      id: "mesh",
                      sub: "Mesh M",
                      label: "Puppet Warp Delaunay Mesh Tool (M) — Click to open/hide pane",
                    },
                    {
                      id: "weights",
                      sub: "Brush B",
                      label: "GPU Weight Paint Brush Tool (B) — Click to open/hide pane",
                    },
                    {
                      id: "liquify",
                      sub: "Warp W",
                      label: "Liquify FFD Vertex Sculpt Tool (W) — Click to open/hide pane",
                    },
                    {
                      id: "export",
                      sub: "Unity",
                      label: "Export Unity & Spine 4.2 Bundle (E) — Click to open/hide pane",
                    },
                  ] as { id: StudioMode; sub: string; label: string }[]
                ).map((tool) => {
                  const active = mode === tool.id && leftPaneOpen;
                  return (
                    <button
                      key={tool.id}
                      onClick={() => handleSelectLeftTool(tool.id)}
                      title={tool.label}
                      className={`w-full h-10 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-0.5 transition ${
                        active
                          ? "liquid-glass-active"
                          : tool.id === "auto"
                            ? "liquid-glass-button text-amber-200 border-amber-400/35 hover:text-white"
                            : tool.id === "export"
                              ? "liquid-glass-button text-emerald-200 border-emerald-400/35 hover:text-white"
                              : "liquid-glass-button text-slate-300 hover:text-white"
                      }`}
                    >
                      <ToolRailIcon id={tool.id} />
                      <span className="text-[7.5px] font-semibold tracking-tight leading-none">
                        {tool.sub}
                      </span>
                    </button>
                  );
                })}

                {/* Undo (⌘Z) & Redo (⇧⌘Z) Icon Buttons */}
                <button
                  onClick={undo}
                  disabled={historyIndex <= 0}
                  title="Undo (⌘Z)"
                  className="w-full h-10 rounded-2xl liquid-glass-button text-sky-200 hover:text-white disabled:opacity-40 font-bold text-xs flex flex-col items-center justify-center gap-0.5 transition"
                >
                  <ToolRailIcon id="undo" />
                  <span className="text-[7.5px] font-semibold tracking-tight leading-none">Undo</span>
                </button>

                <button
                  onClick={redo}
                  disabled={historyIndex >= history.length - 1}
                  title="Redo (⇧⌘Z)"
                  className="w-full h-10 rounded-2xl liquid-glass-button text-sky-200 hover:text-white disabled:opacity-40 font-bold text-xs flex flex-col items-center justify-center gap-0.5 transition"
                >
                  <ToolRailIcon id="redo" />
                  <span className="text-[7.5px] font-semibold tracking-tight leading-none">Redo</span>
                </button>

                {/* AI Copilot & Layers Stack Dock Icon Buttons */}
                <button
                  onClick={() => setShowAiCopilot(!showAiCopilot)}
                  title="Toggle AI Rigging Copilot Pane (C)"
                  className={`w-full h-10 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-0.5 transition ${
                    showAiCopilot
                      ? "liquid-glass-active"
                      : "liquid-glass-button text-purple-200 border-purple-400/35 hover:text-white"
                  }`}
                >
                  <ToolRailIcon id="copilot" />
                  <span className="text-[7.5px] font-semibold tracking-tight leading-none">Copilot</span>
                </button>

                <button
                  onClick={() => setShowLayersPane(!showLayersPane)}
                  title="Toggle Layers / Bones / History Pane (L)"
                  className={`w-full h-10 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-0.5 transition ${
                    showLayersPane
                      ? "liquid-glass-active"
                      : "liquid-glass-button text-slate-300 hover:text-white"
                  }`}
                >
                  <ToolRailIcon id="layers" />
                  <span className="text-[7.5px] font-semibold tracking-tight leading-none">Layers</span>
                </button>

                {/* All 10 Viewport & Stage Tools Rendered as Identical Top-Style Icon + Label Buttons */}
                {(
                  [
                    { key: "showBones", short: "Bone", active: showBones },
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
                    className={`w-full h-10 rounded-2xl font-bold text-xs flex flex-col items-center justify-center gap-0.5 transition ${
                      ov.active
                        ? "liquid-glass-active"
                        : "liquid-glass-button text-slate-300 hover:text-white"
                    }`}
                  >
                    <ToolRailIcon id={ov.key} />
                    <span className="text-[7.5px] font-semibold tracking-tight leading-none">
                      {ov.short}
                    </span>
                  </button>
                ))}

                {/* Question Mark (?) User Manual & Guided Tour Button at the Bottom of the Left Tools Pane */}
                <button
                  onClick={() => setShowUserManual(!showUserManual)}
                  title="User Manual & Guided Tour (?)"
                  className={`col-span-2 mx-auto w-10 h-10 rounded-full font-extrabold text-sm flex items-center justify-center transition ${
                    showUserManual
                      ? "liquid-glass-active"
                      : "liquid-glass-button text-amber-200 border-amber-400/35 hover:text-white"
                  }`}
                >
                  ?
                </button>
              </div>
            </aside>

            {/* 2. Hideable & Shadeable Left Tool Options Pane */}
            {leftPaneOpen && (
              <div className="flex flex-col gap-2.5 min-h-0">
                <LeftToolOptionsPane
                  onShipToUnity={handleRunExport}
                  onHidePane={() => setLeftPaneOpen(false)}
                  exportData={exportData}
                  isExporting={isExporting}
                  onDownloadZip={handleDownloadZip}
                  onExportWebM={handleExportTransparentWebM}
                />
              </div>
            )}
          </div>

          {/* Center Canvas Spacer */}
          <div className="flex-1 pointer-events-none" />

          {/* RIGHT DOCK: Stackable & Hideable Photoshop Panels (Layers / Bones / History + AI Copilot) */}
          {(showLayersPane || showAiCopilot) && (
            <div
              className={`flex min-h-0 gap-2.5 shrink-0 ${
                stackRightDock ? "flex-col w-80" : "flex-row items-stretch"
              }`}
            >
              {/* Panel A: Photoshop Layers / Bones / History Stack */}
              {showLayersPane && (
                <aside
                  className={`pointer-events-auto ${
                    stackRightDock ? "w-full" : "w-76"
                  } rounded-[26px] liquid-glass flex flex-col overflow-hidden transition-all ${
                    layersShaded ? "shrink-0" : "flex-1 min-h-0"
                  }`}
                >
                  {/* Panel Header with Undo/Redo, Save, Stack Toggle (📌), Shade (–), and Hide (×) */}
                  <div className="p-2.5 border-b border-white/12 flex items-center justify-between gap-1.5 shrink-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#38bdf8] shrink-0" />
                      <span className="font-bold text-xs text-white truncate">Layers & History</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={undo}
                        disabled={historyIndex <= 0}
                        title="Undo (⌘Z)"
                        className="px-2 py-0.5 rounded-full liquid-glass-button text-[10px] font-bold text-slate-200 disabled:opacity-35"
                      >
                        ↶
                      </button>
                      <button
                        onClick={redo}
                        disabled={historyIndex >= history.length - 1}
                        title="Redo (⇧⌘Z)"
                        className="px-2 py-0.5 rounded-full liquid-glass-button text-[10px] font-bold text-slate-200 disabled:opacity-35"
                      >
                        ↷
                      </button>
                      <button
                        onClick={() => void handleSaveProject()}
                        title="Save Project (⌘S)"
                        className="px-2 py-0.5 rounded-full liquid-glass-button text-[10px] font-semibold text-sky-200"
                      >
                        {saveBadge}
                      </button>
                      <button
                        onClick={() => setStackRightDock(!stackRightDock)}
                        title={
                          stackRightDock
                            ? "Unstack Panels (View Side-by-Side)"
                            : "Stack Panels Vertically (Photoshop Single-Column Dock)"
                        }
                        className="w-6 h-6 rounded-full liquid-glass-button text-[10px] font-bold text-amber-200 flex items-center justify-center"
                      >
                        {stackRightDock ? "⇄" : "⇅"}
                      </button>
                      <button
                        onClick={() => setLayersShaded(!layersShaded)}
                        title={layersShaded ? "Expand Layers Panel" : "Shade / Collapse Panel"}
                        className="w-6 h-6 rounded-full liquid-glass-button text-[11px] font-bold text-slate-200 flex items-center justify-center"
                      >
                        {layersShaded ? "▾" : "–"}
                      </button>
                      <button
                        onClick={() => setShowLayersPane(false)}
                        title="Hide Layers Panel to Tool Rail (L)"
                        className="w-6 h-6 rounded-full liquid-glass-button text-[11px] font-bold text-slate-300 hover:text-white flex items-center justify-center"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  {!layersShaded && (
                    <div className="flex-1 flex flex-col min-h-0 p-3">
                      <div className="grid grid-cols-3 p-0.5 rounded-full liquid-glass-well text-[11px] mb-2 shrink-0">
                        <button
                          onClick={() => setLayersTab("layers")}
                          className={`whitespace-nowrap py-1 rounded-full font-semibold transition ${
                            layersTab === "layers"
                              ? "bg-white/20 text-white shadow-sm"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          Layers ({project.parts.length})
                        </button>
                        <button
                          onClick={() => setLayersTab("bones")}
                          className={`whitespace-nowrap py-1 rounded-full font-semibold transition ${
                            layersTab === "bones"
                              ? "bg-white/20 text-white shadow-sm"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          Bones ({project.bones.length})
                        </button>
                        <button
                          onClick={() => setLayersTab("history")}
                          className={`whitespace-nowrap py-1 rounded-full font-semibold transition ${
                            layersTab === "history"
                              ? "bg-white/20 text-white shadow-sm"
                              : "text-slate-400 hover:text-white"
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
                                className={`flex items-center justify-between px-2.5 py-1.5 rounded-2xl border text-xs cursor-pointer transition ${
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
                        <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
                          {history.map((snap, idx) => {
                            const isCurrent = idx === historyIndex;
                            const isFuture = idx > historyIndex;
                            return (
                              <div
                                key={snap.id}
                                onClick={() => jumpToHistory(idx)}
                                className={`flex items-center justify-between px-3 py-1.5 rounded-2xl text-xs cursor-pointer transition ${
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
                  )}
                </aside>
              )}

              {/* Panel B: Stackable & Hideable AI Rigging Copilot Window */}
              {showAiCopilot && (
                <AiAgentPanel
                  onTriggerExport={handleRunExport}
                  onHidePane={() => setShowAiCopilot(false)}
                  widthClass={stackRightDock ? "w-full" : "w-80"}
                />
              )}
            </div>
          )}
        </div>

        {/* TIMELINE & DOPE SHEET DOCK (Can be stacked at the Top or Bottom of the Application) */}
        <footer
          className={`pointer-events-auto rounded-[28px] liquid-glass transition-all duration-300 flex flex-col overflow-hidden shrink-0 ${
            dopeSheetExpanded ? "h-56" : "h-14"
          }`}
        >
          <div className="px-3.5 h-14 flex items-center justify-between gap-2 text-xs shrink-0">
            {/* Left Transport + Stack Top/Bottom Button + Clip Selector */}
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className={`whitespace-nowrap shrink-0 px-3.5 py-1.5 rounded-full font-bold transition ${
                  isPlaying
                    ? "bg-amber-400 text-slate-950 shadow-[0_0_16px_rgba(251,191,36,0.5)]"
                    : "liquid-glass-active"
                }`}
              >
                {isPlaying ? "Pause" : "Play"}
              </button>

              <button
                onClick={() => setTimelineDock(timelineDock === "bottom" ? "top" : "bottom")}
                title={
                  timelineDock === "bottom"
                    ? "Stack Timeline Bar on Top of Application"
                    : "Stack Timeline Bar at Bottom of Application"
                }
                className="whitespace-nowrap shrink-0 px-2.5 py-1.5 rounded-full liquid-glass-button text-[11px] font-bold text-cyan-200 border-cyan-400/35 hover:text-white"
              >
                {timelineDock === "bottom" ? "↑ Stack Top" : "↓ Stack Bottom"}
              </button>

              <div className="flex items-center gap-1 p-1 rounded-full liquid-glass-well shrink-0">
                <select
                  value={activeClip}
                  onChange={(e) => setActiveClip(e.target.value)}
                  className="bg-transparent px-2 py-0.5 text-[11px] font-bold text-sky-300 focus:outline-none cursor-pointer"
                >
                  {Object.keys(project.animations).map((clipName) => (
                    <option key={clipName} value={clipName} className="bg-slate-950 text-white">
                      Clip: {clipName} ({project.animations[clipName]!.duration}s)
                    </option>
                  ))}
                </select>
                <div className="hidden 2xl:flex items-center gap-1">
                  {(["idle", "anticipation", "strike", "zeus-bolt", "symbol-win"] as const).map(
                    (clipName) =>
                      project.animations[clipName] ? (
                        <button
                          key={clipName}
                          onClick={() => setActiveClip(clipName)}
                          className={`whitespace-nowrap shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize transition ${
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
              </div>
            </div>

            {/* Center Scrubber + Unity Event Markers Overlay */}
            <div className="flex-1 flex items-center gap-2.5 min-w-[120px] px-1">
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
              <span className="font-mono text-[11px] text-slate-300 whitespace-nowrap shrink-0">
                <strong className="text-white">{currentTime.toFixed(2)}s</strong> /{" "}
                {(currentClipObj?.duration ?? 2.4).toFixed(1)}s
              </span>
            </div>

            {/* Right Controls: Event Trigger, Speed, Bake, Dope Sheet & Stack Top/Bottom */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center gap-1 liquid-glass-well rounded-full px-2 py-0.5 shrink-0">
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className="bg-transparent text-[10.5px] text-amber-200 font-semibold focus:outline-none"
                >
                  <option value="OnHit" className="bg-slate-950">⚡ OnHit</option>
                  <option value="SpawnVFX" className="bg-slate-950">✨ SpawnVFX</option>
                  <option value="PlaySFX" className="bg-slate-950">🔊 PlaySFX</option>
                  <option value="CameraShake" className="bg-slate-950">💥 Shake</option>
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
                className="liquid-glass-well rounded-full px-2 py-1 text-[10.5px] text-slate-200 shrink-0"
              >
                <option value={0.25} className="bg-slate-950">0.25×</option>
                <option value={0.5} className="bg-slate-950">0.5×</option>
                <option value={1} className="bg-slate-950">1.0×</option>
                <option value={1.5} className="bg-slate-950">1.5×</option>
              </select>

              <button
                onClick={bakeCurrentClipSprings}
                className="whitespace-nowrap shrink-0 px-2.5 py-1 rounded-full liquid-glass-button text-[10.5px] font-semibold text-amber-200"
              >
                Bake
              </button>

              <button
                onClick={() => setDopeSheetExpanded(!dopeSheetExpanded)}
                className={`whitespace-nowrap shrink-0 px-2.5 py-1 rounded-full text-[10.5px] font-semibold transition ${
                  dopeSheetExpanded
                    ? "liquid-glass-active"
                    : "liquid-glass-button text-sky-200"
                }`}
              >
                Dope Sheet
              </button>

              <button
                onClick={() => setTimelineDock(timelineDock === "bottom" ? "top" : "bottom")}
                title={
                  timelineDock === "bottom"
                    ? "Stack Timeline Bar on Top of Application"
                    : "Stack Timeline Bar at Bottom of Application"
                }
                className="whitespace-nowrap shrink-0 px-2.5 py-1 rounded-full liquid-glass-button text-[10.5px] font-bold text-cyan-200 hover:text-white"
              >
                {timelineDock === "bottom" ? "↑ Top" : "↓ Bottom"}
              </button>
            </div>
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

      {/* Interactive User Manual & Step-by-Step Guided Tour Modal */}
      <UserManualModal
        isOpen={showUserManual}
        onClose={() => setShowUserManual(false)}
        onTriggerExport={handleRunExport}
      />
    </div>
  );
}
