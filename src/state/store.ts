import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { SurfaceTensionAnalysis } from "../core/experiments/surfaceTension";
import type { RadialDistribution } from "../core/observables/rdf";
import type { SpeedDistribution } from "../core/observables/speedDistribution";
import { containUnsafeScientificConfig } from "../engine/scientificStatus";
import type { AccuracyLevel, EngineKind, Observables, SimConfig } from "../engine/types";

/** Particle colouring mode (view-only, not part of the physics config). */
export type ColorMode = "species" | "speed" | "coordination";

/** Render style (view-only): instanced spheres, or a screen-space fluid surface (CPU). */
export type RenderStyle = "spheres" | "fluid";

/** Default opening scene: a modest argon soft-sphere gas on the CPU reference engine. */
export const DEFAULT_CONFIG: SimConfig = {
  seed: 1234,
  particleCount: 256,
  boxLength: 4,
  boundary: "periodic",
  temperature: 300,
  timestep: 0.005,
  level: "L1",
  speciesName: "ARGON",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "none",
  thermostatTau: 0.5,
  barostat: "none",
  pressureTarget: 1,
  gravity: 0,
  engineKind: "cpu",
};

export interface AppState {
  config: SimConfig;
  playing: boolean;
  substeps: number;
  observables: Observables | null;
  rdf: RadialDistribution | null;
  speeds: SpeedDistribution | null;
  demixing: number | null;
  surfaceTension: SurfaceTensionAnalysis | null;
  fps: number;
  colorMode: ColorMode;
  renderStyle: RenderStyle;
  /**
   * Id of the scene currently installed verbatim, or null once the user edits a control.
   * Identity, not inference: matching on (species, seed) aliased half the catalogue onto
   * the same highlight.
   */
  activeSceneId: string | null;
  /** Bumped to request a single manual step / a reset (consumed by the renderer). */
  stepNonce: number;
  resetNonce: number;

  /** Live edit of individual fields (UI controls). Merges onto the active config. */
  patchConfig: (patch: Partial<SimConfig>) => void;
  /**
   * Install a complete, already-validated config (scene load, import, snapshot restore).
   * Replaces rather than merges, so optional fields cannot leak from the previous run.
   * `sceneId` marks the config as an untouched scene; omit it for imports.
   */
  replaceConfig: (config: SimConfig, sceneId?: string) => void;
  setLevel: (level: AccuracyLevel) => void;
  setEngineKind: (engineKind: EngineKind) => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setSubsteps: (substeps: number) => void;
  requestStep: () => void;
  requestReset: () => void;
  publishSample: (observables: Observables, fps: number) => void;
  publishAnalysis: (
    rdf: RadialDistribution | null,
    demixing: number | null,
    speeds: SpeedDistribution | null,
  ) => void;
  publishSurfaceTension: (analysis: SurfaceTensionAnalysis | null) => void;
  setColorMode: (colorMode: ColorMode) => void;
  setRenderStyle: (renderStyle: RenderStyle) => void;
}

export const appStore = createStore<AppState>((set, get) => ({
  config: DEFAULT_CONFIG,
  playing: false,
  substeps: 5,
  observables: null,
  rdf: null,
  speeds: null,
  demixing: null,
  surfaceTension: null,
  fps: 0,
  colorMode: "species",
  renderStyle: "spheres",
  activeSceneId: null,
  stepNonce: 0,
  resetNonce: 0,

  patchConfig: (patch) =>
    set({
      config: containUnsafeScientificConfig({ ...get().config, ...patch }),
      activeSceneId: null,
    }),
  replaceConfig: (config, sceneId) =>
    set({
      config: containUnsafeScientificConfig(config),
      activeSceneId: sceneId ?? null,
    }),
  setLevel: (level) =>
    set({
      config: containUnsafeScientificConfig({ ...get().config, level }),
      activeSceneId: null,
    }),
  setEngineKind: (engineKind) => set({ config: { ...get().config, engineKind } }),
  togglePlay: () => set({ playing: !get().playing }),
  setPlaying: (playing) => set({ playing }),
  setSubsteps: (substeps) => set({ substeps }),
  requestStep: () => set({ stepNonce: get().stepNonce + 1 }),
  requestReset: () => set({ resetNonce: get().resetNonce + 1 }),
  publishSample: (observables, fps) => set({ observables, fps }),
  publishAnalysis: (rdf, demixing, speeds) => set({ rdf, demixing, speeds }),
  publishSurfaceTension: (surfaceTension) => set({ surfaceTension }),
  setColorMode: (colorMode) => set({ colorMode }),
  setRenderStyle: (renderStyle) => set({ renderStyle }),
}));

/** React hook bound to the vanilla store. */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
