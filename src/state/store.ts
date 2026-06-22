import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { AccuracyLevel, Observables, SimConfig } from "../engine/types";
import { Simulation } from "../sim/Simulation";

/** Default opening scene: a modest argon soft-sphere gas that runs smoothly on the CPU engine. */
export const DEFAULT_CONFIG: SimConfig = {
  seed: 1234,
  particleCount: 256,
  boxLength: 4,
  boundary: "periodic",
  temperature: 300,
  timestep: 0.005,
  level: "L1",
  speciesName: "ARGON",
};

/** The single, React-independent simulation controller. */
export const simulation = new Simulation(DEFAULT_CONFIG);

export interface AppState {
  config: SimConfig;
  playing: boolean;
  substeps: number;
  observables: Observables | null;
  fps: number;

  patchConfig: (patch: Partial<SimConfig>) => void;
  setLevel: (level: AccuracyLevel) => void;
  togglePlay: () => void;
  setPlaying: (playing: boolean) => void;
  setSubsteps: (substeps: number) => void;
  stepOnce: () => void;
  reset: () => void;
  publishSample: (observables: Observables, fps: number) => void;
}

export const appStore = createStore<AppState>((set, get) => ({
  config: { ...simulation.config },
  playing: simulation.playing,
  substeps: simulation.substeps,
  observables: simulation.observables(),
  fps: 0,

  patchConfig: (patch) => {
    simulation.patch(patch);
    set({
      config: { ...simulation.config },
      observables: simulation.observables(),
    });
  },

  setLevel: (level) => get().patchConfig({ level }),

  togglePlay: () => {
    const playing = !get().playing;
    simulation.playing = playing;
    set({ playing });
  },

  setPlaying: (playing) => {
    simulation.playing = playing;
    set({ playing });
  },

  setSubsteps: (substeps) => {
    simulation.substeps = substeps;
    set({ substeps });
  },

  stepOnce: () => {
    simulation.stepFrame();
    set({ observables: simulation.observables() });
  },

  reset: () => {
    simulation.reset();
    set({ observables: simulation.observables() });
  },

  publishSample: (observables, fps) => set({ observables, fps }),
}));

/** React hook bound to the vanilla store. */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
