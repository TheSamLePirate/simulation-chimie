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
    label: "Huile + Eau (démixtion + gravité)",
    description:
      "Eau atomistique + huile (alcane) sous gravité : l'eau (dense) coule, l'huile flotte ⇒ 2 phases",
    config: make({
      level: "L6",
      speciesName: "WATER_O",
      secondSpeciesName: "OIL_CH3",
      fractionSecond: 0.4, // 40% oil molecules, 60% water
      particleCount: 320, // total molecules (×3 atoms) — cell-list keeps it real-time
      boxLength: 2.8, // base of a tall column (engine makes y = 2.5×); gravity layers it
      boundary: "reflective",
      temperature: 300,
      timestep: 0.001, // 1 fs (water is rigid via SHAKE)
      thermostat: "csvr",
      thermostatTau: 0.1,
      gravity: 0.2,
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
    id: "water",
    label: "Eau atomistique (SPC/Fw)",
    description: "Vraie eau H₂O : molécules O+2H, liaisons H, charges (CPU, L4)",
    config: make({
      level: "L4",
      speciesName: "WATER_O",
      particleCount: 125, // molecules (×3 atoms)
      boxLength: 1.6,
      temperature: 300,
      timestep: 0.0005,
      thermostat: "csvr",
      thermostatTau: 0.1,
    }),
  },
  {
    id: "water-rigid",
    label: "Eau rigide (L5)",
    description: "Eau rigide (contraintes SHAKE/RATTLE) — pas de temps 2 fs",
    config: make({
      level: "L5",
      speciesName: "WATER_O",
      particleCount: 150,
      boxLength: 1.7,
      temperature: 300,
      timestep: 0.002,
      thermostat: "berendsen",
      thermostatTau: 0.2,
    }),
  },
  {
    id: "droplet",
    label: "Tension de surface (gouttelette)",
    description: "Agrégat d'eau dans le vide : la cohésion (liaisons H) le sphérifie",
    config: make({
      level: "L7",
      speciesName: "WATER_O",
      particleCount: 240, // molecules, packed as a centred clump
      boxLength: 4.0,
      temperature: 260, // cool ⇒ stays cohesive (warm water evaporates in vacuum)
      timestep: 0.002,
      thermostat: "berendsen",
      thermostatTau: 0.2,
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
      particleCount: 216, // 6×6×6 rock-salt lattice
      boxLength: 1.75,
      temperature: 300,
      timestep: 0.001,
      thermostat: "berendsen",
      thermostatTau: 0.2,
    }),
  },
  {
    id: "dissolution",
    label: "Dissolution d'un cristal de sel",
    description: "Cristal de NaCl plongé dans l'eau : les ions se solvatent et se dissolvent",
    config: make({
      level: "L8",
      speciesName: "WATER_O",
      secondSpeciesName: "SODIUM",
      particleCount: 27, // crystal side ≈ ∛27 = 3 (→ 26 ions after neutralising)
      boxLength: 2.0, // small water shell ⇒ fewer atoms ⇒ real-time
      temperature: 370, // warm ⇒ dissolves faster
      timestep: 0.002,
      thermostat: "berendsen",
      thermostatTau: 0.3,
    }),
  },
  {
    id: "sediment",
    label: "Sédimentation (gravité)",
    description: "Gravité + parois : les particules tombent et s'accumulent au fond",
    config: make({
      level: "L2",
      speciesName: "ARGON",
      particleCount: 400,
      boxLength: 5,
      boundary: "reflective",
      temperature: 120,
      timestep: 0.005,
      gravity: 0.12,
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
