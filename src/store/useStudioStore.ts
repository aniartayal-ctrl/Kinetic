"use client";

import { create } from "zustand";
import { bakeClipConstraintsToKeyframes, generateProceduralClips } from "@/core/animator";
import { BUILTIN_PRESETS } from "@/core/presets";
import {
  RIG_BONE_PALETTE,
  type RigBone,
  type RigPart,
  type SpineForgeProject,
  type TransformKey,
} from "@/core/schema";
import {
  buildPartMesh,
  paintMeshWeights,
  type AutoWeightMode,
  type WeightBrushMode,
} from "@/core/weights";

export type StudioMode = "rig" | "mesh" | "weights" | "animate" | "export";

type StudioState = {
  project: SpineForgeProject;
  mode: StudioMode;
  selectedBone: string | null;
  selectedPart: string | null;
  activeClip: string;
  currentTime: number;
  isPlaying: boolean;
  playbackSpeed: number;

  // Viewport overlays
  showMeshWireframe: boolean;
  showBones: boolean;
  showCapsules: boolean;
  showHeatmap: boolean;
  heatmapSingleBone: boolean;
  isolatePart: boolean;

  // Weight brush state
  brushMode: WeightBrushMode;
  brushRadius: number;
  brushStrength: number;
  lockedBones: string[];
  hiddenParts: string[];

  // Actions
  loadPreset: (id: string) => void;
  setProject: (project: SpineForgeProject) => void;
  setMode: (mode: StudioMode) => void;
  selectBone: (name: string | null) => void;
  selectPart: (name: string | null) => void;
  setActiveClip: (clipName: string) => void;
  setCurrentTime: (time: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  toggleOverlay: (
    key: "showMeshWireframe" | "showBones" | "showCapsules" | "showHeatmap" | "heatmapSingleBone" | "isolatePart",
  ) => void;
  togglePartVisibility: (partName: string) => void;
  movePartLayerOrder: (partName: string, direction: "up" | "down") => void;

  // Rigging mutations
  updateBone: (boneName: string, patch: Partial<RigBone>) => void;
  addBone: (parentBoneName: string, name: string, x: number, y: number) => void;
  updatePart: (partName: string, patch: Partial<RigPart>) => void;
  updateIkMix: (ikName: string, mix: number, bendPositive?: boolean) => void;

  // Mesh & Weight mutations
  regeneratePartMesh: (partName: string, density: "low" | "medium" | "high", weightMode: AutoWeightMode) => void;
  applyWeightBrush: (partName: string, rigX: number, rigY: number) => void;
  setBrushMode: (mode: WeightBrushMode) => void;
  setBrushRadius: (radius: number) => void;
  setBrushStrength: (strength: number) => void;
  toggleBoneLock: (boneName: string) => void;

  // Animation mutations
  setBoneKeyframeAtCurrentTime: (boneName: string, patch: Partial<TransformKey>) => void;
  deleteBoneKeyframe: (boneName: string, time: number) => void;
  regenerateAllProceduralClips: () => void;
  bakeCurrentClipSprings: () => void;
};

export const useStudioStore = create<StudioState>((set, get) => ({
  project: BUILTIN_PRESETS["astral-forge"]!(),
  mode: "rig",
  selectedBone: "arm",
  selectedPart: "body",
  activeClip: "strike",
  currentTime: 0,
  isPlaying: true,
  playbackSpeed: 1,

  showMeshWireframe: true,
  showBones: true,
  showCapsules: false,
  showHeatmap: false,
  heatmapSingleBone: false,
  isolatePart: false,

  brushMode: "add",
  brushRadius: 65,
  brushStrength: 0.45,
  lockedBones: [],
  hiddenParts: [],

  loadPreset: (id) => {
    const factory = BUILTIN_PRESETS[id];
    if (!factory) return;
    const project = factory();
    set({
      project,
      selectedBone: project.bones[1]?.name ?? "root",
      selectedPart: project.parts.find((p) => p.skin && p.skin.length > 1)?.name ?? project.parts[0]?.name ?? null,
      activeClip: "strike",
      currentTime: 0,
      hiddenParts: [],
    });
  },

  setProject: (project) => {
    set({
      project,
      selectedBone: project.bones[0]?.name ?? null,
      selectedPart: project.parts[0]?.name ?? null,
      activeClip: Object.keys(project.animations)[0] ?? "idle",
      currentTime: 0,
    });
  },

  setMode: (mode) => {
    set({
      mode,
      showHeatmap: mode === "weights",
      showMeshWireframe: mode === "mesh" || mode === "weights" || get().showMeshWireframe,
    });
  },

  selectBone: (selectedBone) => set({ selectedBone }),
  selectPart: (selectedPart) => set({ selectedPart }),
  setActiveClip: (activeClip) => set({ activeClip, currentTime: 0 }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed }),

  toggleOverlay: (key) => set((state) => ({ [key]: !state[key] })),

  togglePartVisibility: (partName) =>
    set((state) => ({
      hiddenParts: state.hiddenParts.includes(partName)
        ? state.hiddenParts.filter((p) => p !== partName)
        : [...state.hiddenParts, partName],
    })),

  movePartLayerOrder: (partName, direction) =>
    set((state) => {
      const parts = [...state.project.parts];
      const idx = parts.findIndex((p) => p.name === partName);
      if (idx < 0) return state;
      // In back-to-front array, "up" in Photoshop Layers means towards front (higher index)
      const targetIdx = direction === "up" ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= parts.length) return state;
      const [item] = parts.splice(idx, 1);
      parts.splice(targetIdx, 0, item!);
      return { project: { ...state.project, parts } };
    }),

  updateBone: (boneName, patch) =>
    set((state) => {
      const bones = state.project.bones.map((b) => (b.name === boneName ? { ...b, ...patch } : b));
      const nextProject: SpineForgeProject = { ...state.project, bones };
      // Recompute auto-weights for skinned parts if bone position/regions/feather changed
      if (patch.x !== undefined || patch.y !== undefined || patch.regions !== undefined || patch.feather !== undefined) {
        nextProject.parts = nextProject.parts.map((part) => {
          if (part.skin?.includes(boneName)) {
            return { ...part, mesh: buildPartMesh(nextProject, { ...part, mesh: undefined }) };
          }
          return part;
        });
      }
      return { project: nextProject };
    }),

  addBone: (parentBoneName, name, x, y) =>
    set((state) => {
      const clean = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");
      if (!clean || state.project.bones.some((b) => b.name === clean)) return state;
      const newBone: RigBone = {
        name: clean,
        parent: parentBoneName,
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        length: 0.08,
        color: RIG_BONE_PALETTE[state.project.bones.length % RIG_BONE_PALETTE.length],
      };
      return {
        project: {
          ...state.project,
          bones: [...state.project.bones, newBone],
        },
        selectedBone: clean,
      };
    }),

  updatePart: (partName, patch) =>
    set((state) => {
      const parts = state.project.parts.map((p) => {
        if (p.name !== partName) return p;
        const updated = { ...p, ...patch };
        if (patch.bone !== undefined || patch.skin !== undefined || patch.meshDensity !== undefined) {
          updated.mesh = buildPartMesh(state.project, { ...updated, mesh: undefined });
        }
        return updated;
      });
      return { project: { ...state.project, parts } };
    }),

  updateIkMix: (ikName, mix, bendPositive) =>
    set((state) => ({
      project: {
        ...state.project,
        ikConstraints: state.project.ikConstraints.map((ik) =>
          ik.name === ikName
            ? { ...ik, mix: Math.max(0, Math.min(1, mix)), bendPositive: bendPositive ?? ik.bendPositive }
            : ik,
        ),
      },
    })),

  regeneratePartMesh: (partName, density, weightMode) =>
    set((state) => {
      const parts = state.project.parts.map((p) => {
        if (p.name !== partName) return p;
        const nextPart: RigPart = { ...p, meshDensity: density, mesh: undefined };
        nextPart.mesh = buildPartMesh(state.project, nextPart, { weightMode });
        return nextPart;
      });
      return { project: { ...state.project, parts } };
    }),

  applyWeightBrush: (partName, rigX, rigY) =>
    set((state) => {
      const { project, selectedBone, brushMode, brushRadius, brushStrength, lockedBones } = state;
      const boneIdx = project.bones.findIndex((b) => b.name === selectedBone);
      if (boneIdx < 0) return state;

      const lockedSet = new Set<number>();
      lockedBones.forEach((lb) => {
        const idx = project.bones.findIndex((b) => b.name === lb);
        if (idx >= 0) lockedSet.add(idx);
      });

      const parts = project.parts.map((part) => {
        if (part.name !== partName) return part;
        const currentMesh = part.mesh ?? buildPartMesh(project, part);
        const painted = paintMeshWeights(currentMesh, project.bones.length, {
          x: rigX,
          y: rigY,
          radius: brushRadius,
          strength: brushStrength,
          boneIndex: boneIdx,
          mode: brushMode,
          lockedBones: lockedSet,
        });
        return { ...part, mesh: painted };
      });

      return { project: { ...project, parts } };
    }),

  setBrushMode: (brushMode) => set({ brushMode }),
  setBrushRadius: (brushRadius) => set({ brushRadius }),
  setBrushStrength: (brushStrength) => set({ brushStrength }),

  toggleBoneLock: (boneName) =>
    set((state) => ({
      lockedBones: state.lockedBones.includes(boneName)
        ? state.lockedBones.filter((b) => b !== boneName)
        : [...state.lockedBones, boneName],
    })),

  setBoneKeyframeAtCurrentTime: (boneName, patch) =>
    set((state) => {
      const { project, activeClip, currentTime } = state;
      const clip = project.animations[activeClip];
      if (!clip) return state;

      const t = Number(currentTime.toFixed(3));
      const existingTrack = [...(clip.boneTracks[boneName] ?? [])];
      const idx = existingTrack.findIndex((k) => Math.abs(k.time - t) < 0.02);

      if (idx >= 0) {
        existingTrack[idx] = { ...existingTrack[idx]!, ...patch, time: existingTrack[idx]!.time };
      } else {
        existingTrack.push({
          time: t,
          r: patch.r ?? 0,
          x: patch.x ?? 0,
          y: patch.y ?? 0,
          sx: patch.sx ?? 1,
          sy: patch.sy ?? 1,
        });
        existingTrack.sort((a, b) => a.time - b.time);
      }

      return {
        project: {
          ...project,
          animations: {
            ...project.animations,
            [activeClip]: {
              ...clip,
              boneTracks: {
                ...clip.boneTracks,
                [boneName]: existingTrack,
              },
            },
          },
        },
      };
    }),

  deleteBoneKeyframe: (boneName, time) =>
    set((state) => {
      const { project, activeClip } = state;
      const clip = project.animations[activeClip];
      if (!clip) return state;
      const filtered = (clip.boneTracks[boneName] ?? []).filter((k) => Math.abs(k.time - time) > 0.015);
      return {
        project: {
          ...project,
          animations: {
            ...project.animations,
            [activeClip]: {
              ...clip,
              boneTracks: {
                ...clip.boneTracks,
                [boneName]: filtered,
              },
            },
          },
        },
      };
    }),

  regenerateAllProceduralClips: () =>
    set((state) => ({
      project: {
        ...state.project,
        animations: generateProceduralClips(state.project),
      },
    })),

  bakeCurrentClipSprings: () =>
    set((state) => {
      const clip = state.project.animations[state.activeClip];
      if (!clip) return state;
      const baked = bakeClipConstraintsToKeyframes(state.project, clip, 24);
      return {
        project: {
          ...state.project,
          animations: {
            ...state.project.animations,
            [state.activeClip]: baked,
          },
        },
      };
    }),
}));
