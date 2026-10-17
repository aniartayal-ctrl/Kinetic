/**
 * 2.5D Parallax Look-At Controller, Auto Eye-Blink & Voice Lip-Sync Engine
 * (`src/core/parallax-and-lipsync.ts`)
 *
 * Implements:
 * 1. Live2D / Spine-style 2.5D Pseudo-3D Parallax Turn:
 *    - Foreground layers (`weapon`, `forearm`, `head`, `pauldron`) shift with positive parallax
 *    - Midground (`chest`, `hips`) shifts with moderate parallax and horizontal foreshortening
 *    - Background (`cape`, `cape-tail`, `hair-*`, `arm-back`) shifts with inverse Z-depth parallax
 *      so rotating toward the cursor or reel spin creates true 2.5D volume from 2D cut-outs.
 * 2. Procedural Eye-Blink & Voice / Audio Envelope Lip-Sync:
 *    - Synthesizes phoneme jaw/head/chest breath & speech curves from voice battle-cries or
 *      raw audio RMS amplitude envelopes.
 */

import type { AnimationClip, SpineForgeProject, TransformKey } from "./schema";
import type { BonePose } from "./solver";

export type ParallaxLookAtConfig = {
  enabled: boolean;
  /** Normalized horizontal look target [-1 = far left, 0 = center, +1 = far right]. */
  lookX: number;
  /** Normalized vertical look target [-1 = up, 0 = center, +1 = down]. */
  lookY: number;
  /** Depth parallax intensity multiplier [0..2, default 1.0]. */
  depthIntensity: number;
  /** Whether to automatically orbit the look target toward spinning reels / figure-8 when not hovering. */
  autoOrbit: boolean;
};

export const DEFAULT_PARALLAX_CONFIG: ParallaxLookAtConfig = {
  enabled: true,
  lookX: 0,
  lookY: 0,
  depthIntensity: 1.0,
  autoOrbit: true,
};

export type VoicePhrasePreset = {
  id: string;
  label: string;
  transcript: string;
  duration: number;
  /** Envelope samples at 24Hz [0..1]. */
  envelope: number[];
};

export const VOICE_PHRASE_PRESETS: VoicePhrasePreset[] = [
  {
    id: "battle_cry",
    label: "Battle Cry: 'BY THE ASTRAL FORGE!'",
    transcript: "BY THE ASTRAL FORGE!",
    duration: 2.0,
    envelope: [
      0.0, 0.25, 0.85, 0.65, 0.15, 0.75, 0.95, 0.8, 0.35, 0.9, 1.0, 0.85,
      0.4, 0.2, 0.95, 1.0, 0.9, 0.75, 0.5, 0.25, 0.1, 0.0, 0.0, 0.0,
    ],
  },
  {
    id: "olympus_roar",
    label: "Olympus Cast: 'FEEL THE THUNDER!'",
    transcript: "FEEL THE THUNDER!",
    duration: 1.9,
    envelope: [
      0.0, 0.4, 0.9, 0.7, 0.2, 0.6, 0.85, 0.3, 0.95, 1.0, 0.92, 0.75,
      0.88, 0.65, 0.35, 0.15, 0.05, 0.0, 0.0, 0.0,
    ],
  },
  {
    id: "jackpot_call",
    label: "Jackpot Call: 'SENSATIONAL MEGA WIN!'",
    transcript: "SENSATIONAL MEGA WIN!",
    duration: 2.5,
    envelope: [
      0.0, 0.7, 0.95, 0.5, 0.85, 0.9, 0.4, 0.2, 0.88, 1.0, 0.6, 0.3,
      0.92, 1.0, 0.95, 0.8, 0.55, 0.3, 0.1, 0.0, 0.0,
    ],
  },
];

/**
 * Computes per-bone 2.5D parallax pose offsets `(r, x, y, sx, sy)` for a given look target `(lookX, lookY)`.
 */
