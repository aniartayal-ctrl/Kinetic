/**
 * Cloud model adapters (`src/core/copilot/providers.ts`). Pure functions, no I/O.
 *
 * The copilot keeps one provider-neutral transcript. Each request converts it to the provider's
 * native tool-use format, and each response converts back:
 * - Claude: Messages API with `tools`, `tool_use` / `tool_result` blocks, cached system prompt.
 * - OpenAI and xAI (OpenAI-compatible): Chat Completions with `tools` / `tool_calls` / `tool` messages.
 * The studio state rides in the system prompt so it is always current and never repeated in history.
 */

import { COPILOT_TOOLS, describeContext, SYSTEM_PROMPT, type CopilotContext } from "./tools";

export type AiProviderId = "cursor" | "claude" | "chatgpt" | "grok";
export type CloudProvider = Exclude<AiProviderId, "cursor">;

export type ToolCall = { id: string; tool: string; args: Record<string, unknown> };
export type ToolResult = { id: string; ok: boolean; message: string };
export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; calls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export type Usage = { input: number; output: number; cached: number };
export type ModelStep = { text: string; calls: ToolCall[]; done: boolean; usage?: Usage };

export function addUsage(a: Usage | undefined, b: Usage | undefined): Usage | undefined {
  if (!a) return b;
  if (!b) return a;
  return { input: a.input + b.input, output: a.output + b.output, cached: a.cached + b.cached };
}

export const MAX_TURNS = 24;

/**
 * Keeps the most recent turns without breaking protocol: the kept slice starts at a user message,
 * and every assistant tool call keeps its tool results.
 */
export function trimTranscript(transcript: Turn[], maxTurns = MAX_TURNS): Turn[] {
  if (transcript.length <= maxTurns) return transcript;
  let start = transcript.length - maxTurns;
  while (start < transcript.length && transcript[start]!.role !== "user") start++;
  if (start >= transcript.length) {
    // The current run alone is longer than the window: keep all of it, from its prompt.
    start = transcript.length - 1;
    while (start > 0 && transcript[start]!.role !== "user") start--;
  }
  return transcript.slice(start);
}

/** Every assistant tool call must be answered before the next request; missing answers become errors. */
export function closeOpenCalls(transcript: Turn[], reason = "Not run"): Turn[] {
  const out: Turn[] = [];
  for (let i = 0; i < transcript.length; i++) {
    const t = transcript[i]!;
    out.push(t);
    if (t.role === "assistant" && t.calls.length > 0) {
      const next = transcript[i + 1];
      const answered = new Set(next?.role === "tool" ? next.results.map((r) => r.id) : []);
      const missing = t.calls.filter((c) => !answered.has(c.id)).map((c) => ({ id: c.id, ok: false, message: reason }));
      if (missing.length > 0) {
        if (next?.role === "tool") {
          out.push({ role: "tool", results: [...next.results, ...missing] });
          i++;
        } else out.push({ role: "tool", results: missing });
      }
    }
  }
  return out;
}

/* ── Claude (Anthropic Messages API) ─────────────────────────────────────────────────────────── */

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export const ANTHROPIC_TOOLS = COPILOT_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.input }));

