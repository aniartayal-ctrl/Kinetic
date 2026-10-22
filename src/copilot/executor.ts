/**
 * Copilot executor (client). Runs catalog actions against the studio store.
 *
 * Every action is validated (names must exist, values are clamped) and isolated in try/catch, so
 * a malformed action from a cloud model reports an error instead of breaking the studio.
 */

import { EASE_BACK_OUT, EASE_POWER2_IN, EASE_POWER2_OUT, EASE_SINE_IN_OUT } from "@/core/animator";
import { applyAllCues, reviewClip } from "@/core/coach";
import type { CopilotAction, CopilotContext } from "@/core/copilot/tools";
import { keyPreservingShape, setKeyChannel, type Channel } from "@/core/keyframes";
import type { CurveType } from "@/core/schema";
import { useStudioStore, type StudioMode } from "@/store/useStudioStore";

export type ActionResult = { action: CopilotAction; ok: boolean; message: string };
export type ExecutorHost = {
  exportBundle: () => Promise<void>;
  /** Resolves false when the save did not reach disk. */
  save: () => Promise<boolean>;
  openBudget: () => void;
  /** Opens a project by (partial) name; no name shows the project list. Returns a status line. */
  openProject: (name?: string) => Promise<string>;
};

const OVERLAY_KEYS = {
  bones: "showBones",
  mesh: "showMeshWireframe",
  heatmap: "showHeatmap",
  onion: "showOnionSkin",
  arcs: "showMotionArcs",
  trail: "showSlashTrail",
  lighting: "enable3DRelight",
  hitboxes: "showHitboxes",
  reels: "showSlotStage",
  solo: "isolatePart",
} as const;

const CURVES: Record<string, CurveType> = {
  linear: "linear",
  ease: EASE_SINE_IN_OUT,
  ease_in: EASE_POWER2_IN,
  ease_out: EASE_POWER2_OUT,
  overshoot: EASE_BACK_OUT,
  stepped: "stepped",
};

const MODES: StudioMode[] = ["import", "auto", "rig", "mesh", "weights", "animate", "liquify", "export"];

/** Older action names some saved prompts or models still emit. */
const ALIASES: Record<string, string> = {
  set_keyframe_pose: "set_key",
  select_target: "select",
  trigger_unity_export: "export",
  auto_rig_project: "auto_rig",
  regenerate_procedural_clips: "generate_clips",
};

class ActionError extends Error {}
const fail = (msg: string): never => {
  throw new ActionError(msg);
};
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const numArg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function copilotContext(): CopilotContext {
  const s = useStudioStore.getState();
  const clip = s.project.animations[s.activeClip];
  return {
    bones: s.project.bones.map((b) => b.name),
    parts: s.project.parts.map((p) => p.name),
    clips: Object.keys(s.project.animations),
    ikNames: (s.project.ikConstraints ?? []).map((k) => k.name),
    activeClip: s.activeClip,
    selectedBone: s.selectedBone,
    selectedPart: s.selectedPart,
    currentTime: s.currentTime,
    duration: clip?.duration ?? 1,
    fps: clip?.fps || 30,
  };
}

function boneList(v: unknown): string[] {
  const s = useStudioStore.getState();
  const names = s.project.bones.map((b) => b.name);
  if (v === "all") return names;
  const list = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : s.selectedBone ? [s.selectedBone] : [];
  const unknown = list.filter((n) => !names.includes(n));
  if (unknown.length > 0) fail(`No bone named ${unknown.join(", ")}`);
  if (list.length === 0) fail("Select a bone first");
  return list;
}

function requireBone(v: unknown): string {
  const name = str(v) ?? fail("Missing bone name");
  if (!useStudioStore.getState().project.bones.some((b) => b.name === name)) fail(`No bone named ${name}`);
  return name;
}

function requirePart(v: unknown): string {
  const name = str(v) ?? useStudioStore.getState().selectedPart ?? fail("Missing layer name");
  if (!useStudioStore.getState().project.parts.some((p) => p.name === name)) fail(`No layer named ${name}`);
  return name;
}

