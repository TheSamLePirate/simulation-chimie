import type { ThermostatKind } from "../core/thermostats";
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
  L3: {
    id: "L3",
    label: "L3 · Électrostatique",
    description: "LJ + Coulomb (Wolf DSF) : ions, charges partielles",
  },
  L4: {
    id: "L4",
    label: "L4 · Eau atomistique",
    description: "Eau SPC/Fw : molécules O+2H, liaisons H, charges (CPU)",
  },
  L5: {
    id: "L5",
    label: "L5 · Eau rigide",
    description: "Eau rigide (contraintes SHAKE/RATTLE), grand pas de temps (CPU)",
  },
  L6: {
    id: "L6",
    label: "L6 · Mélange moléculaire",
    description: "Eau atomistique + huile (alcane) : démixtion hydrophobe réelle (CPU)",
  },
  L7: {
    id: "L7",
    label: "L7 · Tension de surface",
    description: "Gouttelette d'eau dans le vide : la cohésion forme une sphère (CPU)",
  },
  L8: {
    id: "L8",
    label: "L8 · Dissolution",
    description: "Cristal de sel (NaCl) dans l'eau : les ions se solvatent et se dissolvent (CPU)",
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
  /** Thermostat: `none` = NVE; otherwise NVT toward `temperature`. */
  readonly thermostat: ThermostatKind;
  /** Thermostat coupling time in ps (smaller = stronger coupling). */
  readonly thermostatTau: number;
  /** Barostat: `none` = fixed volume; `berendsen` = NPT toward `pressureTarget`. */
  readonly barostat: "none" | "berendsen";
  /** Target pressure in bar (NPT). */
  readonly pressureTarget: number;
  /** Downward gravitational acceleration in nm·ps⁻² (0 = off; exaggerated vs real g for visibility). */
  readonly gravity: number;
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
