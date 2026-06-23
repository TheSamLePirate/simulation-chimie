import type { Box, SimState, Species } from "../core/types";

/**
 * Accuracy levels — the incremental physical-fidelity ladder. Each level switches on
 * one more force term. P1 ships L0/L1; later phases extend this registry (L2…L6).
 */
export const ACCURACY_LEVELS = {
  L0: {
    id: "L0",
    label: "L0 · Gaz parfait",
    description: "Aucune interaction",
  },
  L1: {
    id: "L1",
    label: "L1 · Sphères molles",
    description: "Répulsion WCA à courte portée",
  },
  L2: {
    id: "L2",
    label: "L2 · Lennard-Jones",
    description: "Van der Waals : cohésion + condensation",
  },
} as const;

export type AccuracyLevel = keyof typeof ACCURACY_LEVELS;

/** Which compute backend runs the simulation. */
export type EngineKind = "cpu" | "gpu";

/** Fully describes a reproducible simulation. Serialisable (drives engine + defines a scene). */
export interface SimConfig {
  readonly seed: number;
  readonly particleCount: number;
  /** Cubic cell side in nm. */
  readonly boxLength: number;
  readonly boundary: Box["boundary"];
  /** Target / initial temperature in K. */
  readonly temperature: number;
  /** Integration timestep in ps. */
  readonly timestep: number;
  readonly level: AccuracyLevel;
  /** Primary species. */
  readonly speciesName: string;
  /** Optional second species for binary mixtures (null ⇒ single species). */
  readonly secondSpeciesName: string | null;
  /** Fraction of particles assigned to the second species (0…1). */
  readonly fractionSecond: number;
  /**
   * Cross-species attraction multiplier applied to the mixed ε (Lorentz-Berthelot).
   * 1 = ideal mixing; < 1 weakens unlike attraction ⇒ immiscibility / demixing.
   */
  readonly crossScale: number;
  /** Compute backend: CPU reference oracle or WebGPU. */
  readonly engineKind: EngineKind;
}

/** Instantaneous, display-ready measurements of the system. */
export interface Observables {
  readonly step: number;
  /** Elapsed simulated time in ps. */
  readonly time: number;
  readonly kineticEnergy: number;
  readonly potentialEnergy: number;
  readonly totalEnergy: number;
  /** Kinetic temperature in K. */
  readonly temperature: number;
  /** Virial pressure in bar. */
  readonly pressure: number;
}

/** Common contract for the CPU reference engine and (P2) the GPU engine. */
export interface SimulationEngine {
  readonly config: SimConfig;
  readonly state: SimState;
  readonly box: Box;
  readonly species: readonly Species[];
  /** Advance the simulation by `steps` integration steps. */
  step(steps: number): void;
  /** Current measurements. */
  observables(): Observables;
  /** Re-initialise from a (possibly patched) config. */
  reset(patch?: Partial<SimConfig>): void;
}
