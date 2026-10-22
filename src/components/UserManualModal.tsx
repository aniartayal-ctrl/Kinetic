"use client";

import { useState } from "react";
import { useStudioStore } from "@/store/useStudioStore";

export function CanvasCoachPill({ onOpenManual }: { onOpenManual: () => void }) {
  const { mode, selectedBone, selectedPart, brushMode, liquifyMode, brushRadius } = useStudioStore();

  const coachMessage: Record<string, string> = {
    import: "Import PSD & Document Setup (O): Switch presets/skins, upload a layered .psd or flat .png, or pick any of the 8 Slot Symbols on the left.",
    auto: "1-Click Auto Studio (A): Pick any of the 14 Game Actions or 8 Slot Symbols on the left to auto-mesh, rig, infer physics & animate.",
    animate: `Pose Tool (V): Drag '${selectedBone}' on the canvas to rotate and auto-keyframe · Hold Shift (or drag root/IK) to move position.`,
    rig: `Bone Pin Tool (P): Drag '${selectedBone}' pivot on the canvas to adjust its rest bind position · Mesh weights update automatically.`,
    mesh: `Puppet Mesh (M): Choose Low / Medium / High Delaunay triangle density in the top bar for layer '${selectedPart}'.`,
    weights: `Weight Brush (B · ${brushMode.toUpperCase()} · ${brushRadius}px): Paint on '${selectedPart}' to bind vertices to bone '${selectedBone}' · Press [ or ] to resize.`,
    liquify: `Liquify FFD (W · ${liquifyMode.toUpperCase()} · ${brushRadius}px): Drag on '${selectedPart}' to sculpt per-vertex FFD offsets at the current frame.`,
    export: "Unity & Spine 4.2 Export: Inspect your packed atlas, .sfrig.json, Spine 4.2 JSON, or download the complete .ZIP / .WebM video.",
  };

  return (
    <div className="pointer-events-auto self-center mb-1 px-4 py-1.5 rounded-full liquid-glass flex items-center gap-3 text-[11px] text-slate-200 shadow-lg">
      <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#38bdf8] shrink-0" />
      <span className="truncate max-w-2xl">{coachMessage[mode] ?? coachMessage.auto}</span>
      <button
        onClick={onOpenManual}
        className="whitespace-nowrap shrink-0 px-2.5 py-0.5 rounded-full bg-sky-400/20 border border-sky-300/40 text-sky-200 font-semibold hover:bg-sky-400/35 transition"
      >
        ? User Manual & Tour
      </button>
    </div>
  );
}

