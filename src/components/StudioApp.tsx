"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { reviewClip } from "@/core/coach";
import { keyPreservingShape } from "@/core/keyframes";
import type { SpineForgeProject } from "@/core/schema";
import { RIG_BONE_PALETTE } from "@/core/schema";
import { buildBrowserUnityExportBundle } from "@/exporters/browser-bundle-builder";
import { useStudioStore, type StudioMode } from "@/store/useStudioStore";
import { AiAgentPanel } from "./AiAgentPanel";
import { BudgetPanel } from "./BudgetPanel";
import { PanelBoundary } from "./PanelBoundary";
import { BUILTIN_PROJECTS, fetchSavedProjects, ProjectsMenu, UnsavedChangesDialog, type OpenTarget } from "./ProjectsMenu";
import { LeftToolOptionsPane, type ExportBundlePreviewData } from "./LeftToolOptionsPane";
import { StudioViewport } from "./StudioViewport";
import { TimelinePanel, type TimelineView } from "./TimelinePanel";
import { UserManualModal } from "./UserManualModal";

/* ── Icons (SF Symbols-style line icons, 1.75 stroke on a 24 grid) ─────────────────────────── */

const ICON_PATHS: Record<string, ReactNode> = {
  import: (
    <>
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      <path d="M12 10v6" />
      <path d="m9 13 3-3 3 3" />
    </>
  ),
  auto: (
    <>
      <path d="m15 4-1 1 6 6 1-1a2.83 2.83 0 1 0-4-4Z" />
      <path d="m13 6-9.5 9.5a2.12 2.12 0 1 0 3 3L16 9" />
      <path d="M6 2v3M4.5 3.5h3M20 15v3M18.5 16.5h3" />
    </>
  ),
  animate: (
    <>
      <path d="m5 9-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3" />
      <path d="M2 12h20M12 2v20" />
    </>
  ),
  rig: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8.12 8.12 15.88 15.88" />
    </>
  ),
  mesh: (
    <>
      <path d="M12 2 2 19h20L12 2Z" />
      <path d="M12 2v17M7 11h10" />
    </>
  ),
  weights: (
    <>
      <path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z" />
      <path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7" />
    </>
  ),
  liquify: (
    <>
      <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    </>
  ),
  export: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5M12 22V12" />
    </>
  ),
  copilot: (
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
  ),
  undo: (
    <>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </>
  ),
  redo: (
    <>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
    </>
  ),
  sidebarLeft: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9 4v16" />
    </>
  ),
  sidebarRight: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M15 4v16" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.39-1.61" />
      <path d="m2 2 20 20" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
    </>
  ),
  play: <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
    </>
  ),
  keys: (
    <>
      <path d="M3 6h18M3 12h18M3 18h18" opacity="0.35" />
      <path d="m8 4 2 2-2 2-2-2 2-2ZM15 10l2 2-2 2-2-2 2-2ZM11 16l2 2-2 2-2-2 2-2Z" fill="currentColor" />
    </>
  ),
  chevronUp: <path d="m6 15 6-6 6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  check: <path d="M5 12.5 10 17.5 19 7" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* ── Tool and view definitions ─────────────────────────────────────────────────────────────── */

type ToolDef = { id: StudioMode; label: string; key: string };

/** Tools grouped by workflow stage, top to bottom: set up → build the rig → animate → ship. */
const TOOL_GROUPS: ToolDef[][] = [
  [
    { id: "import", label: "Import", key: "O" },
    { id: "auto", label: "Auto Rig", key: "A" },
  ],
  [
    { id: "rig", label: "Bones & IK", key: "P" },
    { id: "mesh", label: "Mesh", key: "M" },
    { id: "weights", label: "Weight Paint", key: "B" },
  ],
  [
    { id: "animate", label: "Pose", key: "V" },
    { id: "liquify", label: "Warp", key: "W" },
  ],
  [{ id: "export", label: "Export", key: "E" }],
];

const TOOL_LABEL: Record<StudioMode, string> = Object.fromEntries(
  TOOL_GROUPS.flat().map((t) => [t.id, t.label]),
) as Record<StudioMode, string>;

type OverlayKey =
  | "showBones"
  | "showMeshWireframe"
  | "showHeatmap"
  | "showOnionSkin"
  | "showMotionArcs"
  | "showSlashTrail"
  | "enable3DRelight"
  | "showHitboxes"
  | "showSlotStage"
  | "isolatePart";

const VIEW_GROUPS: { title: string; items: { key: OverlayKey; label: string }[] }[] = [
  {
    title: "Rig",
    items: [
      { key: "showBones", label: "Bones" },
      { key: "showMeshWireframe", label: "Mesh Wireframe" },
      { key: "showHeatmap", label: "Weight Heatmap" },
      { key: "isolatePart", label: "Solo Selected Layer" },
    ],
  },
  {
    title: "Motion",
    items: [
      { key: "showOnionSkin", label: "Onion Skin" },
      { key: "showMotionArcs", label: "Motion Arcs" },
      { key: "showSlashTrail", label: "Weapon Trail" },
    ],
  },
  {
    title: "Stage",
    items: [
      { key: "showSlotStage", label: "Slot Reels" },
      { key: "showHitboxes", label: "Hitboxes" },
      { key: "enable3DRelight", label: "Normal-Map Lighting" },
    ],
  },
];

