/**
 * Copilot model relay (server). One model call with native tool use; shared by the
 * /api/ai-agent route and scripts/eval-copilot.ts so the eval tests exactly what the app runs.
 */

import {
  anthropicRequest,
  explainProviderError,
  openAiRequest,
  parseAnthropic,
  parseOpenAi,
  type CloudProvider,
  type ModelStep,
  type Turn,
} from "../core/copilot/providers";
import type { CopilotContext } from "../core/copilot/tools";

export const PROVIDERS: Record<CloudProvider, { label: string; keyEnv: string; model: () => string; baseUrl: () => string }> = {
  claude: {
    label: "Claude",
    keyEnv: "ANTHROPIC_API_KEY",
    model: () => process.env.KINETIC_CLAUDE_MODEL || "claude-sonnet-5-5",
    baseUrl: () => process.env.KINETIC_ANTHROPIC_BASE_URL || "https://api.anthropic.com",
  },
  chatgpt: {
    label: "ChatGPT",
    keyEnv: "OPENAI_API_KEY",
    model: () => process.env.KINETIC_OPENAI_MODEL || "gpt-5-mini",
    baseUrl: () => process.env.KINETIC_OPENAI_BASE_URL || "https://api.openai.com",
  },
  grok: {
    label: "Grok",
    keyEnv: "XAI_API_KEY",
    model: () => process.env.KINETIC_XAI_MODEL || "grok-4",
    baseUrl: () => process.env.KINETIC_XAI_BASE_URL || "https://api.x.ai",
  },
};

/** Which providers have a server-side key, and which model each uses. */
export function providerStatus() {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([id, p]) => [id, { configured: Boolean(process.env[p.keyEnv]), model: p.model(), keyEnv: p.keyEnv }]),
  );
}

async function errorText(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } | string };
    return (typeof data.error === "string" ? data.error : data.error?.message) ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

/** One model call. */
export async function callModel(
  provider: CloudProvider,
  key: string,
  model: string,
  transcript: Turn[],
  context: CopilotContext,
): Promise<{ ok: true; step: ModelStep } | { ok: false; status: number; error: string }> {
  const p = PROVIDERS[provider];
  const isClaude = provider === "claude";
  const url = `${p.baseUrl().replace(/\/$/, "")}${isClaude ? "/v1/messages" : "/v1/chat/completions"}`;
  const body = isClaude ? anthropicRequest(model, transcript, context) : openAiRequest(model, transcript, context);
  const headers: Record<string, string> = isClaude
    ? { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }
    : { "content-type": "application/json", authorization: `Bearer ${key}` };
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    if (!res.ok) return { ok: false, status: res.status, error: explainProviderError(res.status, await errorText(res), model, p.label) };
    const data = await res.json();
    return { ok: true, step: isClaude ? parseAnthropic(data) : parseOpenAi(data) };
  } catch (err) {
    const timeout = err instanceof Error && err.name === "TimeoutError";
    return { ok: false, status: 0, error: timeout ? `${p.label} did not answer within 90 s.` : `Could not reach ${p.label}: ${err instanceof Error ? err.message : "network error"}` };
  }
}