async function runOne(action: CopilotAction, host: ExecutorHost): Promise<string> {
  const s = useStudioStore.getState();
  const a = action.args ?? {};
  const clip = s.project.animations[s.activeClip];
  const fps = clip?.fps || 30;
  const tool = ALIASES[action.tool] ?? action.tool;

  switch (tool) {
    case "select": {
      if (a.clip !== undefined) {
        const c = str(a.clip)!;
        if (!s.project.animations[c]) fail(`No clip named ${c}`);
        s.setActiveClip(c);
      }
      if (a.bone !== undefined) s.selectBone(requireBone(a.bone));
      if (a.part !== undefined) s.selectPart(requirePart(a.part));
      return "Selected";
    }
    case "set_mode": {
      const mode = str(a.mode) as StudioMode;
      if (!MODES.includes(mode)) fail(`Unknown tool ${String(a.mode)}`);
      const tool = str(a.tool);
      if (tool !== undefined && !["pose", "rotate", "translate", "scale"].includes(tool)) fail(`Unknown transform tool ${tool}`);
      if (mode === "auto") s.runOneClickAutoRig();
      if (mode === "export") await host.exportBundle();
      else s.chooseTool(mode, tool as "pose" | "rotate" | "translate" | "scale" | undefined);
      return tool ? `${tool[0]!.toUpperCase()}${tool.slice(1)} tool` : `Opened ${mode}`;
    }
    case "toggle_overlay": {
      const key = OVERLAY_KEYS[str(a.overlay) as keyof typeof OVERLAY_KEYS] ?? fail(`Unknown overlay ${String(a.overlay)}`);
      const current = (s as unknown as Record<string, boolean>)[key];
      if (typeof a.on !== "boolean" || a.on !== current) s.toggleOverlay(key);
      return `${String(a.overlay)} ${useStudioStore.getState()[key] ? "on" : "off"}`;
    }
    case "playback": {
      const speed = numArg(a.speed);
      if (speed) s.setPlaybackSpeed(clamp(speed, 0.1, 4));
      if (a.action === "play") s.setIsPlaying(true);
      else if (a.action === "pause") s.setIsPlaying(false);
      else if (a.action === "toggle" && !speed) s.setIsPlaying(!s.isPlaying);
      return a.action === "pause" ? "Paused" : speed ? `Speed ${speed}×` : "Playing";
    }
    case "go_to": {
      if (!clip) fail("No clip open");
      let t = numArg(a.time) ?? (numArg(a.frame) !== undefined ? numArg(a.frame)! / fps : undefined);
      if (a.key) {
        const times = [...new Set(Object.values(clip!.boneTracks).flatMap((tr) => tr.map((k) => k.time)))].sort((x, y) => x - y);
        if (a.key === "first") t = 0;
        else if (a.key === "last") t = clip!.duration;
        else if (a.key === "next") t = times.find((x) => x > s.currentTime + 1e-4);
        else t = [...times].reverse().find((x) => x < s.currentTime - 1e-4);
        if (t === undefined) fail(`No ${String(a.key)} key`);
      }
      if (t === undefined) fail("Missing time");
      s.setIsPlaying(false);
      s.setCurrentTime(clamp(t!, 0, clip!.duration));
      return `Frame ${Math.round(t! * fps)}`;
    }
    case "auto_rig":
      s.runOneClickAutoRig();
      return "Rigged, meshed, weighted and generated clips";
    case "add_bone": {
      const name = (str(a.name) ?? fail("Missing bone name")).trim().replace(/\s+/g, "-");
      if (s.project.bones.some((b) => b.name === name)) fail(`Bone ${name} already exists`);
      const parent = requireBone(a.parent ?? s.selectedBone ?? s.project.bones[0]?.name);
      const p = s.project.bones.find((b) => b.name === parent)!;
      s.addBone(parent, name, clamp(numArg(a.x) ?? p.x + 0.05, 0, 1), clamp(numArg(a.y) ?? p.y - 0.08, 0, 1));
      return `Added ${name} under ${parent}`;
    }
    case "move_pivot": {
      const bone = requireBone(a.bone);
      const x = numArg(a.x) ?? fail("Missing x");
      const y = numArg(a.y) ?? fail("Missing y");
      s.updateBone(bone, { x: clamp(x, 0, 1), y: clamp(y, 0, 1) });
      return `Moved ${bone} pivot`;
    }
    case "configure_ik": {
      const iks = s.project.ikConstraints ?? [];
      const ik = iks.find((k) => k.name === (str(a.ikName) ?? iks[0]?.name)) ?? fail("This rig has no IK constraint");
      const mix = clamp(numArg(a.mix) ?? ik.mix, 0, 1);
      const bend = a.bendPositive === "toggle" ? !ik.bendPositive : typeof a.bendPositive === "boolean" ? a.bendPositive : ik.bendPositive;
      s.updateIkMix(ik.name, mix, bend);
      return `${ik.name}: ${Math.round(mix * 100)}%`;
    }
    case "configure_spring_physics": {
      const bone = requireBone(a.bone);
      const existing = s.project.bones.find((b) => b.name === bone)!.spring;
      if (a.enabled === false) {
        s.updateBone(bone, { spring: undefined });
        return `Removed physics from ${bone}`;
      }
      s.updateBone(bone, {
        spring: {
          stiffness: clamp(numArg(a.stiffness) ?? existing?.stiffness ?? 60, 5, 200),
          damping: clamp(numArg(a.damping) ?? existing?.damping ?? 6, 0.5, 40),
          gain: existing?.gain ?? [7, 3],
          wind: clamp(numArg(a.wind) ?? existing?.wind ?? 1.2, 0, 10),
        },
      });
      return `Physics on ${bone}`;
    }
    case "lock_bone": {
      const bone = requireBone(a.bone);
      const want = a.locked !== false;
      if (s.lockedBones.includes(bone) !== want) s.toggleBoneLock(bone);
      return `${want ? "Locked" : "Unlocked"} ${bone}`;
    }
    case "configure_mesh_and_weights": {
      const density = str(a.density) ?? "medium";
      const mode = str(a.weightMode) ?? "hybrid";
      if (!["low", "medium", "high"].includes(density)) fail(`Unknown density ${density}`);
      if (!["hybrid", "heat", "capsule"].includes(mode)) fail(`Unknown weight mode ${mode}`);
      const parts = a.part === "all" ? s.project.parts.map((p) => p.name) : [requirePart(a.part)];
      for (const part of parts) {
        useStudioStore.getState().regeneratePartMesh(part, density as "low" | "medium" | "high", mode as "hybrid" | "heat" | "capsule");
      }
      return `Meshed ${parts.length === 1 ? parts[0] : `${parts.length} layers`}`;
    }
    case "reset_warp": {
      const part = requirePart(a.part);
      s.resetPartLiquifyDeform(part);
      return `Reset warp on ${part}`;
    }
    case "set_key": {
      if (!clip) fail("No clip open");
      if (numArg(a.time) !== undefined) s.setCurrentTime(clamp(numArg(a.time)!, 0, clip!.duration));
      const t = Number(useStudioStore.getState().currentTime.toFixed(4));
      const bones = boneList(a.bones);
      const values = (["r", "x", "y", "sx", "sy"] as Channel[]).filter((ch) => numArg(a[ch]) !== undefined);
      useStudioStore.getState().editActiveClip((c) => {
        const boneTracks = { ...c.boneTracks };
        for (const b of bones) {
          let tr = keyPreservingShape(boneTracks[b] ?? [], t);
          const idx = tr.findIndex((k) => Math.abs(k.time - t) < 1e-4);
          for (const ch of values) tr = setKeyChannel(tr, idx, ch, numArg(a[ch])!);
          boneTracks[b] = tr;
        }
        return { ...c, boneTracks };
      }, `Copilot keyed ${bones.length === 1 ? bones[0] : `${bones.length} bones`}`);
      return `Keyed ${bones.length === 1 ? bones[0] : `${bones.length} bones`} at frame ${Math.round(t * fps)}`;
    }
    case "breakdown": {
      const fraction = clamp(numArg(a.fraction) ?? 0.5, -0.5, 1.5);
      s.insertBreakdown(fraction, a.bones === undefined ? undefined : boneList(a.bones));
      return `Breakdown ${Math.round(fraction * 100)}%`;
    }
    case "copy_pose":
      s.copyPose();
      return "Pose copied";
    case "paste_pose": {
      if (!s.poseClipboard) fail("Copy a pose first");
      if (numArg(a.time) !== undefined && clip) s.setCurrentTime(clamp(numArg(a.time)!, 0, clip.duration));
      useStudioStore.getState().pastePose();
      return "Pose pasted";
    }
    case "set_curve": {
      const curve = CURVES[str(a.curve) ?? ""] ?? fail(`Unknown curve ${String(a.curve)}`);
      const bones = boneList(a.bones ?? "all");
      s.editActiveClip(
        (c) => ({
          ...c,
          boneTracks: Object.fromEntries(
            Object.entries(c.boneTracks).map(([b, tr]) => [b, bones.includes(b) ? tr.map((k) => ({ ...k, curve })) : tr]),
          ),
        }),
        `Copilot ${String(a.curve)} curves`,
      );
      return `${String(a.curve).replace("_", " ")} on ${bones.length === s.project.bones.length ? "every bone" : bones.join(", ")}`;
    }
    case "retime_clip": {
      if (!clip) fail("No clip open");
      const scale = numArg(a.scale);
      const duration = scale ? clip!.duration * clamp(scale, 0.1, 10) : numArg(a.duration);
      const fpsArg = numArg(a.fps);
      if (fpsArg !== undefined && ![24, 30, 60].includes(fpsArg)) fail("Frame rate must be 24, 30 or 60");
      s.setClipTiming({
        ...(duration !== undefined ? { duration: clamp(duration, 0.05, 60) } : {}),
        ...(fpsArg !== undefined ? { fps: fpsArg } : {}),
        ...(typeof a.loop === "boolean" ? { loop: a.loop } : {}),
        stretch: a.stretch !== false,
      });
      const c2 = useStudioStore.getState().project.animations[s.activeClip]!;
      return `${c2.duration.toFixed(2)}s · ${c2.fps} fps · ${c2.loop ? "loops" : "plays once"}`;
    }
    case "generate_clips":
      s.regenerateAllProceduralClips();
      return "Clips regenerated";
    case "bake_springs_to_keys":
      s.bakeCurrentClipSprings();
      return "Physics baked into keys";
    case "add_animation_event": {
      const name = str(a.name) ?? "OnHit";
      if (!["OnHit", "SpawnVFX", "PlaySFX", "CameraShake"].includes(name)) fail(`Unknown event ${name}`);
      if (numArg(a.time) !== undefined && clip) s.setCurrentTime(clamp(numArg(a.time)!, 0, clip.duration));
      useStudioStore.getState().addAnimationEventAtCurrentTime(name, `fx_${s.activeClip}_${name.toLowerCase()}`, 1);
      return `${name} event added`;
    }
    case "review": {
      const cards = reviewClip(s.project, s.activeClip);
      return cards.length === 0 ? "This clip reads well against the principles I check." : cards.map((c) => `${c.principle}: ${c.title}`).join("\n");
    }
    case "apply_suggestion": {
      const card = reviewClip(s.project, s.activeClip).find((c) => c.id === str(a.id));
      if (!card) return "Already fine, nothing to change";
      if (!card.apply) return card.detail;
      s.pushHistory(`Coach: ${card.fixLabel}`, card.apply(s.project, s.activeClip));
      return card.fixLabel ?? card.title;
    }
    case "fix_all": {
      const { project, applied } = applyAllCues(s.project, s.activeClip);
      if (applied.length === 0) return "Nothing to fix";
      s.pushHistory(`Coach: ${applied.length} fixes`, project);
      return `Applied ${applied.length} fixes`;
    }
    case "set_skin_variant": {
      const name = str(a.skinName) ?? fail("Missing skin name");
      if (name !== "default" && !(s.project.skins ?? []).some((k) => k.name === name)) fail(`No skin named ${name}`);
      s.setActiveSkin(name);
      return `Skin ${name}`;
    }
    case "check_budget":
      host.openBudget();
      return "Budget opened";
    case "undo":
      s.undo();
      return "Undone";
    case "redo":
      s.redo();
      return "Redone";
    case "save":
      if (!(await host.save())) fail("Not saved. The message under the title says why.");
      return "Saved to the projects folder";
    case "open_project":
      return await host.openProject(str(a.name)?.trim() || undefined);
    case "export":
      await host.exportBundle();
      return "Bundle built";
    default:
      return fail(`Unknown tool ${action.tool}`);
  }
}

export async function executeCopilotActions(actions: CopilotAction[], host: ExecutorHost): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions.slice(0, 40)) {
    try {
      results.push({ action, ok: true, message: await runOne(action, host) });
    } catch (err) {
      results.push({ action, ok: false, message: err instanceof Error ? err.message : "Failed" });
    }
  }
  return results;
}