export function compute25DParallaxBoneOffsets(
  project: Pick<SpineForgeProject, "height" | "bones">,
  config: ParallaxLookAtConfig,
  time: number,
): Record<string, BonePose> {
  const out: Record<string, BonePose> = {};
  if (!config.enabled) return out;

  const u = project.height / 1000;
  const depth = Math.max(0, Math.min(2, config.depthIntensity));

  // If autoOrbit is enabled and lookX/Y are near zero, add a subtle living figure-8 gaze + eye blink
  const lx =
    Math.abs(config.lookX) > 0.02 || !config.autoOrbit
      ? Math.max(-1, Math.min(1, config.lookX))
      : Math.sin(time * 1.45) * 0.42;
  const ly =
    Math.abs(config.lookY) > 0.02 || !config.autoOrbit
      ? Math.max(-1, Math.min(1, config.lookY))
      : Math.sin(time * 2.9) * 0.22;

  // Periodic natural eye-blink / head micro-nod every 3.4s
  const blinkPhase = time % 3.4;
  const blinkSquash =
    blinkPhase > 3.15 && blinkPhase < 3.32
      ? Math.sin(((blinkPhase - 3.15) / 0.17) * Math.PI) * 0.028
      : 0;

  for (const bone of project.bones) {
    const low = bone.name.toLowerCase();
    let dx = 0;
    let dy = 0;
    let dr = 0;
    let sx = 1;
    let sy = 1;

    if (low === "head") {
      // Foreground Z-plane (+1.0): strong horizontal & vertical parallax + foreshortening
      dx = lx * 14 * u * depth;
      dy = ly * 9 * u * depth;
      dr = lx * 6.5 * depth + ly * 3.0 * depth;
      sx = 1 - Math.abs(lx) * 0.045 * depth;
      sy = 1 - blinkSquash;
    } else if (low === "chest") {
      // Mid-foreground Z-plane (+0.45): torso yaw twist
      dx = lx * 6.5 * u * depth;
      dy = ly * 3.5 * u * depth;
      dr = lx * 2.8 * depth;
      sx = 1 - Math.abs(lx) * 0.022 * depth;
    } else if (low === "hips") {
      // Fulcrum Z-plane (+0.15): slight counter-hip shift for balance
      dx = -lx * 2.5 * u * depth;
      dr = -lx * 1.1 * depth;
    } else if (low.includes("pauldron") || low === "arm") {
      // Near shoulder (+0.65): shifts forward when turning right
      dx = lx * 9.5 * u * depth;
      dy = ly * 4.5 * u * depth;
      dr = lx * 3.5 * depth;
    } else if (low === "forearm" || low === "weapon") {
      // Extreme foreground prop (+0.85)
      dx = lx * 11 * u * depth;
      dy = ly * 6 * u * depth;
      dr = lx * 4.2 * depth;
    } else if (low === "arm-back") {
      // Far shoulder (-0.45): inverse horizontal parallax for 2.5D torso wrap-around
      dx = -lx * 7.5 * u * depth;
      dy = -ly * 3.0 * u * depth;
      dr = -lx * 3.0 * depth;
    } else if (low.includes("cape") || low.includes("hair") || low.includes("hem")) {
      // Background Z-plane (-0.55): moves opposite to head look direction
      dx = -lx * 9.0 * u * depth;
      dy = -ly * 4.0 * u * depth;
      dr = -lx * 4.5 * depth;
    }

    out[bone.name] = { r: dr, x: dx, y: dy, sx, sy };
  }

  return out;
}

/**
 * Generates lip-sync & vocalization bone keyframes onto `head` and `chest` from a `VoicePhrasePreset`
 * or custom amplitude envelope, and returns the updated `AnimationClip`.
 */
export function applyVoiceLipSyncToClip(
  project: Pick<SpineForgeProject, "height" | "bones">,
  clip: AnimationClip,
  phraseId = "battle_cry",
): AnimationClip {
  const preset = VOICE_PHRASE_PRESETS.find((p) => p.id === phraseId) ?? VOICE_PHRASE_PRESETS[0]!;
  const u = project.height / 1000;
  const env = preset.envelope;
  const dt = clip.duration / Math.max(1, env.length - 1);

  const headKeys: TransformKey[] = [];
  const chestKeys: TransformKey[] = [];

  for (let i = 0; i < env.length; i++) {
    const t = Number((i * dt).toFixed(3));
    const amp = env[i]!;
    // Phoneme jaw/head stretch + pitch accent on loud syllables
    headKeys.push({
      time: t,
      r: Number((-amp * 7.5 + Math.sin(i * 1.7) * amp * 2.5).toFixed(2)),
      y: Number((-amp * 4.5 * u).toFixed(2)),
      sy: Number((1 + amp * 0.048).toFixed(4)),
      sx: Number((1 - amp * 0.024).toFixed(4)),
    });
    chestKeys.push({
      time: t,
      r: Number((-amp * 3.2).toFixed(2)),
      sy: Number((1 + amp * 0.026).toFixed(4)),
      sx: Number((1 - amp * 0.014).toFixed(4)),
    });
  }

  return {
    ...clip,
    boneTracks: {
      ...clip.boneTracks,
      head: headKeys,
      chest: chestKeys,
    },
    events: [
      ...(clip.events ?? []),
      {
        time: 0.05,
        name: "PlayVoiceLine",
        stringParam: preset.id,
        floatParam: 1.0,
      },
    ],
  };
}
