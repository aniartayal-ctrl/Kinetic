/**
 * Copilot agent loop (`src/copilot/agent-loop.ts`), shared by the copilot panel, the tests and the
 * eval script so all three exercise the same code.
 *
 * One user prompt → repeated model steps. Each step's tool calls run through the executor and their
 * results go back to the model, which continues until it answers without tools (or a limit, a stop
 * or an error ends the run). The transcript stays valid for the next prompt in every outcome.
 */

import { addUsage, type ModelStep, type ToolCall, type Turn, type Usage } from "@/core/copilot/providers";
import type { CopilotContext } from "@/core/copilot/tools";
import { copilotContext, executeCopilotActions, type ActionResult, type ExecutorHost } from "./executor";

export class StepError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export type StepFn = (transcript: Turn[], context: CopilotContext, signal?: AbortSignal) => Promise<ModelStep>;

export type AgentRun = {
  transcript: Turn[];
  /** Tool calls executed in this run. */
  applied: number;
  steps: number;
  /** Tokens across every model call in the run, when the provider reports them. */
  usage?: Usage;
  outcome: "done" | "limit" | "stopped" | "error";
  error?: string;
  code?: string;
};

export const MAX_STEPS = 12;

const isAbort = (err: unknown, signal?: AbortSignal) => Boolean(signal?.aborted) || (err instanceof Error && err.name === "AbortError");

export function toolResults(calls: ToolCall[], results: ActionResult[]) {
  return calls.map((c, i) => ({ id: c.id, ok: results[i]?.ok ?? false, message: results[i]?.message ?? "Not run: 40 calls per step at most" }));
}

export async function runAgentTurn(opts: {
  prompt: string;
  transcript: Turn[];
  callStep: StepFn;
  host: ExecutorHost;
  maxSteps?: number;
  signal?: AbortSignal;
  onText?: (text: string) => void;
  onResults?: (results: ActionResult[]) => void;
  onStep?: (step: number) => void;
}): Promise<AgentRun> {
  const { callStep, host, signal } = opts;
  const maxSteps = opts.maxSteps ?? MAX_STEPS;
  let transcript: Turn[] = [...opts.transcript, { role: "user", text: opts.prompt }];
  let applied = 0;
  let usage: Usage | undefined;
  for (let step = 0; step < maxSteps; step++) {
    opts.onStep?.(step + 1);
    let reply: ModelStep;
    try {
      if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
      reply = await callStep(transcript, copilotContext(), signal);
    } catch (err) {
      // A run that produced nothing leaves no trace, so retrying does not repeat the prompt.
      if (step === 0) transcript = transcript.slice(0, -1);
      if (isAbort(err, signal)) return { transcript, applied, steps: step, usage, outcome: "stopped" };
      return {
        transcript,
        applied,
        steps: step,
        usage,
        outcome: "error",
        error: err instanceof Error ? err.message : "Request failed",
        code: err instanceof StepError ? err.code : undefined,
      };
    }
    usage = addUsage(usage, reply.usage);
    const calls = Array.isArray(reply.calls) ? reply.calls : [];
    transcript = [...transcript, { role: "assistant", text: reply.text ?? "", calls }];
    if (reply.text) opts.onText?.(reply.text);
    if (calls.length === 0) return { transcript, applied, steps: step + 1, usage, outcome: "done" };
    if (signal?.aborted) {
      transcript = [...transcript, { role: "tool", results: calls.map((c) => ({ id: c.id, ok: false, message: "Stopped by the user" })) }];
      return { transcript, applied, steps: step + 1, usage, outcome: "stopped" };
    }
    const results = await executeCopilotActions(
      calls.map((c) => ({ tool: c.tool, args: c.args, summary: "" })),
      host,
    );
    applied += results.length;
    transcript = [...transcript, { role: "tool", results: toolResults(calls, results) }];
    opts.onResults?.(results);
    if (signal?.aborted) return { transcript, applied, steps: step + 1, usage, outcome: "stopped" };
  }
  return { transcript, applied, steps: maxSteps, usage, outcome: "limit" };
}
