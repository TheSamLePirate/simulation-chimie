import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { RadialDistribution } from "../core/observables/rdf";
import type { AccuracyLevel, EngineKind, Observables, SimConfig } from "../engine/types";

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
  engineKind: "cpu",
};

export interface AppState {
  config: SimConfig;
  playing: boolean;
  substeps: number;
  observables: Observables | null;
  rdf: RadialDistribution | null;
  fps: number;
  /** Bumped to request a single manual step / a reset (consumed by the renderer). */
  stepNonce: number;
  resetNonce: number;

  patchConfig: (patch: Partial<SimConfig>) => void;
  setLevel: (level: AccuracyLevel) => void;
  setEngineKind: (engineKind: EngineKind) => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setSubsteps: (substeps: number) => void;
  requestStep: () => void;
  requestReset: () => void;
  publishSample: (observables: Observables, fps: number) => void;
  publishRdf: (rdf: RadialDistribution | null) => void;
}

export const appStore = createStore<AppState>((set, get) => ({
  config: DEFAULT_CONFIG,
  playing: false,
  substeps: 5,
  observables: null,
  rdf: null,
  fps: 0,
  stepNonce: 0,
  resetNonce: 0,

  patchConfig: (patch) => set({ config: { ...get().config, ...patch } }),
  setLevel: (level) => set({ config: { ...get().config, level } }),
  setEngineKind: (engineKind) => set({ config: { ...get().config, engineKind } }),
  togglePlay: () => set({ playing: !get().playing }),
  setPlaying: (playing) => set({ playing }),
  setSubsteps: (substeps) => set({ substeps }),
  requestStep: () => set({ stepNonce: get().stepNonce + 1 }),
  requestReset: () => set({ resetNonce: get().resetNonce + 1 }),
  publishSample: (observables, fps) => set({ observables, fps }),
  publishRdf: (rdf) => set({ rdf }),
}));

/** React hook bound to the vanilla store. */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
