import { NextResponse } from "next/server";
import type { SpineForgeProject } from "@/core/schema";

export type AiProviderId = "cursor" | "claude" | "chatgpt" | "grok";

export type AgentToolAction =
  | {
      tool: "set_mode";
      args: { mode: "rig" | "mesh" | "weights" | "animate" | "export" };
      summary: string;
    }
  | {
      tool: "select_target";
      args: { bone?: string; part?: string; clip?: string };
      summary: string;
    }
  | {
      tool: "configure_mesh_and_weights";
      args: {
        part: string;
        density: "low" | "medium" | "high";
        weightMode: "hybrid" | "heat" | "capsule";
      };
      summary: string;
    }
  | {
      tool: "configure_spring_physics";
      args: {
        bone: string;
        enabled: boolean;
        stiffness?: number;
        damping?: number;
        wind?: number;
      };
      summary: string;
    }
  | {
      tool: "configure_ik";
      args: {
        ikName: string;
        mix: number;
        bendPositive?: boolean;
      };
      summary: string;
    }
  | {
      tool: "add_bone";
      args: {
        parent: string;
        name: string;
        x: number;
        y: number;
      };
      summary: string;
    }
  | {
      tool: "set_keyframe_pose";
      args: {
        clip?: string;
        time?: number;
        bone: string;
        r?: number;
        x?: number;
        y?: number;
      };
      summary: string;
    }
  | {
      tool: "regenerate_procedural_clips";
      args: Record<string, never>;
      summary: string;
    }
  | {
      tool: "bake_springs_to_keys";
      args: Record<string, never>;
      summary: string;
    }
  | {
      tool: "trigger_unity_export";
      args: { format: "all" | "spine42" | "unity_sfrig" | "spritesheet" };
      summary: string;
    };

const SYSTEM_PROMPT = `You are the built-in AI Technical Artist & Rigging Agent inside Kinetic Pro (SpineForge), a 2D Delaunay Mesh, Skeletal Rigging, Weight-Painting, and Unity/Spine 4.2 Animation Studio.
You can directly control the application by returning JSON with:
{
  "reply": "Concise explanation of what you did",
  "actions": [ ...array of AgentToolAction objects... ]
}
Available tools:
- set_mode: { mode: "rig" | "mesh" | "weights" | "animate" | "export" }
- select_target: { bone?: string, part?: string, clip?: string }
- configure_mesh_and_weights: { part: string, density: "low"|"medium"|"high", weightMode: "hybrid"|"heat"|"capsule" }
- configure_spring_physics: { bone: string, enabled: boolean, stiffness?: number, damping?: number, wind?: number }
- configure_ik: { ikName: string, mix: number, bendPositive?: boolean }
- add_bone: { parent: string, name: string, x: number, y: number }
- set_keyframe_pose: { clip?: string, time?: number, bone: string, r?: number, x?: number, y?: number }
- regenerate_procedural_clips: {}
- bake_springs_to_keys: {}
- trigger_unity_export: { format: "all" | "spine42" | "unity_sfrig" | "spritesheet" }`;

/**
 * Local deterministic agentic planner so natural-language prompts execute real studio tool calls
 * immediately even when no external LLM API key is provided.
 */
