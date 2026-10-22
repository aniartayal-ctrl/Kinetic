/**
 * Offline copilot planner (`src/core/copilot/planner.ts`).
 *
 * Turns plain-English requests into catalog actions with no network. Requests can chain steps
 * ("mesh the body dense, add physics to the cape, then ease everything"). Names are matched
 * against the real rig, including common synonyms (sword → weapon, torso → chest).
 */

import type { CopilotAction, CopilotContext } from "./tools";

export type Plan = { reply: string; actions: CopilotAction[] };

const VERBS =
  "add|make|set|key|keyframe|mesh|remesh|weight|reweight|auto|rig|ease|smooth|snap|fix|review|check|apply|play|pause|stop|go|jump|show|hide|toggle|turn|enable|disable|lock|unlock|select|open|switch|export|save|undo|redo|copy|paste|breakdown|bake|generate|regenerate|retime|speed|slow|loop|length|move|flip|bend|solo|give|remove|push|exaggerate|close|clean|use|load|edit|scrub|reset|stiffen|loosen|tween";
const VERB_START = new RegExp(`^(?:please\\s+|now\\s+|also\\s+)?(?:${VERBS})\\b`);

const SYNONYMS: Record<string, string[]> = {
  weapon: ["sword", "hammer", "axe", "staff", "spear", "blade", "mace"],
  chest: ["torso", "upper body"],
  hips: ["pelvis", "waist"],
  head: ["face", "skull"],
  cape: ["cloak", "mantle"],
  forearm: ["lower arm"],
};

const OVERLAYS: [RegExp, string][] = [
  [/\bheat ?map|weight view|weights view\b/, "heatmap"],
  [/\bwire ?frame|\bmesh\b|triangles\b/, "mesh"],
  [/\bbones?\b|skeleton\b/, "bones"],
  [/\bonion\b|ghost/, "onion"],
  [/\barcs?\b|motion paths?\b/, "arcs"],
  [/\btrails?\b/, "trail"],
  [/\blighting\b|relight|normal.?map/, "lighting"],
  [/\bhit ?box(es)?\b|colliders?\b/, "hitboxes"],
  [/\breels?\b|slot stage\b|\bstage\b/, "reels"],
  [/\bsolo\b|isolate/, "solo"],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Finds names mentioned in `text` by 1–3 word phrase match (plus synonyms). Longer phrases claim
 * their words first, so "arm back" resolves to "arm-back" and not also to "arm".
 */
export function findNames(text: string, names: string[]): string[] {
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const lookup = new Map<string, string>();
  for (const name of names) lookup.set(norm(name), name);
  for (const [target, words] of Object.entries(SYNONYMS)) {
    if (names.includes(target)) for (const w of words) if (!lookup.has(norm(w))) lookup.set(norm(w), target);
  }
  const covered = new Set<number>();
  const found: string[] = [];
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const span = Array.from({ length: n }, (_, k) => i + k);
      if (span.some((j) => covered.has(j))) continue;
      const name = lookup.get(tokens.slice(i, i + n).join(""));
      if (!name) continue;
      span.forEach((j) => covered.add(j));
      if (!found.includes(name)) found.push(name);
    }
  }
  return found;
}

const num = (re: RegExp, s: string): number | undefined => {
  const m = s.match(re);
  return m ? parseFloat(m[1]!) : undefined;
};

/** Splits a request into clauses on ";", "then", new lines, and on "," / "and" when a verb follows. */
export function splitClauses(prompt: string): string[] {
  const out: string[] = [];
  for (const chunk of prompt.toLowerCase().split(/\s*(?:;|\n|\band then\b|\bthen\b|\.\s+)\s*/)) {
    const pieces = chunk.split(/\s*(?:,|\band\b)\s*/).filter(Boolean);
    for (const p of pieces) {
      if (out.length > 0 && !VERB_START.test(p) && !/^(next|previous|prev) key/.test(p)) out[out.length - 1] += ` and ${p}`;
      else out.push(p);
    }
  }
  return out.map((c) => c.trim()).filter(Boolean);
}

function act(tool: string, args: Record<string, unknown>, summary: string): CopilotAction {
  return { tool, args, summary };
}

