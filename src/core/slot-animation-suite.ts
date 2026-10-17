/**
 * Slot Game Animation Suite Engine (`src/core/slot-animation-suite.ts`)
 *
 * Purpose-built for commercial iGaming & Slot Studios (Pragmatic Play / Hacksaw / Nolimit / Evolution style):
 * 1. 4-Tier Big Win Escalation & Odometer Roll-Up Director (NICE 15× -> MEGA 30× -> SUPERB 45× -> SENSATIONAL 60×+)
 * 2. Tumble / Cascade Physics & Multiplier Bomb (2×..500×) Projectile Beam Choreographer
 * 3. 2-Scatter Reel Anticipation Bezel Fire & Feature Splash Banner Choreographer (Free Spins, Super Free Spins, Jackpot, Hold & Spin)
 * 4. Dual-Orientation Safe-Zone Layout Engine (Desktop Landscape 16:9 2500×1000 vs Mobile Portrait 9:16 1080×1920)
 * 5. Complete Unity `.slotanim.json` Slot Suite Manifest Exporter
 */

import { getSlotStageContext, type SlotSymbolRole } from "./batch-symbols-and-slot-stage";
import type { SpineForgeProject } from "./schema";
import type { ElementalVfxType } from "./vfx-colliders-profiler";

export type SlotSuiteStageMode =
  | "off"
  | "reel_tumble_cascade"
  | "big_win_ladder"
  | "scatter_anticipation"
  | "feature_splash"
  | "hold_and_spin_coins";

export type SlotOrientationMode = "landscape_16_9" | "portrait_9_16";

export type BigWinTierId = "nice" | "mega" | "superb" | "sensational";

export type BigWinTierSpec = {
  tier: BigWinTierId;
  label: string;
  multiplierThreshold: number;
  heroClip: string;
  vfx: ElementalVfxType;
  skinName: "default" | "awakened" | "ascended";
  glowHex: string;
};

export const BIG_WIN_LADDER: BigWinTierSpec[] = [
  {
    tier: "nice",
    label: "NICE WIN",
    multiplierThreshold: 15,
    heroClip: "cheer",
    vfx: "star_sparks",
    skinName: "default",
    glowHex: "#ffd77a",
  },
  {
    tier: "mega",
    label: "MEGA WIN",
    multiplierThreshold: 30,
    heroClip: "strike",
    vfx: "shockwave_rings",
    skinName: "awakened",
    glowHex: "#38bdf8",
  },
  {
    tier: "superb",
    label: "SUPERB WIN",
    multiplierThreshold: 45,
    heroClip: "power",
    vfx: "lightning_bolts",
    skinName: "awakened",
    glowHex: "#c084fc",
  },
  {
    tier: "sensational",
    label: "SENSATIONAL WIN",
    multiplierThreshold: 60,
    heroClip: "triumph",
    vfx: "coin_fountain",
    skinName: "ascended",
    glowHex: "#fb923c",
  },
];

export type EvaluatedBigWinFrame = {
  activeTier: BigWinTierSpec;
  tierIndex: number;
  /** Current rolled-up payout amount ($). */
  currentPayout: number;
  /** Current rolled-up multiplier (e.g. 48.5×). */
  currentMultiplier: number;
  /** Banner squash & stretch scale [sx, sy]. */
  bannerScale: [number, number];
  /** Odometer plaque pulse scale. */
  plaqueScale: number;
  /** Starburst rays rotation angle in degrees. */
  rayRotationDeg: number;
  /** Tier transition flash intensity [0..1]. */
  tierCrossFlash: number;
};

/**
 * Evaluates a complete 4-tier Big Win celebration + odometer roll-up at normalized progress `u` in [0..1].
 */