export function anthropicRequest(model: string, transcript: Turn[], context: CopilotContext, maxTokens = 4096) {
  const messages: { role: "user" | "assistant"; content: AnthropicBlock[] }[] = [];
  const push = (role: "user" | "assistant", content: AnthropicBlock[]) => {
    const last = messages[messages.length - 1];
    // Consecutive same-role turns merge (e.g. tool results followed by a new user message).
    if (last && last.role === role) last.content.push(...content);
    else messages.push({ role, content });
  };
  for (const t of closeOpenCalls(trimTranscript(transcript))) {
    if (t.role === "user") push("user", [{ type: "text", text: t.text }]);
    else if (t.role === "tool") {
      push(
        "user",
        t.results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.message || (r.ok ? "Done" : "Failed"), ...(r.ok ? {} : { is_error: true }) })),
      );
    } else {
      const content: AnthropicBlock[] = [];
      if (t.text) content.push({ type: "text", text: t.text });
      for (const c of t.calls) content.push({ type: "tool_use", id: c.id, name: c.tool, input: c.args });
      push("assistant", content.length > 0 ? content : [{ type: "text", text: "…" }]);
    }
  }
  return {
    model,
    max_tokens: maxTokens,
    // The static prompt (and the tools before it) is cached; the live state follows uncached.
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Current studio state:\n${describeContext(context)}` },
    ],
    tools: ANTHROPIC_TOOLS,
    tool_choice: { type: "auto" },
    messages,
  };
}

export function parseAnthropic(data: unknown): ModelStep {
  const d = data as {
    content?: { type: string; text?: string; id?: string; name?: string; input?: unknown }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  const blocks = Array.isArray(d?.content) ? d.content : [];
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
  const calls: ToolCall[] = blocks
    .filter((b) => b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
    .map((b) => ({ id: b.id!, tool: b.name!, args: b.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : {} }));
  const u = d?.usage;
  const usage = u
    ? {
        // input_tokens excludes cached reads and cache writes; count everything the model read.
        input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        output: u.output_tokens ?? 0,
        cached: u.cache_read_input_tokens ?? 0,
      }
    : undefined;
  return { text, calls, done: calls.length === 0 || d.stop_reason !== "tool_use", ...(usage ? { usage } : {}) };
}

/* ── OpenAI / xAI (Chat Completions, function calling) ──────────────────────────────────────── */

export const OPENAI_TOOLS = COPILOT_TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.input } }));

export function openAiRequest(model: string, transcript: Turn[], context: CopilotContext) {
  const messages: Record<string, unknown>[] = [{ role: "system", content: `${SYSTEM_PROMPT}\n\nCurrent studio state:\n${describeContext(context)}` }];
  for (const t of closeOpenCalls(trimTranscript(transcript))) {
    if (t.role === "user") messages.push({ role: "user", content: t.text });
    else if (t.role === "tool") for (const r of t.results) messages.push({ role: "tool", tool_call_id: r.id, content: `${r.ok ? "" : "Error: "}${r.message}` });
    else {
      messages.push({
        role: "assistant",
        content: t.text || null,
        ...(t.calls.length > 0
          ? { tool_calls: t.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.tool, arguments: JSON.stringify(c.args) } })) }
          : {}),
      });
    }
  }
  return { model, messages, tools: OPENAI_TOOLS, tool_choice: "auto" };
}

export function parseOpenAi(data: unknown): ModelStep {
  const d = data as {
    choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  const choice = d?.choices?.[0];
  const calls: ToolCall[] = (choice?.message?.tool_calls ?? [])
    .filter((c) => typeof c.id === "string" && typeof c.function?.name === "string")
    .map((c) => {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(c.function?.arguments || "{}");
        if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
      } catch {
        args = { __invalid: c.function?.arguments ?? "" };
      }
      return { id: c.id!, tool: c.function!.name!, args };
    });
  const u = d?.usage;
  const usage = u ? { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cached: u.prompt_tokens_details?.cached_tokens ?? 0 } : undefined;
  return { text: (choice?.message?.content ?? "").trim(), calls, done: calls.length === 0, ...(usage ? { usage } : {}) };
}

/** Human-readable reason for a failed provider response. */
export function explainProviderError(status: number, message: string, model: string, provider: string): string {
  if (status === 401 || status === 403) return `${provider} rejected the API key (${status}). Check the key in Copilot → Key or .env.local.`;
  if (status === 404) return `${provider} has no model "${model}" (404). Set KINETIC_${provider === "Claude" ? "CLAUDE" : provider === "Grok" ? "XAI" : "OPENAI"}_MODEL to a model you can use.`;
  if (status === 429) return `${provider} rate limit reached (429). Wait a moment and try again.`;
  if (status === 529 || status === 503) return `${provider} is overloaded right now (${status}). Try again shortly.`;
  if (status === 400) return `${provider} rejected the request (400): ${message}`;
  return `${provider} error ${status}: ${message}`;
}
