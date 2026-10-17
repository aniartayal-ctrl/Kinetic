"use client";

import { useState } from "react";
import type { AgentToolAction, AiProviderId } from "@/app/api/ai-agent/route";
import { useStudioStore } from "@/store/useStudioStore";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  provider: AiProviderId;
  text: string;
  actions?: AgentToolAction[];
  timestamp: string;
};

const PROVIDERS: {
  id: AiProviderId;
  name: string;
  modelBadge: string;
  accent: string;
}[] = [
  { id: "cursor", name: "Cursor", modelBadge: "Agent MCP", accent: "#38bdf8" },
  { id: "claude", name: "Claude", modelBadge: "Sonnet 4.5", accent: "#f97316" },
  { id: "chatgpt", name: "ChatGPT", modelBadge: "GPT-5 / o3", accent: "#10b981" },
  { id: "grok", name: "Grok", modelBadge: "Grok 4", accent: "#a855f7" },
];

const QUICK_PROMPTS: { label: string; prompt: string }[] = [
  {
    label: "Auto-Mesh & Geodesic Weights",
    prompt: "Generate a high-density Delaunay mesh on body and solve geodesic heat weights.",
  },
  {
    label: "Tune Cape & Hair Wind Springs",
    prompt: "Configure flowing spring physics and strong wind on the cape and hair bones.",
  },
  {
    label: "Enable 2-Bone IK Arm Pin",
    prompt: "Enable 100% 2-bone IK mix on the weapon arm with clockwise elbow bend.",
  },
  {
    label: "Synthesize & Bake All 6 Clips",
    prompt: "Regenerate all 6 procedural animations and bake springs to 24Hz keyframes.",
  },
  {
    label: "Build Unity + Spine 4.2 Bundle",
    prompt: "Export the complete Unity .sfrig.json, Spine 4.2, and flipbook sprite sheet bundle.",
  },
];