export function evaluateBigWinChoreography(
  u: number,
  baseBet = 100,
  maxMultiplier = 75,
): EvaluatedBigWinFrame {
  const progress = Math.max(0, Math.min(1, u));
  // Ease out near the final peak so the odometer savors the final tier
  const curved = 1 - Math.pow(1 - progress, 1.35);
  const currentMultiplier = Number((curved * maxMultiplier).toFixed(1));
  const currentPayout = Number((currentMultiplier * baseBet).toFixed(2));

  let tierIndex = 0;
  for (let i = 0; i < BIG_WIN_LADDER.length; i++) {
    if (currentMultiplier >= BIG_WIN_LADDER[i]!.multiplierThreshold) {
      tierIndex = i;
    }
  }
  const activeTier = BIG_WIN_LADDER[tierIndex]!;

  // Compute local progress within current tier to trigger elastic pop on tier crossover
  const prevThresh = tierIndex === 0 ? 0 : BIG_WIN_LADDER[tierIndex]!.multiplierThreshold;
  const sinceCross = Math.max(0, currentMultiplier - prevThresh);
  const popDecay = Math.exp(-sinceCross * 0.35);
  const popWave = Math.cos(sinceCross * 1.8) * popDecay;

  const sy = Number((1 + popWave * 0.24).toFixed(4));
  const sx = Number((1 / Math.pow(Math.max(0.75, sy), 0.65)).toFixed(4));
  const plaqueScale = Number((1 + Math.abs(Math.sin(progress * Math.PI * 12)) * 0.04 + popDecay * 0.12).toFixed(4));

  return {
    activeTier,
    tierIndex,
    currentPayout,
    currentMultiplier,
    bannerScale: [sx, sy],
    plaqueScale,
    rayRotationDeg: Number((progress * 180).toFixed(1)),
    tierCrossFlash: Number(popDecay.toFixed(3)),
  };
}

export type EvaluatedReelCellState = {
  col: number;
  row: number;
  role: SlotSymbolRole;
  /** Y offset in cell heights (-1.5 = dropping from above, 0 = landed). */
  offsetY: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  isWinning: boolean;
  /** Optional multiplier orb badge on this cell (e.g. "25×", "100×", "500×"). */
  multiplierBadge?: string;
};

export type EvaluatedTumbleCascadeFrame = {
  phase: "drop_in" | "payline_pop" | "shatter_and_beam" | "cascade_refill";
  cells: EvaluatedReelCellState[];
  /** Projectile beam from multiplier orb [startX, startY, endX, endY, progress 0..1] in normalized grid coords. */
  multiplierBeam?: {
    fromCol: number;
    fromRow: number;
    label: string;
    progress: number;
  };
  plaqueMultiplierText: string;
  plaqueBounceScale: number;
};

/**
 * Evaluates a 4-phase Tumble / Cascade + Multiplier Orb (`500×`) sequence over a 2.0s cycle.
 */
export function evaluateTumbleCascadeChoreography(
  themeId: string,
  timeSec: number,
  cycleDuration = 2.0,
): EvaluatedTumbleCascadeFrame {
  const t = ((timeSec % cycleDuration) + cycleDuration) % cycleDuration;
  const u = t / cycleDuration; // 0..1
  const ctx = getSlotStageContext(themeId);

  const phase: EvaluatedTumbleCascadeFrame["phase"] =
    u < 0.25
      ? "drop_in"
      : u < 0.58
        ? "payline_pop"
        : u < 0.78
          ? "shatter_and_beam"
          : "cascade_refill";

  const cells: EvaluatedReelCellState[] = [];

  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 3; r++) {
      const baseRole = ctx.reelGrid[c]?.[r] ?? "l1";
      const isWinning = r === 1; // Middle payline wins
      const isMultiplierOrb = c === 2 && r === 1;

      let offsetY = 0;
      let scaleX = 1;
      let scaleY = 1;
      let opacity = 1;

      if (phase === "drop_in") {
        const delay = c * 0.035 + r * 0.02;
        const localU = Math.max(0, Math.min(1, (u - delay) / 0.16));
        offsetY = -(1 - localU * localU) * 1.6;
        if (localU > 0.85) {
          // Landing squash
          scaleY = 0.86;
          scaleX = 1.12;
        }
      } else if (phase === "payline_pop" && isWinning) {
        const localU = (u - 0.25) / 0.33;
        const pulse = Math.sin(localU * Math.PI);
        scaleX = 1 + pulse * 0.24;
        scaleY = 1 + pulse * 0.24;
      } else if (phase === "shatter_and_beam" && isWinning) {
        const localU = (u - 0.58) / 0.2;
        scaleX = 1.24 + localU * 0.45;
        scaleY = Math.max(0.05, 1.24 * (1 - localU));
        opacity = Math.max(0, 1 - localU * 1.2);
      } else if (phase === "cascade_refill" && isWinning) {
        const localU = (u - 0.78) / 0.22;
        offsetY = -(1 - localU) * 1.2;
        scaleY = localU > 0.8 ? 0.92 : 1;
        scaleX = localU > 0.8 ? 1.06 : 1;
      }

      cells.push({
        col: c,
        row: r,
        role: phase === "cascade_refill" && isWinning ? "wild" : baseRole,
        offsetY: Number(offsetY.toFixed(3)),
        scaleX: Number(scaleX.toFixed(3)),
        scaleY: Number(scaleY.toFixed(3)),
        opacity: Number(opacity.toFixed(3)),
        isWinning,
        ...(isMultiplierOrb ? { multiplierBadge: "500×" } : c === 4 && r === 1 ? { multiplierBadge: "25×" } : {}),
      });
    }
  }

  let multiplierBeam: EvaluatedTumbleCascadeFrame["multiplierBeam"];
  if (phase === "shatter_and_beam") {
    const beamU = Math.max(0, Math.min(1, (u - 0.58) / 0.18));
    multiplierBeam = {
      fromCol: 2,
      fromRow: 1,
      label: "500×",
      progress: Number(beamU.toFixed(3)),
    };
  }

  const hitPlaque = u >= 0.75;
  const plaqueBounceScale =
    u >= 0.75 && u <= 0.92 ? Number((1 + Math.sin(((u - 0.75) / 0.17) * Math.PI) * 0.28).toFixed(3)) : 1;

  return {
    phase,
    cells,
    multiplierBeam,
    plaqueMultiplierText: hitPlaque ? "TOTAL WIN ×525 ($52,500.00)" : "TUMBLE WIN $100.00",
    plaqueBounceScale,
  };
}

