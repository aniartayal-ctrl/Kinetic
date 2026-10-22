/**
 * Copilot model relay (`/api/ai-agent`).
 *
 * Stateless: the client sends the provider-neutral transcript and the live studio state; this route
 * makes one model call with native tool use and returns the model's text and tool calls. The client
 * runs the tools, appends their results and calls again until the model stops (an agent loop).
 * Keys come from the request or the server environment (.env.local), and never leave this machine
 * except to the provider.
 */

import { NextResponse } from "next/server";
import { blockCrossSite } from "@/server/http";
import type { AiProviderId, CloudProvider, Turn } from "@/core/copilot/providers";
import type { CopilotContext } from "@/core/copilot/tools";
import { callModel, PROVIDERS, providerStatus } from "@/server/copilot-relay";

export const dynamic = "force-dynamic";

/** Which providers have a server-side key, and which model each uses. */
export async function GET() {
  return NextResponse.json({ providers: providerStatus() });
}

export async function POST(request: Request) {
  const blocked = blockCrossSite(request);
  if (blocked) return blocked;
  let body: { provider?: AiProviderId; model?: string; apiKey?: string; transcript?: Turn[]; context?: CopilotContext };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const { provider, transcript, context } = body;
  if (!provider || !(provider in PROVIDERS)) {
    return NextResponse.json({ error: "Unknown provider; the built-in planner runs in the browser." }, { status: 400 });
  }
  if (!Array.isArray(transcript) || transcript.length === 0 || !Array.isArray(context?.bones)) {
    return NextResponse.json({ error: "Missing transcript or studio context" }, { status: 400 });
  }
  const p = PROVIDERS[provider as CloudProvider];
  const key = body.apiKey?.trim() || process.env[p.keyEnv];
  if (!key) {
    return NextResponse.json(
      { error: `No ${p.label} key. Add one under Key, or set ${p.keyEnv} in .env.local and restart.`, code: "no_key" },
      { status: 400 },
    );
  }
  const model = body.model?.trim() || p.model();
  const result = await callModel(provider as CloudProvider, key, model, transcript, context!);
  if (!result.ok) return NextResponse.json({ error: result.error, code: "provider_error", status: result.status }, { status: 502 });
  return NextResponse.json({ ...result.step, model });
}
