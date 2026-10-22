/**
 * Copilot tool catalog (`src/core/copilot/tools.ts`).
 *
 * One list drives everything the copilot can do: the offline planner emits these actions, cloud
 * models are prompted with this catalog, and the client executor validates and runs them.
 * Arguments are loosely typed on purpose: actions may come from an LLM and are validated at run time.
 */

export type CopilotAction = { tool: string; args: Record<string, unknown>; summary: string };

export type ToolSpec = { name: string; args: string; does: string };

export const COPILOT_TOOLS: ToolSpec[] = [
  // Selection, view, playback
  { name: "select", args: "{ bone?, part?, clip? }", does: "Select a bone, layer or animation clip." },
  { name: "set_mode", args: "{ mode: import|auto|rig|mesh|weights|animate|liquify|export }", does: "Switch tool." },
  {
    name: "toggle_overlay",
    args: "{ overlay: bones|mesh|heatmap|onion|arcs|trail|lighting|hitboxes|reels|solo, on?: boolean }",
    does: "Show or hide a viewport overlay.",
  },
  { name: "playback", args: "{ action: play|pause|toggle, speed?: number }", does: "Control playback." },
  { name: "go_to", args: "{ time?: seconds, frame?: number, key?: next|prev|first|last }", does: "Move the playhead." },
  // Rigging
  { name: "auto_rig", args: "{}", does: "Auto-rig: infer physics, mesh every layer, weight and generate clips." },
  { name: "add_bone", args: "{ name, parent?, x?, y? }", does: "Add a bone (x/y normalized 0..1; defaults offset from parent)." },
  { name: "move_pivot", args: "{ bone, x, y }", does: "Set a bone's bind pivot (normalized 0..1)." },
  { name: "configure_ik", args: "{ ikName?, mix?: 0..1, bendPositive?: boolean|'toggle' }", does: "Tune an IK constraint." },
  {
    name: "configure_spring_physics",
    args: "{ bone, enabled, stiffness?, damping?, wind? }",
    does: "Add, tune or remove secondary-motion physics on a bone.",
  },
  { name: "lock_bone", args: "{ bone, locked: boolean }", does: "Lock a bone against weight painting." },
  // Mesh and weights
  {
    name: "configure_mesh_and_weights",
    args: "{ part: name|'all', density: low|medium|high, weightMode: hybrid|heat|capsule }",
    does: "Re-mesh a layer and solve its weights.",
  },
  { name: "reset_warp", args: "{ part }", does: "Clear warp (FFD) offsets on a layer in this clip." },
  // Animation
  { name: "set_key", args: "{ bones?: name[]|'all', r?, x?, y?, sx?, sy?, time? }", does: "Key bones at the playhead (values optional)." },
  { name: "breakdown", args: "{ fraction: -0.25..1.25, bones?: name[] }", does: "Key an in-between between neighbouring poses." },
  { name: "copy_pose", args: "{}", does: "Copy the whole pose at the playhead." },
  { name: "paste_pose", args: "{ time? }", does: "Paste the copied pose as keys." },
  {
    name: "set_curve",
    args: "{ bones?: name[]|'all', curve: linear|ease|ease_in|ease_out|overshoot|stepped }",
    does: "Set the easing of every key on the bones in this clip.",
  },
  { name: "retime_clip", args: "{ duration?, scale?, fps?: 24|30|60, loop?: boolean, stretch? }", does: "Change clip length, speed, fps or looping." },
  { name: "generate_clips", args: "{}", does: "Regenerate the built-in game action clips." },
  { name: "bake_springs_to_keys", args: "{}", does: "Bake physics into plain keys for this clip." },
  { name: "add_animation_event", args: "{ name: OnHit|SpawnVFX|PlaySFX|CameraShake, time? }", does: "Add a Unity animation event." },
  // Coach
  { name: "review", args: "{}", does: "Review the clip against the 12 principles and list suggestions." },
  { name: "apply_suggestion", args: "{ id }", does: "Apply one coach suggestion (ids come from review)." },
  { name: "fix_all", args: "{}", does: "Apply every coach suggestion that has a fix." },
  // Project
  { name: "set_skin_variant", args: "{ skinName }", does: "Switch skin tier." },
  { name: "check_budget", args: "{}", does: "Open the performance budget." },
  { name: "undo", args: "{}", does: "Undo." },
  { name: "redo", args: "{}", does: "Redo." },
  { name: "save", args: "{}", does: "Save the project into the projects folder." },
  { name: "open_project", args: "{ name? }", does: "Open a saved project or built-in template by name; without a name, show the list." },
  { name: "export", args: "{}", does: "Build the Unity bundle." },
];

export const TOOL_NAMES = new Set(COPILOT_TOOLS.map((t) => t.name));

/** Context sent with every request so cloud models can use real names. */
export type CopilotContext = {
  bones: string[];
  parts: string[];
  clips: string[];
  ikNames: string[];
  activeClip: string;
  selectedBone: string | null;
  selectedPart: string | null;
  currentTime: number;
  duration: number;
  fps: number;
};

export function buildSystemPrompt(): string {
  return [
    "You are the copilot inside Kinetic, a 2D rigging and animation studio for Unity slot games.",
    "You are an expert animator who applies the 12 principles of animation.",
    'Reply with JSON only: {"reply": "<one or two sentences>", "actions": [{"tool": "<name>", "args": {...}, "summary": "<short>"}]}.',
    "Use only these tools and only bone, part and clip names from the context:",
    ...COPILOT_TOOLS.map((t) => `- ${t.name} ${t.args}: ${t.does}`),
    "Prefer several small actions over one vague one. If the request is unclear, return no actions and ask one question.",
  ].join("\n");
}