export function UserManualModal({
  isOpen,
  onClose,
  onTriggerExport,
}: {
  isOpen: boolean;
  onClose: () => void;
  onTriggerExport: () => Promise<void>;
}) {
  const {
    setMode,
    runOneClickAutoRig,
    runAutoModeSelectAction,
    setSlotStageMode,
    loadSymbolRig,
    setActiveVfx,
  } = useStudioStore();

  const [activeTab, setActiveTab] = useState<"quickstart" | "tools" | "slot_suite" | "unity">("quickstart");

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xl flex items-center justify-center p-6 select-text">
      <div className="max-w-4xl w-full max-h-[88vh] rounded-[32px] liquid-glass p-6 flex flex-col gap-5 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-white/15 pb-4 shrink-0">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-300">
              Interactive User Manual & Guided Tour
            </span>
            <h2 className="text-xl font-bold text-white mt-0.5">
              How to Use Kinetic Pro — From Artwork to Unity in 3 Clicks
            </h2>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-full liquid-glass-button text-xs font-bold text-white"
          >
            Close Guide (Esc)
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 shrink-0">
          {(
            [
              { id: "quickstart", label: "1. 30-Second Quick Start (Try Live)" },
              { id: "tools", label: "2. Tools & Shortcuts" },
              { id: "slot_suite", label: "3. Slot Game Animation Suite" },
              { id: "unity", label: "4. Unity C# & Spine 4.2 Integration" },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
                activeTab === t.id ? "liquid-glass-active" : "liquid-glass-button text-slate-300 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-4 text-xs leading-relaxed text-slate-200">
          {activeTab === "quickstart" && (
            <div className="space-y-4">
              <p className="text-slate-300">
                You don&apos;t need any prior Spine experience. Follow these 4 interactive steps—use the button on each step below to watch Kinetic Pro perform the step for you immediately:
              </p>

              <div className="grid grid-cols-2 gap-3.5">
                <div className="p-4 rounded-2xl liquid-glass-well space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--label)]">Step 1 · 1-Click AI Auto-Rig & Physics</span>
                    <button
                      onClick={() => {
                        runOneClickAutoRig();
                        setMode("auto");
                        onClose();
                      }}
                      className="btn-primary px-3 py-1 text-[11px]"
                    >
                      Try It Live
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Inspects your character or symbol silhouette, infers mass (kg), Center of Mass (COM), and part materials (heavy metal, cloth silk, hair plume), builds a contour Delaunay mesh, solves 4-bone weights, and generates 14 famous game animations.
                  </p>
                </div>

                <div className="p-4 rounded-2xl liquid-glass-well space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--label)]">Step 2 · Play Famous Game Action</span>
                    <button
                      onClick={() => {
                        runAutoModeSelectAction("zeus-bolt");
                        setActiveVfx("lightning_bolts");
                        onClose();
                      }}
                      className="btn-primary px-3 py-1 text-[11px]"
                    >
                      Try Olympus Bolt
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    In Auto Studio (A), click any of the 14 built-in action cards (Olympus Sky-Bolt Cast, Mega Win 30× Slam, Whirlwind Cleave, Payline Symbol Pop, Treasure Chest Burst) and adjust the 12 Principles of 2D Animation sliders in real time.
                  </p>
                </div>

                <div className="p-4 rounded-2xl liquid-glass-well space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--label)]">Step 3 · Test in 5×3 Slot Stage</span>
                    <button
                      onClick={() => {
                        setSlotStageMode("reel_tumble_cascade");
                        onClose();
                      }}
                      className="btn-primary px-3 py-1 text-[11px]"
                    >
                      Try 5×3 Tumble Stage
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Preview your hero alongside a live 5×3 Tumble / Cascade Reel Grid, 500× Multiplier Orb Projectile Beam, 4-Tier Big Win Odometer, 1×3 Expanding Wild, or 8-Wedge Bonus Wheel.
                  </p>
                </div>

                <div className="p-4 rounded-2xl liquid-glass-well space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--label)]">Step 4 · Ship Export bundle</span>
                    <button
                      onClick={() => {
                        onClose();
                        void onTriggerExport();
                      }}
                      className="btn-primary px-3 py-1 text-[11px]"
                    >
                      Build bundle
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Exports your Zero-Dependency Unity C# Rig (.sfrig.json + .slotanim.json), Spine 4.2 (.json + .atlas.txt), and Baked Flipbook Sprite Sheet (.sprites.json) in one ZIP.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "tools" && (
            <div className="space-y-3">
              <p className="text-slate-300">
                Tools sit on the left rail in workflow order. Hover a tool for its name; press its key to switch.
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { key: "O", name: "Import", desc: "Upload a layered .psd or flat .png/.webp to extract layers, joint cover rings and torso inpainting." },
                  { key: "A", name: "Auto Rig", desc: "Visual physics learner, 12 principles dials, batch symbol rigger and the built-in game actions." },
                  { key: "P", name: "Bones & IK", desc: "Drag bone joints in setup pose to reposition bind pivots. Skinned meshes re-weight automatically." },
                  { key: "M", name: "Mesh", desc: "Choose contour triangle density and the auto-weight solver." },
                  { key: "B", name: "Weight Paint", desc: "Add, subtract, smooth or replace weights on vertices with a live heatmap. [ and ] change brush size." },
                  { key: "V", name: "Pose", desc: "Drag any bone on the canvas to rotate and keyframe it. Drag IK handles to translate." },
                  { key: "W", name: "Warp", desc: "Push, inflate, pinch or restore mesh vertices per keyframe for squash and stretch." },
                  { key: "E / ⌘E", name: "Export", desc: "Build the Spine 4.2, Unity and sprite-sheet bundle." },
                  { key: "Space  ← →  , .", name: "Playback", desc: "Play or pause; arrows step one frame; comma and period jump to the previous or next key." },
                  { key: "S  ⇧S", name: "Set Key", desc: "Key the selected bone at the playhead; with Shift, key every bone." },
                  { key: "K  G", name: "Timeline", desc: "K opens the dope sheet (drag keys to retime, Delete removes). G opens the graph editor with bezier handles." },
                  { key: "⌘C  ⌘V", name: "Pose Clipboard", desc: "Copy the whole pose at the playhead and paste it as keys anywhere. Breakdown keys in-betweens at any percentage." },
                  { key: "I  C  Tab", name: "Panels", desc: "I toggles the inspector, C the copilot, Tab hides every panel." },
                  { key: "⌘Z  ⌘S  ⌘O", name: "Undo, Save, Open", desc: "Up to 100 undo steps (⇧⌘Z redo). ⌘S saves to the projects folder with backups; ⌘O opens a saved project or template." },
                ].map((item) => (
                  <div key={item.key} className="p-3 rounded-2xl liquid-glass-well flex items-start gap-3">
                    <span className="px-2 py-1 rounded-[6px] bg-[var(--fill-2)] text-[12px] font-semibold text-[var(--label)] whitespace-nowrap shrink-0">
                      {item.key}
                    </span>
                    <div>
                      <div className="font-bold text-white">{item.name}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "slot_suite" && (
            <div className="space-y-3.5">
              <p className="text-slate-300">
                Click any button below to launch that Slot Game Animation Suite choreography mode directly on the stage:
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { label: "Tumble & 500× Orb Beam", action: () => setSlotStageMode("reel_tumble_cascade") },
                  { label: "4-Tier Big Win Odometer", action: () => setSlotStageMode("big_win_ladder") },
                  { label: "🃏 1×3 Expanding Wild Reel", action: () => setSlotStageMode("expanding_wild_reel") },
                  { label: "Bonus Wheel of Fortune", action: () => setSlotStageMode("bonus_wheel") },
                  { label: "2-Scatter Reel Fire", action: () => setSlotStageMode("scatter_anticipation") },
                  { label: "Hold & Spin Coins", action: () => setSlotStageMode("hold_and_spin_coins") },
                  { label: "Feature Splash Banner", action: () => setSlotStageMode("feature_splash") },
                  { label: "Rig WILD Symbol", action: () => loadSymbolRig("wild") },
                  { label: "Rig SCATTER Symbol", action: () => loadSymbolRig("scatter") },
                ].map((btn, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      btn.action();
                      onClose();
                    }}
                    className="p-3 rounded-2xl liquid-glass-button text-left font-bold text-amber-200 hover:text-white"
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === "unity" && (
            <div className="space-y-3">
              <p className="text-slate-300">
                Drop <code>unity-package/com.spineforge.runtime</code> into your Unity <code>Packages/</code> directory. Right-click any exported <code>&lt;id&gt;.sfrig.json</code> in Unity → <strong>Assets → SpineForge → Build Prefab from Selected .sfrig.json</strong>:
              </p>
              <pre className="p-4 rounded-2xl liquid-glass-well font-mono text-[11px] text-emerald-300 overflow-x-auto">
{`using SpineForge;
using UnityEngine;

public class SlotHeroController : MonoBehaviour
{
    [SerializeField] private SpineForgeAnimator animator;

    void Start()
    {
        // Play any of the 14 built-in slot & combat animations:
        // "idle", "anticipation", "cheer", "strike", "power", "triumph", "bow",
        // "zeus-bolt", "berserk-spin", "hit-react", "symbol-win", "wild-expand", "scatter-trigger", "chest-open"
        animator.Play("zeus-bolt");

        // Switch multi-skin tier wardrobe ("default", "awakened", "ascended")
        animator.SetSkin("ascended");

        // Listen for authored timeline events (OnHit, SpawnVFX, PlaySFX, CameraShake)
        animator.OnAnimationEvent += ev =>
        {
            Debug.Log($"[KineticPro] Event {ev.name} ({ev.stringParam}) at {ev.time}s");
        };
    }
}`}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
