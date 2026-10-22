"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { AiProviderId } from "@/app/api/ai-agent/route";
import { reviewClip, type CueCard } from "@/core/coach";
import { EXAMPLE_PROMPTS, planCommand } from "@/core/copilot/planner";
import type { CopilotAction } from "@/core/copilot/tools";
import { copilotContext, executeCopilotActions, type ActionResult, type ExecutorHost } from "@/copilot/executor";
import { useStudioStore } from "@/store/useStudioStore";

type Message = { id: string; role: "user" | "assistant"; text: string; results?: ActionResult[]; note?: string };

const PROVIDERS: { id: AiProviderId; name: string; badge: string }[] = [
  // "cursor" is the id of the offline planner (kept for saved-session compatibility).
  { id: "cursor", name: "Built-in", badge: "Offline" },
  { id: "claude", name: "Claude", badge: "Sonnet 5.5" },
  { id: "chatgpt", name: "ChatGPT", badge: "GPT-5 mini" },
  { id: "grok", name: "Grok", badge: "Grok 4" },
];

const SEVERITY_COLOR = { warn: "#ff9f0a", tip: "#64b0ff" } as const;

export function AiAgentPanel({
  onExport,
  onSave,
  onOpenBudget,
  onOpenProject,
  onHidePane,
}: {
  onExport: () => Promise<void>;
  onSave: () => Promise<boolean>;
  onOpenBudget: () => void;
  onOpenProject: (name?: string) => Promise<string>;
  onHidePane?: () => void;
}) {
  const project = useStudioStore((s) => s.project);
  const activeClip = useStudioStore((s) => s.activeClip);
  const [provider, setProvider] = useState<AiProviderId>("cursor");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAllCards, setShowAllCards] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const [recall, setRecall] = useState(-1);
  const threadRef = useRef<HTMLDivElement>(null);

  const cards = useMemo(() => reviewClip(project, activeClip), [project, activeClip]);
  const fixable = cards.filter((c) => c.apply).length;
  const host: ExecutorHost = { exportBundle: onExport, save: onSave, openBudget: onOpenBudget, openProject: onOpenProject };

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const push = (m: Omit<Message, "id">) => setMessages((prev) => [...prev, { ...m, id: `${Date.now()}-${prev.length}` }]);

  const run = async (actions: CopilotAction[]) => executeCopilotActions(actions, host);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    push({ role: "user", text });
    setSent((s) => [...s.filter((x) => x !== text), text].slice(-30));
    setRecall(-1);
    setInput("");
    setBusy(true);
    try {
      const context = copilotContext();
      let reply = "";
      let actions: CopilotAction[] = [];
      let note: string | undefined;
      if (provider === "cursor") {
        ({ reply, actions } = planCommand(text, context));
      } else {
        const res = await fetch("/api/ai-agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider, apiKey: apiKey.trim() || undefined, prompt: text, context }),
        });
        const data = (await res.json()) as { reply?: string; actions?: CopilotAction[]; cloudError?: string; error?: string; model?: string };
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        reply = data.reply ?? "";
        actions = Array.isArray(data.actions) ? data.actions : [];
        if (data.cloudError) note = `Cloud model unavailable (${data.cloudError}); used the built-in planner.`;
        else if (data.model) note = data.model;
      }
      const results = await run(actions);
      push({ role: "assistant", text: reply, results, note });
    } catch (err) {
      push({ role: "assistant", text: err instanceof Error ? err.message : "Something went wrong", note: "Error" });
    } finally {
      setBusy(false);
    }
  };

  const applyCard = async (card: CueCard) => {
    const results = await run([{ tool: "apply_suggestion", args: { id: card.id }, summary: card.fixLabel ?? card.title }]);
    push({ role: "assistant", text: "", results });
  };

  const fixAll = async () => {
    const results = await run([{ tool: "fix_all", args: {}, summary: "Apply all coach fixes" }]);
    push({ role: "assistant", text: "", results });
  };

  const visibleCards = showAllCards ? cards : cards.slice(0, 2);
  const activeProvider = PROVIDERS.find((p) => p.id === provider)!;

  return (
    <aside className="pointer-events-auto w-full liquid-glass-pill rounded-[var(--radius-panel)] flex flex-col overflow-hidden flex-1 min-h-0" aria-label="Copilot">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 space-y-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">Copilot</span>
          <span className="text-[11px] text-[var(--label-3)]">{activeProvider.badge}</span>
          <div className="flex-1" />
          <button
            onClick={() => setShowKey((v) => !v)}
            aria-pressed={showKey}
            className="icon-btn h-7 w-auto px-2 text-[12px]"
            data-tip="API key for cloud models"
            data-tip-side="bottom"
          >
            Key
          </button>
          {onHidePane && (
            <button onClick={onHidePane} className="icon-btn h-7 w-7 text-[15px]" aria-label="Close copilot">
              ×
            </button>
          )}
        </div>
        <div className="segmented" role="tablist" aria-label="Model">
          {PROVIDERS.map((p) => (
            <button key={p.id} role="tab" aria-pressed={p.id === provider} onClick={() => setProvider(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        {showKey && (
          <div className="space-y-1.5 animate-panel-in">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === "cursor" ? "Built-in planner needs no key" : `${activeProvider.name} API key (optional)`}
              disabled={provider === "cursor"}
              className="w-full h-7 rounded-[6px] bg-[var(--fill-3)] border border-[var(--separator)] px-2 text-[12px] placeholder:text-[var(--label-3)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
            <p className="text-[10.5px] text-[var(--label-3)]">Kept in this tab only. Blank uses the server&apos;s environment key, or the built-in planner.</p>
          </div>
        )}
      </div>

      {/* Coach cue cards */}
      {cards.length > 0 && (
        <section className="px-3 pb-2 shrink-0" aria-label="Suggestions">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="section-title">Suggestions for {activeClip}</span>
            <span className="text-[11px] text-[var(--label-3)] tabular-nums">{cards.length}</span>
            <div className="flex-1" />
            {fixable > 1 && (
              <button onClick={() => void fixAll()} className="text-[12px] text-[var(--accent-hover)] hover:underline">
                Fix all
              </button>
            )}
          </div>
          <div className="space-y-1.5 max-h-[38vh] overflow-y-auto">
            {visibleCards.map((card) => (
              <article key={card.id} className="rounded-[10px] bg-[var(--fill-3)] border border-[var(--separator)] p-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: SEVERITY_COLOR[card.severity] }}>
                      {card.principle}
                    </div>
                    <div className="text-[12.5px] font-medium leading-snug mt-0.5">{card.title}</div>
                    <p className="text-[11.5px] leading-snug text-[var(--label-2)] mt-0.5">{card.detail}</p>
                  </div>
                  {card.apply && (
                    <button onClick={() => void applyCard(card)} className="shrink-0 btn-primary h-7 px-2.5 text-[11.5px]">
                      {card.fixLabel}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {cards.length > 2 && (
            <button onClick={() => setShowAllCards((v) => !v)} className="mt-1 text-[11.5px] text-[var(--label-2)] hover:text-[var(--label)]">
              {showAllCards ? "Show fewer" : `Show all ${cards.length}`}
            </button>
          )}
        </section>
      )}

      {/* Conversation */}
      <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2.5 border-t border-[var(--separator)]">
        {messages.length === 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-[12px] text-[var(--label-2)] leading-snug">
              Ask in plain words. I can mesh, weight, rig, add physics, key, ease, break down, retime, review and export. Chain steps with
              “then”.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map((p) => (
                <button key={p} onClick={() => void send(p)} className="liquid-glass-button rounded-full px-2.5 py-1 text-[11.5px] text-left">
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-[12px] rounded-br-[4px] bg-[var(--accent)] text-white px-2.5 py-1.5 text-[12.5px] leading-snug">{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className="space-y-1">
              {m.results && m.results.length > 0 && (
                <ul className="space-y-0.5">
                  {m.results.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12px] leading-snug">
                      <span className={`mt-[1px] shrink-0 ${r.ok ? "text-[#30d158]" : "text-[#ff453a]"}`} aria-label={r.ok ? "Done" : "Failed"}>
                        {r.ok ? "✓" : "✕"}
                      </span>
                      <span>
                        <span className="text-[var(--label)]">{r.action.summary}</span>
                        {r.message && r.message !== r.action.summary && (
                          <span className="block text-[var(--label-2)] whitespace-pre-line">{r.message}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {m.text && <p className="text-[12.5px] leading-snug text-[var(--label)]">{m.text}</p>}
              {m.note && <p className="text-[10.5px] text-[var(--label-3)]">{m.note}</p>}
            </div>
          ),
        )}
        {busy && <p className="text-[12px] text-[var(--label-3)]">Working…</p>}
      </div>

      {/* Composer */}
      <form
        className="p-2.5 border-t border-[var(--separator)] flex gap-2 items-end shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            } else if (e.key === "ArrowUp" && !input.includes("\n") && sent.length > 0) {
              e.preventDefault();
              const i = recall < 0 ? sent.length - 1 : Math.max(0, recall - 1);
              setRecall(i);
              setInput(sent[i]!);
            } else if (e.key === "Escape") {
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          rows={1}
          placeholder="Ask Copilot… (↑ for history)"
          aria-label="Ask Copilot"
          className="flex-1 min-h-8 max-h-28 resize-none rounded-[8px] bg-[var(--fill-3)] border border-[var(--separator)] px-2.5 py-1.5 text-[12.5px] placeholder:text-[var(--label-3)] focus:outline-none focus:border-[var(--accent)]"
        />
        <button type="submit" disabled={busy || !input.trim()} className="btn-primary h-8 px-3 text-[12.5px]">
          Run
        </button>
      </form>
    </aside>
  );
}