export type SlotSafeZoneLayout = {
  orientation: SlotOrientationMode;
  canvasSize: [number, number];
  /** Normalized [x, y, w, h] for the 5×3 Reel Box. */
  reelBox: [number, number, number, number];
  /** Normalized [x, y, w, h] for the Hero Character Stage. */
  heroBox: [number, number, number, number];
  /** Normalized [x, y, w, h] for the Top Win / Multiplier Plaque. */
  plaqueBox: [number, number, number, number];
  /** Normalized [x, y, w, h] for the Big Win / Feature Splash Title. */
  splashTitleBox: [number, number, number, number];
};

/**
 * Returns dual-orientation safe-zone layout coordinates for Desktop Landscape (16:9) vs Mobile Portrait (9:16).
 */
export function getSlotSafeZoneLayout(orientation: SlotOrientationMode): SlotSafeZoneLayout {
  if (orientation === "portrait_9_16") {
    return {
      orientation: "portrait_9_16",
      canvasSize: [1080, 1920],
      heroBox: [0.22, 0.04, 0.56, 0.34],
      plaqueBox: [0.12, 0.36, 0.76, 0.07],
      reelBox: [0.06, 0.44, 0.88, 0.42],
      splashTitleBox: [0.08, 0.18, 0.84, 0.16],
    };
  }
  return {
    orientation: "landscape_16_9",
    canvasSize: [2500, 1000],
    reelBox: [0.3, 0.1, 0.4, 0.74],
    heroBox: [0.71, 0.08, 0.25, 0.82],
    plaqueBox: [0.35, 0.02, 0.3, 0.08],
    splashTitleBox: [0.28, 0.22, 0.44, 0.28],
  };
}

export type UnitySlotSuiteManifest = {
  format: "KineticSlotAnimationSuite";
  version: "1.0.0";
  themeId: string;
  heroRigFile: string;
  symbolRigs: {
    role: SlotSymbolRole;
    label: string;
    rigFile: string;
    defaultWinClip: string;
  }[];
  bigWinLadder: BigWinTierSpec[];
  tumblePhysics: {
    dropDurationSec: number;
    columnStaggerSec: number;
    rowStaggerSec: number;
    landingSquashScale: [number, number];
    paylinePopScale: number;
    multiplierProjectileSpeedPx: number;
  };
  layouts: {
    landscape: SlotSafeZoneLayout;
    portrait: SlotSafeZoneLayout;
  };
};

export function buildUnitySlotSuiteManifest(project: SpineForgeProject): UnitySlotSuiteManifest {
  const themeId = project.id.includes("solara") ? "sands-of-solara" : "astral-forge";
  const ctx = getSlotStageContext(themeId);

  return {
    format: "KineticSlotAnimationSuite",
    version: "1.0.0",
    themeId,
    heroRigFile: `${themeId}.sfrig.json`,
    symbolRigs: ctx.symbols.map((s) => ({
      role: s.role,
      label: s.label,
      rigFile: `${themeId}-symbol-${s.role}.sfrig.json`,
      defaultWinClip: s.defaultClip,
    })),
    bigWinLadder: BIG_WIN_LADDER,
    tumblePhysics: {
      dropDurationSec: 0.32,
      columnStaggerSec: 0.06,
      rowStaggerSec: 0.03,
      landingSquashScale: [1.12, 0.86],
      paylinePopScale: 1.24,
      multiplierProjectileSpeedPx: 1850,
    },
    layouts: {
      landscape: getSlotSafeZoneLayout("landscape_16_9"),
      portrait: getSlotSafeZoneLayout("portrait_9_16"),
    },
  };
}
