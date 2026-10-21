import { NextResponse } from "next/server";
import { planCommand } from "@/core/copilot/planner";
import { buildSystemPrompt, type CopilotAction, type CopilotContext } from "@/core/copilot/tools";

export type AiProviderId = "cursor" | "claude" | "chatgpt" | "grok";
/** Kept for older imports; actions now follow the copilot catalog. */
export type AgentToolAction = CopilotAction;

const SYSTEM_PROMPT = buildSystemPrompt();

export const DEFAULT_MODELS = {
  claude: process.env.KINETIC_CLAUDE_MODEL || "claude-sonnet-5-5",
  chatgpt: process.env.KINETIC_OPENAI_MODEL || "gpt-5-mini",
  grok: process.env.KINETIC_XAI_MODEL || "grok-4",
} as const;

type CloudPlan = { reply: string; actions: CopilotAction[] };
type CloudResult = { ok: true; plan: CloudPlan; model: string } | { ok: false; error: string; model: string };

function describeContext(ctx: CopilotContext): string {
  return [
    `Bones: ${ctx.bones.join(", ")}`,
    `Layers: ${ctx.parts.join(", ")}`,
    `Clips: ${ctx.clips.join(", ")} (open: ${ctx.activeClip}, ${ctx.duration}s at ${ctx.fps} fps, playhead ${ctx.currentTime.toFixed(2)}s)`,
    `IK: ${ctx.ikNames.join(", ") || "none"}`,
    `Selected bone: ${ctx.selectedBone ?? "none"}, selected layer: ${ctx.selectedPart ?? "none"}`,
  ].join("\n");
}

/** Pulls the first JSON object out of a model reply and checks it has the planner shape. */
function parsePlan(text: string): CloudPlan | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Partial<CloudPlan>;
    if (typeof parsed.reply === "string" && Array.isArray(parsed.actions)) return parsed as CloudPlan;
  } catch {
    // fall through
  }
  return null;
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string } | string };
    const msg = typeof data.error === "string" ? data.error : data.error?.message;
    return `${res.status} ${msg ?? res.statusText}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

async function callCloudModel(
  provider: Exclude<AiProviderId, "cursor">,
  key: string,
  model: string,
  prompt: string,
  context: CopilotContext,
): Promise<CloudResult> {
  const user = `${describeContext(context)}\nRequest: ${prompt}\nReturn ONLY the JSON object.`;
  try {
    if (provider === "claude") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 2048, system: SYSTEM_PROMPT, messages: [{ role: "user", content: user }] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) return { ok: false, error: await readError(res), model };
      const data = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      const plan = parsePlan(text);
      return plan ? { ok: true, plan, model } : { ok: false, error: "Model reply was not a valid action plan", model };
    }

    const endpoint = provider === "grok" ? "https://api.x.ai/v1/chat/completions" : "https://api.openai.com/v1/chat/completions";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { ok: false, error: await readError(res), model };
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const plan = parsePlan(data.choices?.[0]?.message?.content ?? "");
    return plan ? { ok: true, plan, model } : { ok: false, error: "Model reply was not a valid action plan", model };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error", model };
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      provider: AiProviderId;
      model?: string;
      apiKey?: string;
      prompt: string;
      context: CopilotContext;
    };
    const { provider, prompt, context } = body;
    if (typeof prompt !== "string" || !Array.isArray(context?.bones)) {
      return NextResponse.json({ error: "Missing prompt or context" }, { status: 400 });
    }

    const envKey =
      provider === "claude"
        ? process.env.ANTHROPIC_API_KEY
        : provider === "chatgpt"
          ? process.env.OPENAI_API_KEY
          : provider === "grok"
            ? process.env.XAI_API_KEY
            : undefined;
    const key = body.apiKey?.trim() || envKey;

    let cloudError: string | undefined;
    if (provider !== "cursor" && key) {
      const model = body.model?.trim() || DEFAULT_MODELS[provider];
      const result = await callCloudModel(provider, key, model, prompt, context);
      if (result.ok) {
        return NextResponse.json({ provider, mode: "cloud-llm", model: result.model, ...result.plan });
      }
      // Surface the failure instead of silently pretending the cloud model answered.
      cloudError = `${result.model}: ${result.error}`;
    }

    const plan = planCommand(prompt, context);
    return NextResponse.json({ provider, mode: "offline-planner", ...(cloudError ? { cloudError } : {}), ...plan });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI Agent error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