const COACH: [RegExp, string, string][] = [
  [/anticipat|wind.?up/, "anticipation", "Add anticipation"],
  [/overshoot|follow.?through|settle/, "follow-through", "Add follow-through"],
  [/squash|stretch/, "squash", "Add squash on impact"],
  [/snap .*frames?|clean (up )?(the )?keys|whole frames/, "off-frame", "Snap keys to frames"],
  [/(fix|close|smooth) (the )?loop|loop (pops|seam|jumps)/, "loop-seam", "Close the loop"],
  [/exaggerat|push (the )?poses|bigger|more punch/, "exaggeration", "Exaggerate poses"],
];

function planClause(c: string, ctx: CopilotContext): CopilotAction[] {
  const bones = findNames(c, ctx.bones);
  const parts = findNames(c, ctx.parts);
  const all = /\b(all|every|everything|whole|full body|entire)\b/.test(c);
  const out: CopilotAction[] = [];

  // Project-level commands.
  if (/^(please\s+)?undo\b/.test(c)) return [act("undo", {}, "Undo")];
  if (/^(please\s+)?redo\b/.test(c)) return [act("redo", {}, "Redo")];
  if (/\bsave\b/.test(c) && !/\bsave (a |the )?pose/.test(c)) return [act("save", {}, "Save project")];
  const openNamed = c.match(/\b(?:open|load|switch to)\s+(?:the\s+)?(.+?)\s+project\b/);
  const openList = c.match(/\b(?:open|load|switch to|show|list)\s+(?:my\s+|the\s+|a\s+)?(?:saved\s+)?projects?\b\s*(?:called|named)?\s*(.*)$/);
  if (openList || openNamed) {
    const name = (openList?.[1] || openNamed?.[1] || "").trim();
    return [act("open_project", name ? { name } : {}, name ? `Open project ${name}` : "Show projects")];
  }
  if (/\b(export|ship|build (the )?(unity )?bundle)\b/.test(c)) return [act("export", {}, "Build Unity bundle")];
  if (/\b(budget|performance|optimi[sz]e|draw calls|texture memory|too heavy)\b/.test(c)) return [act("check_budget", {}, "Open budget")];

  // Coach.
  if (/\b(fix (all|everything|it all)|apply (all|every|the) (suggestions|cues|fixes)|polish (it|this|the clip))\b/.test(c)) {
    return [act("fix_all", {}, "Apply all coach fixes")];
  }
  if (/\b(review|critique|feedback|what (can|should) i improve|what'?s wrong|suggest|coach)\b/.test(c)) {
    return [act("review", {}, "Review the clip")];
  }
  const wantsCoachFix = /\b(add|give|fix|close|push|clean|snap|exaggerate|make it)\b/.test(c);
  const coachHits = COACH.filter(([re, id]) => re.test(c) && (wantsCoachFix || id === "exaggeration") && !/\bcurve\b/.test(c));
  if (coachHits.length > 0) return coachHits.map(([, id, label]) => act("apply_suggestion", { id }, label));

  // Viewport overlays.
  const show = /\b(show|display|turn on|enable|reveal)\b/.test(c);
  const hide = /\b(hide|turn off|disable)\b/.test(c);
  if (show || hide || /\btoggle\b/.test(c)) {
    const hits = OVERLAYS.filter(([re]) => re.test(c)).map(([, o]) => o);
    if (hits.length > 0 && !/\b(physics|spring|ik)\b/.test(c)) {
      return hits.map((o) => act("toggle_overlay", show || hide ? { overlay: o, on: show } : { overlay: o }, `${show ? "Show" : hide ? "Hide" : "Toggle"} ${o}`));
    }
  }

  // Clip selection (only with a clip-ish verb, since clip names like "power" are common words).
  if (/\b(clip|animation|anim|open|switch to|edit|load|play|show me)\b/.test(c)) {
    const clip = findNames(c, ctx.clips)[0];
    if (clip && clip !== ctx.activeClip) out.push(act("select", { clip }, `Open clip ${clip}`));
  }

  // Playback and navigation.
  if (/\b(pause|stop)\b/.test(c)) return [...out, act("playback", { action: "pause" }, "Pause")];
  const speed = num(/(\d+(?:\.\d+)?)\s*x\b/, c);
  if (/\b(play|preview)\b/.test(c) && !/\bplayback speed\b/.test(c)) {
    return [...out, act("playback", { action: "play", ...(speed ? { speed } : {}) }, speed ? `Play at ${speed}×` : "Play")];
  }
  if (speed && /\b(speed|playback)\b/.test(c)) return [...out, act("playback", { action: "toggle", speed }, `Speed ${speed}×`)];
  if (/\bnext key\b/.test(c)) return [act("go_to", { key: "next" }, "Next key")];
  if (/\b(previous|prev|last) key\b/.test(c)) return [act("go_to", { key: "prev" }, "Previous key")];
  if (/\b(go|jump|move|scrub|skip) to\b|^frame \d+|^(to )?the (start|end)\b/.test(c) && !/\bpivot\b/.test(c)) {
    const frame = num(/frame\s*(\d+)/, c);
    const time = num(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/, c);
    if (frame !== undefined) return [...out, act("go_to", { frame }, `Go to frame ${frame}`)];
    if (time !== undefined) return [...out, act("go_to", { time }, `Go to ${time}s`)];
    if (/\b(start|beginning|first frame)\b/.test(c)) return [...out, act("go_to", { key: "first" }, "Go to start")];
    if (/\b(end|last frame)\b/.test(c)) return [...out, act("go_to", { key: "last" }, "Go to end")];
  }

  if (/\bbake\b/.test(c)) return [act("bake_springs_to_keys", {}, "Bake physics into keys")];

  // Rigging.
  if (/\bauto.?rig|\brig (it|this|everything|the (character|symbol|hero))\b|\brig it up\b/.test(c)) return [act("auto_rig", {}, "Auto-rig")];
  if (/\b(add|create|new)( a| another)? bone\b|\bnew bone\b/.test(c)) {
    const name = c.match(/(?:called|named)\s+([a-z0-9_-]+)/)?.[1] ?? `bone-${ctx.bones.length + 1}`;
    const parentText = c.match(/(?:under|on|to|child of|from|below)\s+(?:the\s+)?(.+)$/)?.[1] ?? "";
    const parent = findNames(parentText, ctx.bones)[0] ?? ctx.selectedBone ?? ctx.bones[0];
    return [act("add_bone", { name, parent }, `Add bone ${name} under ${parent}`)];
  }
  if (/\b(ik|elbow|knee|reach|pin)\b/.test(c) && !/\b(show|hide)\b/.test(c)) {
    const pct = num(/(-?\d+(?:\.\d+)?)\s*%/, c);
    const mix = pct !== undefined ? pct / 100 : /\b(off|disable|release)\b/.test(c) ? 0 : /\b(on|full|enable|lock)\b/.test(c) ? 1 : undefined;
    const flip = /\b(flip|other way|reverse|invert)\b/.test(c);
    const ikName = findNames(c, ctx.ikNames)[0] ?? ctx.ikNames[0];
    if (ikName && (mix !== undefined || flip)) {
      return [act("configure_ik", { ikName, ...(mix !== undefined ? { mix } : {}), ...(flip ? { bendPositive: "toggle" } : {}) }, `IK ${ikName}${mix !== undefined ? ` ${Math.round(mix * 100)}%` : ""}${flip ? " flipped" : ""}`)];
    }
  }
  if (/\b(spring|physics|jiggle|wobble|floppy|dangle|sway|stiff\w*|loose\w*|secondary)\b/.test(c)) {
    const targets = bones.length > 0 ? bones : [];
    const off = /\b(remove|disable|no|turn off|without|kill)\b/.test(c);
    const stiffness = num(/stiffness\s*(\d+)/, c) ?? (/\b(stiff|stiffer|tighter|tight)\b/.test(c) ? 85 : /\b(loose|looser|softer|floppier|floppy)\b/.test(c) ? 40 : undefined);
    if (targets.length === 0) return off ? [] : [act("apply_suggestion", { id: "secondary" }, "Add physics to loose parts")];
    return targets.map((bone) =>
      act("configure_spring_physics", { bone, enabled: !off, ...(stiffness ? { stiffness } : {}) }, `${off ? "Remove" : "Physics on"} ${bone}${stiffness ? ` (stiffness ${stiffness})` : ""}`),
    );
  }
  if (/\b(un)?lock\b/.test(c) && bones.length > 0) {
    const locked = !/\bunlock\b/.test(c);
    return bones.map((bone) => act("lock_bone", { bone, locked }, `${locked ? "Lock" : "Unlock"} ${bone}`));
  }
  if (/\breset (the )?(warp|liquify|ffd)\b/.test(c)) {
    const part = parts[0] ?? ctx.selectedPart;
    if (part) return [act("reset_warp", { part }, `Reset warp on ${part}`)];
  }

  // Mesh and weights.
  if (/\b(re)?mesh\b|triangulat|\bdensity\b|\b(auto.?|re)?weights?\b|\bskinning\b|\bre-?weight\b/.test(c) && !/\bweight paint\b/.test(c)) {
    const density = /\b(dense|high|fine|detailed|more triangles)\b/.test(c) ? "high" : /\b(low|coarse|light|cheap|fewer|lower)\b/.test(c) ? "low" : "medium";
    const weightMode = /\b(heat|geodesic)\b/.test(c) ? "heat" : /\b(capsule|envelope)\b/.test(c) ? "capsule" : "hybrid";
    const targets = all ? ["all"] : parts.length > 0 ? parts : ctx.selectedPart ? [ctx.selectedPart] : ["all"];
    return targets.map((part) => act("configure_mesh_and_weights", { part, density, weightMode }, `Mesh ${part} (${density}, ${weightMode} weights)`));
  }

  // Curves.
  const curveWord = c.match(/\b(ease in|ease out|ease|easing|smooth|linear|stepped|step(ped)? keys|blocking|overshoot|bounce|organic|less robotic)\b/)?.[1];
  if (curveWord && !/\bease (all )?(the )?linear\b/.test(c)) {
    const curve = /ease in/.test(curveWord) ? "ease_in" : /ease out/.test(curveWord) ? "ease_out" : /linear/.test(curveWord) ? "linear" : /step|blocking/.test(curveWord) ? "stepped" : /overshoot|bounce/.test(curveWord) ? "overshoot" : "ease";
    return [...out, act("set_curve", { bones: bones.length > 0 ? bones : "all", curve }, `${curve.replace("_", " ")} curves on ${bones.length > 0 ? bones.join(", ") : "every bone"}`)];
  }
  if (/\bease (all )?(the )?linear\b/.test(c)) return [act("apply_suggestion", { id: "slow-in-out" }, "Ease linear moves")];

  // Keys, breakdowns, pose clipboard.
  if (/\b(breakdown|in-?between|tween)\b/.test(c)) {
    const pct = num(/(-?\d+(?:\.\d+)?)\s*%/, c);
    const fraction = pct !== undefined ? pct / 100 : /\bfavou?r (the )?next\b/.test(c) ? 0.66 : /\bfavou?r (the )?(previous|prev|first)\b/.test(c) ? 0.33 : 0.5;
    return [act("breakdown", { fraction, ...(bones.length > 0 ? { bones } : {}) }, `Breakdown ${Math.round(fraction * 100)}%${bones.length ? ` on ${bones.join(", ")}` : ""}`)];
  }
  if (/\bcopy (the |this )?pose\b/.test(c)) return [act("copy_pose", {}, "Copy pose")];
  if (/\bpaste (the |that )?pose\b/.test(c)) {
    const frame = num(/frame\s*(\d+)/, c);
    return [act("paste_pose", frame !== undefined ? { time: frame / ctx.fps } : {}, frame !== undefined ? `Paste pose at frame ${frame}` : "Paste pose")];
  }
  if (/^(set (a )?key|key|keyframe|add (a )?key(frame)?)\b|\bkey (all|everything|the pose|bones|it)\b/.test(c)) {
    const deg = num(/(-?\d+(?:\.\d+)?)\s*(?:°|deg|degrees)\b/, c);
    const scale = num(/scale\s*(?:to\s*)?(\d+(?:\.\d+)?)/, c);
    const frame = num(/frame\s*(\d+)/, c);
    const targets = all || bones.length === 0 ? (all ? "all" : ctx.selectedBone ? [ctx.selectedBone] : "all") : bones;
    return [
      act(
        "set_key",
        { bones: targets, ...(deg !== undefined ? { r: deg } : {}), ...(scale !== undefined ? { sx: scale, sy: scale } : {}), ...(frame !== undefined ? { time: frame / ctx.fps } : {}) },
        `Key ${targets === "all" ? "all bones" : (targets as string[]).join(", ")}${deg !== undefined ? ` at ${deg}°` : ""}`,
      ),
    ];
  }

  // Timing.
  const seconds = num(/(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds)\b/, c);
  const fps = num(/(\d+)\s*fps\b/, c);
  if (/\b(faster|snappier|quicker|speed (it )?up|tighter timing)\b/.test(c)) return [...out, act("retime_clip", { scale: 0.8, stretch: true }, "Retime 20% faster")];
  if (/\b(slower|slow (it )?down|more weight|heavier)\b/.test(c)) return [...out, act("retime_clip", { scale: 1.25, stretch: true }, "Retime 25% slower")];
  if (seconds !== undefined && /\b(length|duration|long|make it|last)\b/.test(c)) return [...out, act("retime_clip", { duration: seconds, stretch: true }, `Clip length ${seconds}s`)];
  if (fps !== undefined) return [...out, act("retime_clip", { fps }, `${fps} fps`)];
  if (/\b(don'?t loop|no loop|loop off|stop looping|play once)\b/.test(c)) return [...out, act("retime_clip", { loop: false }, "Loop off")];
  if (/\b(make it loop|loop it|loop on|looping|loop)\b/.test(c)) return [...out, act("retime_clip", { loop: true }, "Loop on")];

  // Clips, baking, events, skins.
  if (/\b(generate|regenerate|create|synthesi[sz]e|rebuild) (all |the )?(clips|animations|actions|moves)\b/.test(c)) return [act("generate_clips", {}, "Generate clips")];
  if (/\bevent\b|camera shake|\bsfx\b|\bsound\b|\bvfx\b/.test(c) && /\b(add|place|put|insert|fire|trigger)\b/.test(c)) {
    const name = /shake/.test(c) ? "CameraShake" : /\b(sfx|sound|audio)\b/.test(c) ? "PlaySFX" : /\b(vfx|effect|particle)\b/.test(c) ? "SpawnVFX" : "OnHit";
    const frame = num(/frame\s*(\d+)/, c);
    return [act("add_animation_event", { name, ...(frame !== undefined ? { time: frame / ctx.fps } : {}) }, `Event ${name}${frame !== undefined ? ` at frame ${frame}` : ""}`)];
  }
  const skin = c.match(/\b(?:skin|tier)\s+([a-z0-9-]+)/)?.[1];
  if (skin) return [act("set_skin_variant", { skinName: skin }, `Skin ${skin}`)];

  // Tools and selection.
  const mode = c.match(/\b(?:open|switch to|go to|use)\s+(?:the\s+)?(import|auto rig|auto|rig|bones?|mesh|weight paint|weights?|pose|animate|warp|liquify|export)\b/)?.[1];
  if (mode) {
    const map: Record<string, string> = { "auto rig": "auto", bone: "rig", bones: "rig", "weight paint": "weights", weight: "weights", pose: "animate", warp: "liquify" };
    return [...out, act("set_mode", { mode: map[mode] ?? mode }, `Open ${mode}`)];
  }
  if (/\bselect\b/.test(c) && (bones.length > 0 || parts.length > 0)) {
    return [act("select", { ...(bones[0] ? { bone: bones[0] } : {}), ...(parts[0] ? { part: parts[0] } : {}) }, `Select ${bones[0] ?? parts[0]}`)];
  }
  return out;
}

export const EXAMPLE_PROMPTS = [
  "Review this clip",
  "Add anticipation and overshoot",
  "Mesh the body dense with heat weights",
  "Add physics to the cape, then make it snappier",
  "Key all bones, then breakdown 30% on arm",
  "Show onion skin and motion arcs",
];

export function planCommand(prompt: string, ctx: CopilotContext): Plan {
  const clauses = splitClauses(prompt);
  const actions: CopilotAction[] = [];
  const missed: string[] = [];
  for (const c of clauses) {
    const a = planClause(c, ctx);
    if (a.length === 0) missed.push(c);
    actions.push(...a);
  }
  if (actions.length === 0) {
    return {
      reply: `I couldn't map that to a tool. Try: “${EXAMPLE_PROMPTS[1]}”, “${EXAMPLE_PROMPTS[2]}” or “${EXAMPLE_PROMPTS[3]}”.`,
      actions,
    };
  }
  const reply = missed.length > 0 ? `I skipped “${missed.join("”, “")}” because I couldn't map it to a tool.` : "";
  return { reply, actions };
}