/* ── Small building blocks ─────────────────────────────────────────────────────────────────── */

/** Closes a popover when the user clicks anywhere outside it or presses Escape. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function MenuRow({
  label,
  checked,
  onClick,
  trailing,
}: {
  label: string;
  checked?: boolean;
  onClick: () => void;
  trailing?: ReactNode;
}) {
  return (
    <button
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="w-full flex items-center gap-2 h-7 px-2 rounded-[6px] text-[13px] text-left text-[var(--label)] hover:bg-[var(--accent)] hover:text-white transition-colors"
    >
      <span className="w-4 shrink-0 grid place-items-center">{checked ? <Icon name="check" size={14} /> : null}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

/** True only for fields that take typed text; sliders and checkboxes must not swallow shortcuts. */
function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) return true;
  if (el.tagName !== "INPUT") return false;
  return !["range", "checkbox", "radio", "button", "color"].includes((el as HTMLInputElement).type);
}

/* ── Studio shell ──────────────────────────────────────────────────────────────────────────── */

export function StudioApp() {
  const store = useStudioStore();
  const {
    project,
    mode,
    selectedBone,
    selectedPart,
    activeClip,
    currentTime,
    isPlaying,
    playbackSpeed,
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
    addAnimationEventAtCurrentTime,
    deleteAnimationEvent,
    bakeCurrentClipSprings,
    copyPose,
    pastePose,
    editActiveClip,
  } = store;

  // Layout state. Copilot starts closed: the canvas is the content, panels are opt-in.
  const [leftPaneOpen, setLeftPaneOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [showAiCopilot, setShowAiCopilot] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<"layers" | "bones" | "history" | "budget">("layers");
  const [dopeSheetExpanded, setDopeSheetExpanded] = useState(false);
  const [timelineView, setTimelineView] = useState<TimelineView>("keys");
  const [eventType, setEventType] = useState("OnHit");
  const [newBoneName, setNewBoneName] = useState("");
  const [exportData, setExportData] = useState<ExportBundlePreviewData | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [showUserManual, setShowUserManual] = useState(false);
  const [saveState, setSaveState] = useState<{ label: string; tone: "idle" | "busy" | "ok" | "local" }>({
    label: "Built-in template",
    tone: "ok",
  });
  // The project as it was last saved or opened. Edits create new project objects, so identity
  // tells us whether there are unsaved changes (and undoing back to the saved state clears it).
  const savedRef = useRef<SpineForgeProject | null>(null);
  const [savedProject, setSavedProject] = useState<SpineForgeProject | null>(null);
  const markSaved = (p: SpineForgeProject) => {
    savedRef.current = p;
    setSavedProject(p);
  };
  const [autosavedAt, setAutosavedAt] = useState<string | null>(null);
  const [pendingOpen, setPendingOpen] = useState<OpenTarget | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const projectsMenu = usePopover();

  const viewMenu = usePopover();
  const transportMenu = usePopover();

  const currentBoneObj = project.bones.find((b) => b.name === selectedBone) ?? project.bones[0]!;
  const currentClipObj = project.animations[activeClip];
  const clipDuration = currentClipObj?.duration ?? 2.4;

  /* ── Autosave: every 5 minutes when something changed, plus on tab hide, unload and errors ── */
  const AUTOSAVE_KEY = "kinetic-pro:autosave";
  const lastAutosaved = useRef<SpineForgeProject | null>(null);
  const [recovery, setRecovery] = useState<{ savedAt: number; project: SpineForgeProject } | null>(null);

  const autosave = (reason: string) => {
    const current = useStudioStore.getState().project;
    if (current === lastAutosaved.current) return;
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ savedAt: Date.now(), reason, project: current }));
      lastAutosaved.current = current;
      setAutosavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    } catch {
      setSaveState({ label: "Autosave failed: browser storage full", tone: "local" });
    }
  };

  useEffect(() => {
    // Offer to restore work from a previous session that ended without a save.
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { savedAt: number; project: SpineForgeProject };
        if (saved?.project?.bones?.length && Date.now() - saved.savedAt < 14 * 24 * 3600 * 1000) setRecovery(saved);
      }
    } catch {
      localStorage.removeItem(AUTOSAVE_KEY);
    }
    lastAutosaved.current = useStudioStore.getState().project; // nothing to save until the user changes something
    markSaved(useStudioStore.getState().project);
    const interval = window.setInterval(() => autosave("interval"), 5 * 60 * 1000);
    const onHide = () => document.visibilityState === "hidden" && autosave("hidden");
    const onUnload = () => autosave("unload");
    const onCrash = () => autosave("error");
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("error", onCrash);
    window.addEventListener("unhandledrejection", onCrash);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("error", onCrash);
      window.removeEventListener("unhandledrejection", onCrash);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreAutosave = () => {
    if (!recovery) return;
    const p = recovery.project;
    store.openProject(p, "Restored autosave");
    lastAutosaved.current = p;
    setRecovery(null); // stays marked as edited: the restored work may not be on disk
  };

  const cueCount = useMemo(() => reviewClip(project, activeClip).length, [project, activeClip]);

  /** Saves into projects/<id>/. Uses the latest store state so copilot chains save what they just changed. */
  const handleSaveProject = async (): Promise<boolean> => {
    const current = useStudioStore.getState().project;
    autosave("save");
    setSaveState({ label: "Saving…", tone: "busy" });
    // Drop the old per-project browser copies (never read back) so they cannot fill the storage quota.
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith("kinetic-pro:") && key !== AUTOSAVE_KEY) localStorage.removeItem(key);
    } catch {
      // Storage blocked; the disk save below still runs.
    }
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: current }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setSaveState({ label: `Not saved: ${data.error ?? `error ${res.status}`}`, tone: "local" });
        return false;
      }
      markSaved(current);
      setSaveState({ label: `Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, tone: "ok" });
      return true;
    } catch {
      setSaveState({ label: "Not saved: studio server unreachable (browser autosave kept)", tone: "local" });
      return false;
    }
  };

  /** Replaces the open document. Callers check for unsaved changes first (requestOpen). */
  const performOpen = async (target: OpenTarget): Promise<void> => {
    if (target.kind === "preset") {
      useStudioStore.getState().loadPreset(target.id);
    } else {
      const res = await fetch(`/api/projects/${encodeURIComponent(target.id)}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { project?: SpineForgeProject; error?: string };
      if (!res.ok || !data.project) throw new Error(data.error ?? `Could not open ${target.title}`);
      store.openProject(data.project, `Opened ${data.project.title}`);
    }
    const opened = useStudioStore.getState().project;
    markSaved(opened);
    lastAutosaved.current = opened;
    setExportData(null); // the export preview belonged to the previous project
    setSaveState({ label: target.kind === "preset" ? "Built-in template" : "Opened from projects", tone: "ok" });
  };

  /** Opens `target`, or asks to save first when the current project has unsaved changes. */
  const requestOpen = async (target: OpenTarget): Promise<"opened" | "confirm"> => {
    if (useStudioStore.getState().project !== savedRef.current) {
      setPendingError(null);
      setPendingOpen(target);
      return "confirm";
    }
    await performOpen(target);
    return "opened";
  };

  const resolvePending = async (save: boolean) => {
    if (!pendingOpen) return;
    setPendingBusy(true);
    setPendingError(null);
    try {
      if (save && !(await handleSaveProject())) {
        setPendingError("Couldn’t save, so nothing was closed. The message under the title says why.");
        return;
      }
      await performOpen(pendingOpen);
      setPendingOpen(null);
    } catch (err) {
      setPendingError(err instanceof Error ? err.message : "Could not open the project");
    } finally {
      setPendingBusy(false);
    }
  };

  /** Copilot entry point: opens by partial name, saved projects first, then templates. */
  const openProjectByName = async (name?: string): Promise<string> => {
    if (!name) {
      projectsMenu.setOpen(true);
      return "Showing projects";
    }
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const saved = await fetchSavedProjects();
    const targets: OpenTarget[] = [
      ...saved.filter((p) => !p.damaged).map((p) => ({ kind: "saved" as const, id: p.id, title: p.title })),
      ...BUILTIN_PROJECTS,
    ];
    const q = norm(name);
    const match =
      targets.find((t) => norm(t.id) === q || norm(t.title) === q) ??
      targets.find((t) => norm(t.id).includes(q) || norm(t.title).includes(q));
    if (!match) throw new Error(`No project matches “${name}”`);
    const result = await requestOpen(match);
    return result === "confirm" ? `Save or discard your changes to open ${match.title}` : `Opened ${match.title}${match.kind === "preset" ? " (template)" : ""}`;
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
      setExportData(res.ok ? await res.json() : await buildBrowserUnityExportBundle(project));
    } catch {
      setExportData(await buildBrowserUnityExportBundle(project));
    } finally {
      setIsExporting(false);
    }
  };

  // Selecting the active tool again hides its options; selecting another tool opens them.
  const handleSelectTool = (targetMode: StudioMode) => {
    if (targetMode === "auto") runOneClickAutoRig();
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveProject();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "v")) {
        if (isTextEntry(e.target) || window.getSelection()?.toString()) return;
        e.preventDefault();
        if (e.key.toLowerCase() === "c") copyPose();
        else pastePose();
        return;
      }
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        projectsMenu.setOpen(true);
        return;
      }
      if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        void handleRunExport();
        return;
      }
      if (mod || e.altKey) return;
      if (isTextEntry(e.target)) return;

      const key = e.key.toLowerCase();
      const tool = TOOL_GROUPS.flat().find((t) => t.key.toLowerCase() === key);
      if (tool) {
        handleSelectTool(tool.id);
        return;
      }
      if (key === "s") {
        // Key the selected bone (⇧ every bone) at the playhead; eased segments are split so motion is unchanged.
        const bones = e.shiftKey ? project.bones.map((b) => b.name) : selectedBone ? [selectedBone] : [];
        const t = Number(currentTime.toFixed(4));
        editActiveClip((c) => {
          const boneTracks = { ...c.boneTracks };
          for (const b of bones) {
            boneTracks[b] = keyPreservingShape(boneTracks[b] ?? [], t);
          }
          return { ...c, boneTracks };
        }, e.shiftKey ? `Keyed all bones @ ${t.toFixed(2)}s` : `Keyed ${selectedBone} @ ${t.toFixed(2)}s`);
      } else if (e.code === "Comma" || e.code === "Period") {
        // Jump to the previous / next key of the selected bone (⇧ any bone).
        const bones = e.shiftKey ? project.bones.map((b) => b.name) : selectedBone ? [selectedBone] : [];
        const times = [...new Set(bones.flatMap((b) => (currentClipObj?.boneTracks[b] ?? []).map((k) => k.time)))].sort((a, b) => a - b);
        const target =
          e.code === "Period" ? times.find((t) => t > currentTime + 1e-4) : [...times].reverse().find((t) => t < currentTime - 1e-4);
        if (target !== undefined) {
          setIsPlaying(false);
          setCurrentTime(target);
        }
      } else if (key === "c") setShowAiCopilot((v) => !v);
      else if (key === "l" || key === "i") setInspectorOpen((v) => !v);
      else if (key === "k" || key === "g") {
        const view: TimelineView = key === "g" ? "curves" : "keys";
        if (dopeSheetExpanded && timelineView === view) setDopeSheetExpanded(false);
        else {
          setTimelineView(view);
          setDopeSheetExpanded(true);
        }
      }
      else if (e.key === "Tab") {
        e.preventDefault();
        const anyOpen = leftPaneOpen || inspectorOpen || showAiCopilot;
        setLeftPaneOpen(!anyOpen);
        setInspectorOpen(!anyOpen);
        if (anyOpen) setShowAiCopilot(false);
      } else if (e.key === "[") setBrushRadius(Math.max(15, brushRadius - 10));
      else if (e.key === "]") setBrushRadius(Math.min(180, brushRadius + 10));
      else if (e.key === "?" || e.key === "/") setShowUserManual((v) => !v);
      else if (e.key === "Escape") setShowUserManual(false);
      else if (e.key === " ") {
        e.preventDefault();
        setIsPlaying(!isPlaying);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Step one frame at the clip's frame rate (and stop a focused slider from also moving).
        e.preventDefault();
        const fps = currentClipObj?.fps ?? 24;
        const next = currentTime + (e.key === "ArrowRight" ? 1 : -1) / fps;
        setIsPlaying(false);
        setCurrentTime(Math.max(0, Math.min(clipDuration, Number(next.toFixed(4)))));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushRadius, isPlaying, leftPaneOpen, inspectorOpen, showAiCopilot, mode, project, redo, undo, currentTime, clipDuration, dopeSheetExpanded, timelineView]);

  const handleDownloadZip = () => {
    if (!exportData?.zipBase64) return;
    const bytes = Uint8Array.from(atob(exportData.zipBase64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
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
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.id}-${activeClip}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };
    recorder.start();
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, Math.round(clipDuration * 1000));
  };

  const reversedLayers = [...project.parts].reverse();
  const overlayState = store as unknown as Record<OverlayKey, boolean>;
  const activeOverlayCount = VIEW_GROUPS.flatMap((g) => g.items).filter((i) => overlayState[i.key]).length;
  const dirty = savedProject !== null && project !== savedProject;
  const status =
    saveState.tone === "busy"
      ? { dot: "#0a84ff", label: "Saving…" }
      : saveState.tone === "local"
        ? { dot: "#ff453a", label: saveState.label }
        : dirty
          ? { dot: "#ff9f0a", label: autosavedAt ? `Edited · autosaved ${autosavedAt}` : "Edited" }
          : { dot: "#30d158", label: saveState.label };

  return (
    <div className="relative h-screen w-screen overflow-hidden select-none">
      {/* The canvas fills the window; every panel floats above it. */}
      <PanelBoundary name="Canvas" onError={() => autosave("error")} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
        <StudioViewport />
      </PanelBoundary>

      <div className="fixed inset-0 z-20 pointer-events-none flex flex-col gap-2 p-2.5">
        {/* ── Toolbar ─────────────────────────────────────────────────────────── */}
        <header className="relative z-30 pointer-events-auto material rounded-[var(--radius-panel)] h-12 px-2 flex items-center gap-1 shrink-0">
          <div className="flex items-center gap-1 w-[260px] shrink-0">
            <div className="h-7 w-7 rounded-[8px] grid place-items-center bg-gradient-to-b from-[#3d9bff] to-[#0062cc] text-white text-[13px] font-bold ml-1 mr-2 shadow-sm">
              K
            </div>
            <button
              className="icon-btn"
              aria-pressed={leftPaneOpen}
              onClick={() => setLeftPaneOpen((v) => !v)}
              data-tip="Tool Options"
              data-tip-side="bottom"
              aria-label="Toggle tool options"
            >
              <Icon name="sidebarLeft" size={17} />
            </button>
            <span className="w-px h-5 bg-[var(--separator-strong)] mx-1" />
            <button className="icon-btn" onClick={undo} disabled={historyIndex <= 0} data-tip="Undo  ⌘Z" data-tip-side="bottom" aria-label="Undo">
              <Icon name="undo" />
            </button>
            <button
              className="icon-btn"
              onClick={redo}
              disabled={historyIndex >= history.length - 1}
              data-tip="Redo  ⇧⌘Z"
              data-tip-side="bottom"
              aria-label="Redo"
            >
              <Icon name="redo" />
            </button>
          </div>

          {/* Document title, centered like a macOS document window. */}
          <div className="relative flex-1 min-w-0 flex flex-col items-center justify-center leading-tight" ref={projectsMenu.ref}>
            <button
              onClick={() => projectsMenu.setOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={projectsMenu.open}
              aria-pressed={projectsMenu.open}
              aria-label={`Project: ${project.title}`}
              className="flex items-center gap-1 max-w-full rounded-[6px] px-1.5 -mb-px text-[13px] font-semibold text-[var(--label)] hover:bg-[var(--fill-3)] transition-colors"
              data-tip="Open project  ⌘O"
              data-tip-side="bottom"
            >
              <span className="truncate">{project.title}</span>
              <span className="text-[var(--label-3)] shrink-0">
                <Icon name="chevronDown" size={12} />
              </span>
            </button>
            <button
              onClick={() => void handleSaveProject()}
              className="flex items-center gap-1.5 max-w-full text-[11px] text-[var(--label-2)] hover:text-[var(--label)] transition-colors"
              data-tip="Save to projects  ⌘S"
              data-tip-side="bottom"
              aria-label={`Save. ${status.label}`}
            >
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: status.dot }} />
              <span className="truncate">
                {TOOL_LABEL[mode]} · {status.label}
              </span>
            </button>
            {projectsMenu.open && (
              <ProjectsMenu
                currentId={project.id}
                onOpen={async (target) => {
                  try {
                    await requestOpen(target);
                    projectsMenu.setOpen(false);
                    return null;
                  } catch (err) {
                    return err instanceof Error ? err.message : "Could not open the project";
                  }
                }}
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-1 w-[260px] shrink-0">
            <div className="relative" ref={viewMenu.ref}>
              <button
                className="icon-btn w-auto px-2 gap-1.5 text-[13px]"
                aria-pressed={viewMenu.open}
                aria-haspopup="menu"
                onClick={() => viewMenu.setOpen((v) => !v)}
                data-tip="Viewport overlays"
                data-tip-side="bottom"
              >
                <Icon name="eye" />
                <span className="tabular-nums text-[12px]">{activeOverlayCount}</span>
              </button>
              {viewMenu.open && (
                <div
                  role="menu"
                  className="absolute right-0 top-[calc(100%+6px)] w-60 material-thick rounded-[12px] p-1.5 animate-panel-in"
                >
                  {VIEW_GROUPS.map((group, gi) => (
                    <div key={group.title}>
                      {gi > 0 && <div className="h-px bg-[var(--separator)] my-1 mx-2" />}
                      <div className="px-2 pt-1 pb-0.5 text-[11px] font-semibold text-[var(--label-3)]">{group.title}</div>
                      {group.items.map((item) => (
                        <MenuRow
                          key={item.key}
                          label={item.label}
                          checked={overlayState[item.key]}
                          onClick={() => toggleOverlay(item.key)}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              className="icon-btn relative"
              aria-pressed={showAiCopilot}
              onClick={() => setShowAiCopilot((v) => !v)}
              data-tip="Copilot  C"
              data-tip-side="bottom"
              aria-label={`Toggle AI copilot${cueCount ? `, ${cueCount} suggestions` : ""}`}
            >
              <Icon name="copilot" />
              {cueCount > 0 && !showAiCopilot && (
                <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[#ff9f0a] text-[10px] font-semibold text-black grid place-items-center tabular-nums">
                  {cueCount}
                </span>
              )}
            </button>
            <button
              className="icon-btn"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen((v) => !v)}
              data-tip="Inspector  I"
              data-tip-side="bottom"
              aria-label="Toggle inspector"
            >
              <Icon name="sidebarRight" size={17} />
            </button>
            <button
              className="icon-btn"
              aria-pressed={showUserManual}
              onClick={() => setShowUserManual((v) => !v)}
              data-tip="Help  ?"
              data-tip-side="bottom"
              aria-label="Help"
            >
              <Icon name="help" />
            </button>
            <button
              onClick={() => void handleRunExport()}
              disabled={isExporting}
              className="btn-primary h-8 px-4 ml-1 text-[13px]"
              data-tip="Export bundle  ⌘E"
              data-tip-side="bottom"
            >
              {isExporting ? "Exporting…" : "Export"}
            </button>
          </div>
        </header>

        {/* ── Work area ──────────────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 flex items-stretch gap-2">
          {/* Tool rail: grouped by workflow stage, labels on hover. */}
          <nav
            aria-label="Tools"
            className="pointer-events-auto material rounded-[var(--radius-panel)] w-12 py-2 flex flex-col items-center gap-1 shrink-0 self-start"
          >
            {TOOL_GROUPS.map((group, gi) => (
              <div key={gi} className="flex flex-col items-center gap-1">
                {gi > 0 && <span className="w-6 h-px bg-[var(--separator-strong)] my-1" />}
                {group.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => handleSelectTool(tool.id)}
                    className="icon-btn h-9 w-9"
                    aria-pressed={mode === tool.id}
                    aria-label={tool.label}
                    data-tip={`${tool.label}  ${tool.key}`}
                    data-tip-side="right"
                  >
                    <Icon name={tool.id} size={18} />
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {leftPaneOpen && (
            <div className="flex flex-col min-h-0 animate-panel-in">
              <PanelBoundary name="Tool options" onError={() => autosave("error")}>
                <LeftToolOptionsPane
                  onShipToUnity={handleRunExport}
                  onHidePane={() => setLeftPaneOpen(false)}
                  exportData={exportData}
                  isExporting={isExporting}
                  onDownloadZip={handleDownloadZip}
                  onExportWebM={handleExportTransparentWebM}
                />
              </PanelBoundary>
            </div>
          )}

          <div className="flex-1" />

          {/* Inspector */}
          {inspectorOpen && (
            <aside
              aria-label="Inspector"
              className="pointer-events-auto material rounded-[var(--radius-panel)] w-[300px] flex flex-col min-h-0 shrink-0 animate-panel-in"
            >
              <div className="p-2.5 shrink-0">
                <div className="segmented" role="tablist">
                  {(
                    [
                      ["layers", "Layers"],
                      ["bones", "Bones"],
                      ["history", "History"],
                      ["budget", "Budget"],
                    ] as const
                  ).map(([id, label]) => (
                    <button key={id} role="tab" aria-pressed={inspectorTab === id} onClick={() => setInspectorTab(id)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex-1 min-h-0 flex flex-col px-2.5 pb-2.5">
                {inspectorTab === "layers" && (
                  <ul className="flex-1 overflow-y-auto space-y-0.5">
                    {reversedLayers.map((part) => {
                      const isSelected = part.name === selectedPart;
                      const isHidden = hiddenParts.includes(part.name);
                      const isSkinned = Boolean(part.skin && part.skin.length > 1);
                      const vCount = part.mesh ? part.mesh.positions.length / 2 : 4;
                      return (
                        <li
                          key={part.name}
                          onClick={() => selectPart(part.name)}
                          className={`group flex items-center gap-2 min-h-11 py-1.5 px-2 rounded-[8px] cursor-default transition-colors ${
                            isSelected ? "bg-[var(--accent)] text-white" : "hover:bg-[var(--fill-3)]"
                          } ${isHidden ? "opacity-50" : ""}`}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePartVisibility(part.name);
                            }}
                            aria-label={isHidden ? `Show ${part.name}` : `Hide ${part.name}`}
                            className={`h-6 w-6 grid place-items-center rounded-[6px] shrink-0 ${
                              isSelected ? "text-white/90" : "text-[var(--label-2)]"
                            } hover:bg-white/10`}
                          >
                            <Icon name={isHidden ? "eyeOff" : "eye"} size={14} />
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] leading-tight truncate">{part.name}</div>
                            <div className={`text-[11px] leading-tight mt-0.5 truncate ${isSelected ? "text-white/70" : "text-[var(--label-3)]"}`}>
                              {isSkinned ? `Mesh · ${vCount} verts · ${part.skin!.length} bones` : `Rigid · ${part.bone}`}
                            </div>
                          </div>
                          <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                movePartLayerOrder(part.name, "up");
                              }}
                              aria-label="Bring forward"
                              className="h-6 w-6 grid place-items-center rounded-[6px] hover:bg-white/10"
                            >
                              <Icon name="chevronUp" size={14} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                movePartLayerOrder(part.name, "down");
                              }}
                              aria-label="Send backward"
                              className="h-6 w-6 grid place-items-center rounded-[6px] hover:bg-white/10"
                            >
                              <Icon name="chevronDown" size={14} />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {inspectorTab === "bones" && (
                  <>
                    <ul className="flex-1 overflow-y-auto space-y-0.5">
                      {project.bones.map((bone, idx) => {
                        const isSelected = bone.name === selectedBone;
                        const isLocked = lockedBones.includes(bone.name);
                        const col = bone.color ?? RIG_BONE_PALETTE[idx % RIG_BONE_PALETTE.length];
                        return (
                          <li
                            key={bone.name}
                            onClick={() => selectBone(bone.name)}
                            className={`group flex items-center gap-2 h-8 px-2 rounded-[8px] cursor-default transition-colors ${
                              isSelected ? "bg-[var(--accent)] text-white" : "hover:bg-[var(--fill-3)]"
                            }`}
                          >
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: col }} />
                            <span className="text-[13px] truncate flex-1">{bone.name}</span>
                            {bone.spring && (
                              <span className={`text-[11px] ${isSelected ? "text-white/75" : "text-[var(--label-3)]"}`}>Physics</span>
                            )}
                            {bone.follow && (
                              <span className={`text-[11px] ${isSelected ? "text-white/75" : "text-[var(--label-3)]"}`}>Follow</span>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleBoneLock(bone.name);
                              }}
                              aria-label={isLocked ? `Unlock ${bone.name}` : `Lock ${bone.name}`}
                              className={`h-6 w-6 grid place-items-center rounded-[6px] hover:bg-white/10 ${
                                isLocked ? (isSelected ? "text-white" : "text-[#ff9f0a]") : "opacity-0 group-hover:opacity-100"
                              }`}
                            >
                              <Icon name={isLocked ? "lock" : "unlock"} size={13} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <form
                      className="mt-2 pt-2 border-t border-[var(--separator)] flex gap-1.5 shrink-0"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!newBoneName.trim()) return;
                        addBone(
                          currentBoneObj.name,
                          newBoneName,
                          Math.min(0.95, currentBoneObj.x + 0.05),
                          Math.max(0.05, currentBoneObj.y - 0.08),
                        );
                        setNewBoneName("");
                      }}
                    >
                      <input
                        type="text"
                        placeholder={`New bone under ${currentBoneObj.name}`}
                        value={newBoneName}
                        onChange={(e) => setNewBoneName(e.target.value)}
                        className="flex-1 min-w-0 h-7 rounded-[6px] bg-[var(--fill-3)] border border-[var(--separator)] px-2 text-[12px] placeholder:text-[var(--label-3)] focus:outline-none focus:border-[var(--accent)]"
                      />
                      <button type="submit" className="icon-btn h-7 w-7" aria-label="Add bone" disabled={!newBoneName.trim()}>
                        <Icon name="plus" size={15} />
                      </button>
                    </form>
                  </>
                )}

                {inspectorTab === "history" && (
                  <ul className="flex-1 overflow-y-auto space-y-0.5">
                    {history.map((snap, idx) => {
                      const isCurrent = idx === historyIndex;
                      const isFuture = idx > historyIndex;
                      return (
                        <li
                          key={snap.id}
                          onClick={() => jumpToHistory(idx)}
                          className={`flex items-center justify-between gap-2 h-8 px-2 rounded-[8px] cursor-default transition-colors ${
                            isCurrent ? "bg-[var(--accent)] text-white" : "hover:bg-[var(--fill-3)]"
                          } ${isFuture ? "opacity-40" : ""}`}
                        >
                          <span className="text-[13px] truncate">{snap.label}</span>
                          <span className={`text-[11px] tabular-nums shrink-0 ${isCurrent ? "text-white/70" : "text-[var(--label-3)]"}`}>
                            {snap.timestamp}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {inspectorTab === "budget" && (
                  <PanelBoundary name="Budget" onError={() => autosave("error")}>
                    <BudgetPanel />
                  </PanelBoundary>
                )}
              </div>
            </aside>
          )}
        </div>

        {/* ── Transport & timeline ───────────────────────────────────────────── */}
        <footer
          className={`relative z-20 pointer-events-auto ${dopeSheetExpanded ? "material-thick" : "material"} rounded-[var(--radius-panel)] flex flex-col shrink-0 transition-[height] duration-300 ${
            dopeSheetExpanded ? (timelineView === "curves" ? "h-[380px]" : "h-[300px]") : "h-12"
          }`}
        >
          <div className="h-12 px-2 flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className="h-8 w-8 grid place-items-center rounded-full bg-[var(--fill)] hover:bg-[var(--fill)]/80 text-[var(--label)] transition-colors"
              aria-label={isPlaying ? "Pause" : "Play"}
              data-tip={isPlaying ? "Pause  Space" : "Play  Space"}
              data-tip-side="top"
            >
              <Icon name={isPlaying ? "pause" : "play"} size={14} />
            </button>

            <select
              value={activeClip}
              onChange={(e) => setActiveClip(e.target.value)}
              aria-label="Animation clip"
              className="h-7 max-w-[180px] rounded-[6px] bg-[var(--fill-3)] border border-[var(--separator)] px-2 text-[12px] font-medium text-[var(--label)] focus:outline-none"
            >
              {Object.keys(project.animations).map((clipName) => (
                <option key={clipName} value={clipName}>
                  {clipName}
                </option>
              ))}
            </select>

            {/* Scrubber with event markers */}
            <div className="relative flex-1 min-w-[120px] flex items-center px-1">
              <input
                type="range"
                min={0}
                max={clipDuration}
                step={0.001}
                value={currentTime}
                aria-label="Playhead"
                onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentTime(parseFloat(e.target.value));
                }}
                className="w-full cursor-pointer"
              />
              {(currentClipObj?.events ?? []).map((ev, idx) => {
                const pct = Math.max(0, Math.min(100, (ev.time / clipDuration) * 100));
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
                    data-tip={`${ev.name} · ${ev.time.toFixed(2)}s · right-click to remove`}
                    data-tip-side="top"
                    style={{ left: `${pct}%` }}
                    className="absolute top-0 -translate-x-1/2 h-2 w-2 rotate-45 rounded-[1px] bg-[#ff9f0a] hover:scale-125 transition-transform"
                    aria-label={`Event ${ev.name}`}
                  />
                );
              })}
            </div>

            <span className="text-[12px] tabular-nums text-[var(--label-2)] whitespace-nowrap w-[92px] text-right">
              <span className="text-[var(--label)]">{currentTime.toFixed(2)}</span> / {clipDuration.toFixed(2)} s
            </span>

            <div className="segmented shrink-0" role="group" aria-label="Playback speed">
              {[0.25, 0.5, 1].map((s) => (
                <button key={s} aria-pressed={playbackSpeed === s} onClick={() => setPlaybackSpeed(s)}>
                  {s === 1 ? "1×" : `${s}×`}
                </button>
              ))}
            </div>

            <button
              className="icon-btn"
              aria-pressed={dopeSheetExpanded}
              onClick={() => setDopeSheetExpanded(!dopeSheetExpanded)}
              data-tip="Timeline  K · Curves  G"
              data-tip-side="top"
              aria-label="Toggle keyframe sheet"
            >
              <Icon name="keys" size={17} />
            </button>

            <div className="relative" ref={transportMenu.ref}>
              <button
                className="icon-btn"
                aria-pressed={transportMenu.open}
                aria-haspopup="menu"
                onClick={() => transportMenu.setOpen((v) => !v)}
                data-tip="More"
                data-tip-side="top"
                aria-label="More timeline actions"
              >
                <Icon name="more" size={17} />
              </button>
              {transportMenu.open && (
                <div role="menu" className="absolute right-0 bottom-[calc(100%+8px)] w-64 material-thick rounded-[12px] p-1.5 animate-panel-in">
                  <div className="px-2 pt-1 pb-1 text-[11px] font-semibold text-[var(--label-3)]">Add event at playhead</div>
                  <div className="flex gap-1.5 px-1 pb-1.5">
                    <select
                      value={eventType}
                      onChange={(e) => setEventType(e.target.value)}
                      aria-label="Event type"
                      className="flex-1 h-7 rounded-[6px] bg-[var(--fill-3)] border border-[var(--separator)] px-2 text-[12px]"
                    >
                      <option value="OnHit">OnHit</option>
                      <option value="SpawnVFX">SpawnVFX</option>
                      <option value="PlaySFX">PlaySFX</option>
                      <option value="CameraShake">CameraShake</option>
                    </select>
                    <button
                      className="btn-primary h-7 px-3 text-[12px]"
                      onClick={() => {
                        addAnimationEventAtCurrentTime(eventType, `fx_${activeClip}_${eventType.toLowerCase()}`, 1.0);
                        transportMenu.setOpen(false);
                      }}
                    >
                      Add
                    </button>
                  </div>
                  <div className="h-px bg-[var(--separator)] my-1 mx-2" />
                  <MenuRow
                    label="Bake physics into keys"
                    onClick={() => {
                      bakeCurrentClipSprings();
                      transportMenu.setOpen(false);
                    }}
                  />
                  <MenuRow label="1.5× playback" checked={playbackSpeed === 1.5} onClick={() => setPlaybackSpeed(1.5)} />
                </div>
              )}
            </div>
          </div>

          {dopeSheetExpanded && (
            <PanelBoundary name="Timeline" onError={() => autosave("error")} className="m-2">
              <TimelinePanel view={timelineView} onViewChange={setTimelineView} />
            </PanelBoundary>
          )}
        </footer>
      </div>

      {/* Copilot floats above the canvas (z-15) but under the toolbar menus (panel layer is z-20). */}
      {showAiCopilot && (
        <div
          className={`fixed z-[15] ${inspectorOpen ? "right-[318px]" : "right-2.5"} ${!dopeSheetExpanded ? "bottom-[66px] h-[min(560px,calc(100vh-140px))]" : timelineView === "curves" ? "bottom-[398px] h-[min(480px,calc(100vh-470px))]" : "bottom-[318px] h-[min(520px,calc(100vh-390px))]"} w-[360px] flex flex-col animate-panel-in`}
        >
          <PanelBoundary name="Copilot" onError={() => autosave("error")}>
            <AiAgentPanel
              onExport={handleRunExport}
              onSave={handleSaveProject}
              onOpenBudget={() => {
                setInspectorOpen(true);
                setInspectorTab("budget");
              }}
              onOpenProject={openProjectByName}
              onHidePane={() => setShowAiCopilot(false)}
            />
          </PanelBoundary>
        </div>
      )}

      {pendingOpen && (
        <UnsavedChangesDialog
          title={project.title}
          nextTitle={pendingOpen.title}
          error={pendingError}
          busy={pendingBusy}
          onSave={() => void resolvePending(true)}
          onDiscard={() => void resolvePending(false)}
          onCancel={() => setPendingOpen(null)}
        />
      )}

      {recovery && (
        <div role="status" className="fixed z-40 top-[64px] left-1/2 -translate-x-1/2 material-thick rounded-[12px] pl-4 pr-2 py-2 flex items-center gap-3 animate-panel-in">
          <span className="text-[13px]">
            Unsaved work from {new Date(recovery.savedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            <span className="text-[var(--label-2)]"> · {recovery.project.title}</span>
          </span>
          <button className="btn-primary h-7 px-3 text-[12px]" onClick={restoreAutosave}>
            Restore
          </button>
          <button
            className="icon-btn h-7 w-auto px-2.5 text-[12px]"
            onClick={() => {
              localStorage.removeItem(AUTOSAVE_KEY);
              setRecovery(null);
            }}
          >
            Discard
          </button>
        </div>
      )}

      <UserManualModal isOpen={showUserManual} onClose={() => setShowUserManual(false)} onTriggerExport={handleRunExport} />
    </div>
  );
}
