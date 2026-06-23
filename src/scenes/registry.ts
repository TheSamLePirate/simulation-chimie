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
  {
    id: "crystallise",
    label: "Cristallisation (NVT)",
    description: "Refroidissement Berendsen sous le point de fusion ⇒ ordre cristallin",
    config: make({
      level: "L2",
      speciesName: "ARGON",
      particleCount: 256,
      boxLength: 2.2,
      temperature: 40,
      timestep: 0.003,
      thermostat: "berendsen",
      thermostatTau: 0.3,
    }),
  },
  {
    id: "nacl",
    label: "NaCl (ionique, L3)",
    description: "Électrostatique Wolf : ions opposés s'attirent et s'ordonnent",
    config: make({
      level: "L3",
      speciesName: "SODIUM",
      secondSpeciesName: "CHLORIDE",
      fractionSecond: 0.5,
      crossScale: 1,
      particleCount: 250,
      boxLength: 3,
      temperature: 300,
      timestep: 0.002,
      thermostat: "berendsen",
      thermostatTau: 0.4,
    }),
  },
  {
    id: "boil",
    label: "Chauffage / gaz (NVT)",
    description: "Thermostat chaud ⇒ le liquide s'évapore en gaz",
    config: make({
      level: "L2",
      speciesName: "ARGON",
      particleCount: 300,
      boxLength: 4,
      temperature: 280,
      timestep: 0.004,
      thermostat: "berendsen",
      thermostatTau: 0.4,
    }),
  },
];