function runLocalAgentPlanner(
  prompt: string,
  provider: AiProviderId,
  project: SpineForgeProject,
): { reply: string; actions: AgentToolAction[] } {
  const q = prompt.toLowerCase();
  const actions: AgentToolAction[] = [];
  const notes: string[] = [];

  const skinnedPart =
    project.parts.find((p) => p.name && q.includes(p.name.toLowerCase()))?.name ??
    project.parts.find((p) => p.skin && p.skin.length > 1)?.name ??
    project.parts[0]?.name ??
    "body";

  const matchedBone =
    project.bones.find((b) => q.includes(b.name.toLowerCase()))?.name ??
    (q.includes("cape")
      ? project.bones.find((b) => b.name.includes("cape"))?.name
      : q.includes("hair")
        ? project.bones.find((b) => b.name.includes("hair"))?.name
        : q.includes("weapon") || q.includes("hammer") || q.includes("staff")
          ? "weapon"
          : "arm") ??
    "arm";

  // 1. Mesh & Tessellation commands
  if (q.includes("mesh") || q.includes("delaunay") || q.includes("tessellat") || q.includes("density") || q.includes("vertex")) {
    const density: "low" | "medium" | "high" = q.includes("high") || q.includes("dense") || q.includes("fine")
      ? "high"
      : q.includes("low") || q.includes("coarse")
        ? "low"
        : "high";
    const weightMode: "hybrid" | "heat" | "capsule" = q.includes("heat") || q.includes("geodesic")
      ? "heat"
      : q.includes("capsule")
        ? "capsule"
        : "hybrid";

    actions.push({
      tool: "set_mode",
      args: { mode: "mesh" },
      summary: "Switched workspace to Puppet Warp Mesh mode (M)",
    });
    actions.push({
      tool: "configure_mesh_and_weights",
      args: { part: skinnedPart, density, weightMode },
      summary: `Re-tessellated '${skinnedPart}' with ${density} Delaunay contour density and ${weightMode} auto-weights`,
    });
    notes.push(
      `Generated a **${density}-density** contour Delaunay mesh on \`${skinnedPart}\` and solved 4-bone normalized weights using the **${weightMode}** kernel.`,
    );
  }

  // 2. Weight solving / heatmap inspection
  if (q.includes("weight") || q.includes("heatmap") || q.includes("skin") || q.includes("geodesic")) {
    const weightMode: "hybrid" | "heat" | "capsule" = q.includes("capsule") ? "capsule" : "heat";
    actions.push({
      tool: "set_mode",
      args: { mode: "weights" },
      summary: "Activated GPU Weight Brush & Heatmap view (B)",
    });
    actions.push({
      tool: "configure_mesh_and_weights",
      args: { part: skinnedPart, density: "high", weightMode },
      summary: `Solved ${weightMode} skinning weights on '${skinnedPart}'`,
    });
    notes.push(`Solved **${weightMode}** auto-weights across \`${skinnedPart}\` and enabled the live GPU weight heatmap.`);
  }

  // 3. Spring / Wind / Secondary Physics commands
  if (q.includes("spring") || q.includes("wind") || q.includes("cape") || q.includes("cloth") || q.includes("hair") || q.includes("physics")) {
    const springBones = project.bones.filter(
      (b) => b.spring || b.name.includes("cape") || b.name.includes("hair") || b.name.includes("hem"),
    );
    const targets = springBones.length > 0 ? springBones.map((b) => b.name) : [matchedBone];
    const stiffness = q.includes("stiff") ? 85 : q.includes("soft") || q.includes("flow") ? 48 : 68;
    const wind = q.includes("storm") || q.includes("strong") ? 3.2 : 2.0;

    for (const bName of targets) {
      actions.push({
        tool: "configure_spring_physics",
        args: { bone: bName, enabled: true, stiffness, damping: 6, wind },
        summary: `Configured spring physics on '${bName}' (stiffness=${stiffness}, wind=${wind})`,
      });
    }
    notes.push(
      `Enabled secondary spring physics on \`${targets.join(", ")}\` with stiffness **${stiffness}** and ambient wind **${wind}°**.`,
    );
  }

  // 4. Inverse Kinematics (IK) commands
  if (q.includes("ik") || q.includes("inverse") || q.includes("plant") || q.includes("elbow")) {
    const ik = project.ikConstraints[0];
    if (ik) {
      const mix = q.includes("off") || q.includes("0") ? 0 : 1.0;
      actions.push({
        tool: "configure_ik",
        args: { ikName: ik.name, mix, bendPositive: !q.includes("counter") },
        summary: `Set 2-Bone Analytical IK '${ik.name}' mix to ${Math.round(mix * 100)}%`,
      });
      notes.push(`Set 2-Bone Analytical IK constraint \`${ik.name}\` to **${Math.round(mix * 100)}% mix**.`);
    }
  }

  // 5. Add new bone command
  if (q.includes("add bone") || q.includes("new bone") || q.includes("create bone")) {
    const customName = q.match(/bone\s+([a-z0-9-_]+)/i)?.[1] ?? `fx-aura-${project.bones.length}`;
    actions.push({
      tool: "add_bone",
      args: { parent: "chest", name: customName, x: 0.55, y: 0.28 },
      summary: `Created child bone '${customName}' parented to 'chest'`,
    });
    notes.push(`Added new bone \`${customName}\` under \`chest\`.`);
  }

  // 6. Pose / Keyframe / Animation commands
  if (q.includes("pose") || q.includes("rotate") || q.includes("raise") || q.includes("slam") || q.includes("animate") || q.includes("clip")) {
    const targetClip =
      ["idle", "cheer", "strike", "power", "triumph", "bow"].find((c) => q.includes(c)) ?? "strike";
    actions.push({
      tool: "set_mode",
      args: { mode: "animate" },
      summary: "Switched to Timeline Animate mode",
    });
    actions.push({
      tool: "select_target",
      args: { bone: matchedBone, clip: targetClip },
      summary: `Selected clip '${targetClip}' and bone '${matchedBone}'`,
    });

    if (q.includes("bake")) {
      actions.push({
        tool: "bake_springs_to_keys",
        args: {},
        summary: `Baked live springs & IK into 24Hz deterministic keyframes on '${targetClip}'`,
      });
      notes.push(`Baked all secondary spring physics and IK into explicit 24Hz keyframes on \`${targetClip}\`.`);
    } else if (q.includes("regenerate") || q.includes("procedural") || q.includes("all clips")) {
      actions.push({
        tool: "regenerate_procedural_clips",
        args: {},
        summary: "Synthesized all 6 procedural slot animations (idle, cheer, strike, power, triumph, bow)",
      });
      notes.push("Synthesized all 6 procedural animations (`idle`, `cheer`, `strike`, `power`, `triumph`, `bow`).");
    } else {
      const angleMatch = q.match(/(-?\d+)\s*(?:deg|°)/i);
      const rot = angleMatch ? parseFloat(angleMatch[1]!) : q.includes("raise") ? -95 : -45;
      actions.push({
        tool: "set_keyframe_pose",
        args: { clip: targetClip, time: 0.55, bone: matchedBone, r: rot },
        summary: `Keyed '${matchedBone}' rotation to ${rot}° at 0.55s in '${targetClip}'`,
      });
      notes.push(`Keyed \`${matchedBone}\` at \`0.55s\` in clip \`${targetClip}\` with rotation **${rot}°**.`);
    }
  }

  // 7. Export Unity / Spine / Sprite Sheet commands
  if (q.includes("export") || q.includes("unity") || q.includes("spine") || q.includes("sprite") || q.includes("bundle")) {
    actions.push({
      tool: "trigger_unity_export",
      args: { format: "all" },
      summary: "Built 3-Way Unity (.sfrig.json) + Spine 4.2 (.json/.atlas) + Metal Flipbook Sprite Sheet bundle",
    });
    notes.push(
      "Triggered the **3-Way Unity & Spine 4.2 Export Pipeline** (`.sfrig.json` zero-dependency Unity rig, `.spine.json` + `.atlas.txt`, and Metal-baked flipbook sprite sheet).",
    );
  }

  // Default full auto-rig + optimize pipeline if prompt is general (e.g. "auto rig this character for Unity")
  if (actions.length === 0) {
    actions.push(
      {
        tool: "configure_mesh_and_weights",
        args: { part: skinnedPart, density: "high", weightMode: "hybrid" },
        summary: `Auto-meshed '${skinnedPart}' with high-density Delaunay triangles & hybrid weights`,
      },
      {
        tool: "regenerate_procedural_clips",
        args: {},
        summary: "Generated all 6 procedural animations (idle, cheer, strike, power, triumph, bow)",
      },
      {
        tool: "bake_springs_to_keys",
        args: {},
        summary: "Baked secondary spring bones into deterministic 24Hz tracks",
      },
    );
    notes.push(
      `Executed full **${provider.toUpperCase()} Auto-Rig & Animation Pipeline** on \`${project.title}\`: generated high-density Delaunay contour meshes, solved 4-bone normalized skin weights, and baked 6 procedural clips.`,
    );
  }

  return {
    reply: notes.join(" "),
    actions,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      provider: AiProviderId;
      model?: string;
      apiKey?: string;
      prompt: string;
      project: SpineForgeProject;
    };

    const { provider, apiKey, prompt, project } = body;

    // Optional live OpenAI / Anthropic / xAI API call when user supplies an API key or env var
    const openAiKey = apiKey || process.env.OPENAI_API_KEY;
    const xaiKey = apiKey || process.env.XAI_API_KEY;
    const anthropicKey = apiKey || process.env.ANTHROPIC_API_KEY;

    if ((provider === "chatgpt" && openAiKey) || (provider === "grok" && xaiKey)) {
      const endpoint =
        provider === "grok"
          ? "https://api.x.ai/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
      const key = provider === "grok" ? xaiKey : openAiKey;
      const model = body.model || (provider === "grok" ? "grok-3-mini" : "gpt-4o-mini");

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: `Project: ${project.id} (${project.width}x${project.height}), Bones: ${project.bones.map((b) => b.name).join(",")}, Parts: ${project.parts.map((p) => p.name).join(",")}.\nUser Request: ${prompt}`,
              },
            ],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content);
            if (parsed.reply && Array.isArray(parsed.actions)) {
              return NextResponse.json({ provider, mode: "cloud-llm", ...parsed });
            }
          }
        }
      } catch {
        // Fall through to deterministic local tool planner
      }
    } else if (provider === "claude" && anthropicKey) {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: body.model || "claude-3-5-sonnet-latest",
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: `Project: ${project.id}, Bones: ${project.bones.map((b) => b.name).join(",")}, Parts: ${project.parts.map((p) => p.name).join(",")}.\nReturn ONLY valid JSON for: ${prompt}`,
              },
            ],
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const text = data.content?.[0]?.text ?? "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.reply && Array.isArray(parsed.actions)) {
              return NextResponse.json({ provider, mode: "cloud-llm", ...parsed });
            }
          }
        }
      } catch {
        // Fall through to deterministic local tool planner
      }
    }

    // Execute built-in Agentic Tool Planner
    const result = runLocalAgentPlanner(prompt, provider, project);
    return NextResponse.json({
      provider,
      mode: "agentic-tool-engine",
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI Agent error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