export function AiAgentPanel({ onTriggerExport }: { onTriggerExport: () => Promise<void> }) {
  const {
    project,
    setMode,
    selectBone,
    selectPart,
    setActiveClip,
    regeneratePartMesh,
    updateBone,
    updateIkMix,
    addBone,
    setBoneKeyframeAtCurrentTime,
    regenerateAllProceduralClips,
    bakeCurrentClipSprings,
  } = useStudioStore();

  const [provider, setProvider] = useState<AiProviderId>("cursor");
  const [prompt, setPrompt] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKeyConfig, setShowKeyConfig] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      provider: "cursor",
      text: "Connected to **Kinetic Pro Live Tool Engine**. Switch between **Cursor**, **Claude**, **ChatGPT**, or **Grok** above—every prompt executes real tool calls on your layers, Delaunay meshes, bone weights, IK pins, and Unity exporter.",
      timestamp: "Ready",
      actions: [
        {
          tool: "configure_mesh_and_weights",
          args: { part: "body", density: "medium", weightMode: "hybrid" },
          summary: "MCP Bridge linked to 12 bones & 7 mesh layers",
        },
      ],
    },
  ]);

  const executeToolActions = async (actions: AgentToolAction[]) => {
    for (const act of actions) {
      switch (act.tool) {
        case "set_mode":
          setMode(act.args.mode);
          break;
        case "select_target":
          if (act.args.bone) selectBone(act.args.bone);
          if (act.args.part) selectPart(act.args.part);
          if (act.args.clip) setActiveClip(act.args.clip);
          break;
        case "configure_mesh_and_weights":
          selectPart(act.args.part);
          regeneratePartMesh(act.args.part, act.args.density, act.args.weightMode);
          break;
        case "configure_spring_physics":
          selectBone(act.args.bone);
          updateBone(act.args.bone, {
            spring: act.args.enabled
              ? {
                  stiffness: act.args.stiffness ?? 65,
                  damping: act.args.damping ?? 6,
                  gain: [7, 3],
                  wind: act.args.wind ?? 1.8,
                }
              : undefined,
          });
          break;
        case "configure_ik":
          updateIkMix(act.args.ikName, act.args.mix, act.args.bendPositive);
          break;
        case "add_bone":
          addBone(act.args.parent, act.args.name, act.args.x, act.args.y);
          break;
        case "set_keyframe_pose":
          if (act.args.clip) setActiveClip(act.args.clip);
          selectBone(act.args.bone);
          setBoneKeyframeAtCurrentTime(act.args.bone, {
            r: act.args.r,
            x: act.args.x,
            y: act.args.y,
          });
          break;
        case "regenerate_procedural_clips":
          regenerateAllProceduralClips();
          break;
        case "bake_springs_to_keys":
          bakeCurrentClipSprings();
          break;
        case "trigger_unity_export":
          await onTriggerExport();
          break;
      }
    }
  };

  const sendPrompt = async (inputPrompt: string) => {
    const clean = inputPrompt.trim();
    if (!clean || isRunning) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      provider,
      text: clean,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setPrompt("");
    setIsRunning(true);

    try {
      const res = await fetch("/api/ai-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          apiKey: apiKey.trim() || undefined,
          prompt: clean,
          project,
        }),
      });
      const data = await res.json();
      const actions: AgentToolAction[] = data.actions ?? [];
      await executeToolActions(actions);

      const botMsg: ChatMessage = {
        id: `a-${Date.now()}`,
        role: "assistant",
        provider,
        text: data.reply || "Executed studio tool actions.",
        actions,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          provider,
          text: err instanceof Error ? err.message : "Agent request failed",
          timestamp: "Error",
        },
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  const activeProviderMeta = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0]!;

  return (
    <aside className="pointer-events-auto w-84 rounded-[26px] liquid-glass flex flex-col overflow-hidden shrink-0">
      {/* 1. AI Copilot Header & 4-Provider Switcher (Cursor, Claude, ChatGPT, Grok) */}
      <div className="p-3 border-b border-white/12 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full shadow-[0_0_10px_currentColor]"
              style={{ backgroundColor: activeProviderMeta.accent, color: activeProviderMeta.accent }}
            />
            <span className="text-xs font-bold tracking-tight text-white">AI Rigging Copilot</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full liquid-glass-well font-mono text-sky-300">
              {activeProviderMeta.modelBadge}
            </span>
          </div>
          <button
            onClick={() => setShowKeyConfig(!showKeyConfig)}
            title="Configure API Keys / MCP Endpoint"
            className="px-2 py-0.5 rounded-full liquid-glass-button text-[10px] font-medium text-slate-300 hover:text-white"
          >
            {showKeyConfig ? "Hide Key" : "API / MCP"}
          </button>
        </div>

        {/* 4-Way Provider Pill Selector */}
        <div className="grid grid-cols-4 gap-1 p-0.5 rounded-full liquid-glass-well text-[11px]">
          {PROVIDERS.map((p) => {
            const active = p.id === provider;
            return (
              <button
                key={p.id}
                onClick={() => setProvider(p.id)}
                className={`whitespace-nowrap py-1 rounded-full font-semibold transition ${
                  active ? "liquid-glass-active" : "text-slate-400 hover:text-white"
                }`}
              >
                {p.name}
              </button>
            );
          })}
        </div>

        {/* Optional API Key / Cursor MCP CLI Drawer */}
        {showKeyConfig && (
          <div className="p-2.5 rounded-2xl liquid-glass-well space-y-2 text-[11px]">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-semibold">{activeProviderMeta.name} API Key (Optional)</span>
              <span className="text-[10px] text-emerald-300">Local Tool Engine Active</span>
            </div>
            <input
              type="password"
              placeholder={`Paste ${activeProviderMeta.name} key or leave blank for built-in agent...`}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full bg-white/8 border border-white/15 rounded-xl px-2.5 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none"
            />
            <div className="text-[10px] text-slate-400 font-mono truncate">
              CLI: spineforge-metal-cli export-all {project.id}
            </div>
          </div>
        )}
      </div>

      {/* 2. Quick Action Chips for 1-Click AI Execution */}
      <div className="px-3 py-2 border-b border-white/8 flex items-center gap-1.5 overflow-x-auto shrink-0">
        {QUICK_PROMPTS.map((chip, idx) => (
          <button
            key={idx}
            onClick={() => void sendPrompt(chip.prompt)}
            className="whitespace-nowrap shrink-0 px-2.5 py-1 rounded-full liquid-glass-button text-[10px] font-medium text-sky-200 hover:text-white"
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* 3. Live Agent Chat & Tool Execution Stream */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`p-3 rounded-2xl space-y-2 ${
              msg.role === "user"
                ? "bg-sky-500/20 border border-sky-400/35 text-white ml-4"
                : "liquid-glass-well text-slate-200 mr-2"
            }`}
          >
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span className="font-bold uppercase tracking-wider text-sky-300">
                {msg.role === "user" ? "You" : `${msg.provider.toUpperCase()} Agent`}
              </span>
              <span>{msg.timestamp}</span>
            </div>

            <p className="leading-relaxed text-[11.5px] whitespace-pre-wrap">{msg.text}</p>

            {/* Executed Tool Calls Cards */}
            {msg.actions && msg.actions.length > 0 && (
              <div className="space-y-1 pt-1">
                {msg.actions.map((act, i) => (
                  <div
                    key={i}
                    className="px-2.5 py-1.5 rounded-xl bg-emerald-500/12 border border-emerald-400/25 text-[10.5px] font-mono text-emerald-200 flex items-center gap-2"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />
                    <span className="truncate">{act.summary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 4. Prompt Input Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void sendPrompt(prompt);
        }}
        className="p-3 border-t border-white/10 flex items-center gap-2 shrink-0"
      >
        <input
          type="text"
          placeholder={`Ask ${activeProviderMeta.name} to rig, mesh, weight, or export...`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="flex-1 min-w-0 liquid-glass-well rounded-full px-3.5 py-2 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-400"
        />
        <button
          type="submit"
          disabled={isRunning || !prompt.trim()}
          className="whitespace-nowrap shrink-0 px-3.5 py-2 rounded-full liquid-glass-active text-xs font-bold disabled:opacity-40"
        >
          {isRunning ? "..." : "Run"}
        </button>
      </form>
    </aside>
  );
}
