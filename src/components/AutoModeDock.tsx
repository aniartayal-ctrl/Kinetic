"use client";

import {
  FAMOUS_GAME_ACTIONS,
  type AutoArchetypeId,
} from "@/core/physics-and-principles";
import { useStudioStore } from "@/store/useStudioStore";

const ARCHETYPE_OPTIONS: { id: AutoArchetypeId; label: string }[] = [
  { id: "auto_detect", label: "Auto-Detect from Visuals" },
  { id: "heavy_titan", label: "Heavy Titan / Warhammer" },
  { id: "olympus_caster", label: "Olympus Sky Caster (Zeus)" },
  { id: "agile_duelist", label: "Agile Duelist / Cleave" },
  { id: "slot_symbol", label: "Slot Wild / Scatter Medallion" },
  { id: "treasure_chest", label: "Bonus Treasure Chest" },
];

export function AutoModeDock({ onShipToUnity }: { onShipToUnity: () => Promise<void> }) {
  const {
    activeClip,
    autoArchetype,
    principles,
    physicsReport,
    runAutoModeSelectAction,
    updatePrinciples,
  } = useStudioStore();

  const categories = [
    "Famous Game Actions",
    "Pragmatic Win Ladder",
    "Slot Symbols & Chests",
    "Core & Tease",
  ] as const;

  return (
    <aside className="pointer-events-auto w-84 rounded-[26px] liquid-glass flex flex-col overflow-hidden shrink-0">
      {/* 1. Header + 1-Click Ship Button */}
      <div className="p-3.5 border-b border-white/12 flex items-center justify-between gap-2 shrink-0">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300 block">
            1-Click Auto Studio (A)
          </span>
          <h2 className="text-sm font-bold text-white">
            Visual Physics & 14 Game Actions
          </h2>
        </div>
        <button
          onClick={() => void onShipToUnity()}
          className="whitespace-nowrap shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold bg-gradient-to-b from-amber-300 to-amber-500 text-slate-950 shadow-[0_0_16px_rgba(251,191,36,0.45)] hover:brightness-110 transition"
        >
          Ship Ready Bundle
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3.5 text-xs">
        {/* 2. Visual Physics Inference Card ("Learned by Looking at Object") */}
        <div className="p-3 rounded-2xl liquid-glass-well space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-cyan-300">
              Visual Physics Learner
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-400/20 text-cyan-200 font-mono font-semibold uppercase">
              {physicsReport.inferredArchetype.replace("_", " ")}
            </span>
          </div>

          <select
            value={autoArchetype}
            onChange={(e) =>
              runAutoModeSelectAction(activeClip, e.target.value as AutoArchetypeId)
            }
            className="w-full bg-white/10 border border-white/20 rounded-xl px-2.5 py-1.5 text-xs text-white font-medium focus:outline-none"
          >
            {ARCHETYPE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id} className="bg-slate-950 text-white">
                {opt.label}
              </option>
            ))}
          </select>

          {/* Inferred Physical Telemetry Pills */}
          <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
            <div className="p-1.5 rounded-xl bg-white/6 border border-white/10 text-center">
              <div className="text-slate-400">Mass</div>
              <div className="text-white font-bold">{physicsReport.estimatedMassKg} kg</div>
            </div>
            <div className="p-1.5 rounded-xl bg-white/6 border border-white/10 text-center">
              <div className="text-slate-400">Center of Mass</div>
              <div className="text-sky-300 font-bold">
                {physicsReport.centerOfMass[0]}, {physicsReport.centerOfMass[1]}
              </div>
            </div>
            <div className="p-1.5 rounded-xl bg-white/6 border border-white/10 text-center">
              <div className="text-slate-400">Gravity / Drag</div>
              <div className="text-amber-300 font-bold">
                {physicsReport.gravityScale}g · {physicsReport.airDrag}
              </div>
            </div>
          </div>

          {/* Per-Part Material & Spring Stiffness Tags */}
          <div className="flex flex-wrap gap-1 pt-0.5">
            {physicsReport.partTelemetry.slice(0, 5).map((pt) => (
              <span
                key={pt.partName}
                className="text-[9.5px] px-2 py-0.5 rounded-full bg-white/8 border border-white/12 text-slate-300 font-mono"
              >
                {pt.partName}: <strong className="text-sky-200">{pt.material.replace("_", " ")}</strong> ({pt.stiffness}k)
              </span>
            ))}
          </div>
        </div>

        {/* 3. 12 Principles of 2D Animation Live Dials */}
        <div className="p-3 rounded-2xl liquid-glass-well space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-purple-300">
              12 Principles of 2D Animation
            </span>
            <span className="text-[10px] font-mono text-slate-400">sx·sy=1.0</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-[10.5px]">
            <label className="space-y-0.5">
              <div className="flex justify-between text-slate-300">
                <span>Squash & Stretch</span>
                <span className="font-mono text-white">{Math.round(principles.squashAndStretch * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.8"
                step="0.1"
                value={principles.squashAndStretch}
                onChange={(e) => updatePrinciples({ squashAndStretch: parseFloat(e.target.value) })}
                className="w-full accent-purple-400"
              />
            </label>

            <label className="space-y-0.5">
              <div className="flex justify-between text-slate-300">
                <span>Anticipation</span>
                <span className="font-mono text-white">{Math.round(principles.anticipation * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.2"
                max="1.8"
                step="0.1"
                value={principles.anticipation}
                onChange={(e) => updatePrinciples({ anticipation: parseFloat(e.target.value) })}
                className="w-full accent-purple-400"
              />
            </label>

            <label className="space-y-0.5">
              <div className="flex justify-between text-slate-300">
                <span>Overlap / Trail</span>
                <span className="font-mono text-white">{Math.round(principles.followThroughOverlap * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1.8"
                step="0.1"
                value={principles.followThroughOverlap}
                onChange={(e) => updatePrinciples({ followThroughOverlap: parseFloat(e.target.value) })}
                className="w-full accent-purple-400"
              />
            </label>

            <label className="space-y-0.5">
              <div className="flex justify-between text-slate-300">
                <span>Exaggeration</span>
                <span className="font-mono text-white">{Math.round(principles.exaggeration * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="1.8"
                step="0.1"
                value={principles.exaggeration}
                onChange={(e) => updatePrinciples({ exaggeration: parseFloat(e.target.value) })}
                className="w-full accent-purple-400"
              />
            </label>
          </div>
        </div>

        {/* 4. 14 Famous Slot & Game Actions (Click Any Action to Auto-Mesh, Auto-Rig, Animate & Play) */}
        <div className="space-y-3">
          {categories.map((cat) => {
            const items = FAMOUS_GAME_ACTIONS.filter((a) => a.category === cat);
            return (
              <div key={cat} className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">
                  {cat} ({items.length})
                </div>
                <div className="space-y-1.5">
                  {items.map((act) => {
                    const isSelected = activeClip === act.id;
                    return (
                      <button
                        key={act.id}
                        onClick={() => runAutoModeSelectAction(act.id)}
                        className={`w-full text-left p-2.5 rounded-2xl border transition-all flex items-center justify-between gap-2 ${
                          isSelected
                            ? "bg-sky-500/22 border-sky-300/50 text-white shadow-[0_0_18px_rgba(56,189,248,0.25)]"
                            : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-xs truncate flex items-center gap-1.5">
                            <span>{act.title}</span>
                          </div>
                          <div className="text-[10.5px] text-slate-400 truncate mt-0.5">
                            {act.subtitle}
                          </div>
                        </div>
                        <span
                          className={`whitespace-nowrap shrink-0 text-[9.5px] px-2 py-0.5 rounded-full font-mono font-bold ${
                            isSelected
                              ? "bg-sky-400 text-slate-950"
                              : "bg-white/10 text-sky-300"
                          }`}
                        >
                          {act.badge}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
