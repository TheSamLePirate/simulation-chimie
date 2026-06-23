import type { SimConfig } from "../engine/types";
import { DEFAULT_CONFIG } from "../state/store";

export interface Scene {
  id: string;
  label: string;
  description: string;
  config: SimConfig;
}

const make = (overrides: Partial<SimConfig>): SimConfig => ({
  ...DEFAULT_CONFIG,
  ...overrides,
});

/** Ready-made scenes that set a full reproducible configuration. */
export const SCENES: readonly Scene[] = [
  {
    id: "ideal-gas",
    label: "Gaz parfait",
    description: "Aucune interaction — Maxwell-Boltzmann (L0)",
    config: make({
      level: "L0",
      speciesName: "NEON",
      particleCount: 400,
      boxLength: 6,
      temperature: 300,
    }),
  },
  {
    id: "lj-liquid",
    label: "Liquide Lennard-Jones",
    description: "Condensation van der Waals à basse température (L2)",
    config: make({
      level: "L2",
      speciesName: "ARGON",
      particleCount: 400,
      boxLength: 4.2,
      temperature: 110,
      timestep: 0.004,
    }),
  },
  {
    id: "oil-water",
    label: "Huile + Eau (démixtion)",
    description: "Mélange binaire immiscible : les phases se séparent (L2)",
    config: make({
      level: "L2",
      speciesName: "WATER",
      secondSpeciesName: "OIL",
      fractionSecond: 0.5,
      crossScale: 0.3,
      particleCount: 600,
      boxLength: 4.6,
      temperature: 180,
      timestep: 0.004,
    }),
  },
];
