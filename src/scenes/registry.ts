import type { SimConfig } from "../engine/types";
import { type ColorMode, DEFAULT_CONFIG } from "../state/store";

export interface Scene {
  id: string;
  label: string;
  description: string;
  config: SimConfig;
  /** View colouring auto-applied on load so the effect reads immediately (default "species"). */
  colorMode?: ColorMode;
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
    colorMode: "speed", // shows the Maxwell-Boltzmann speed spread
  },
  {
    id: "lj-liquid",
    label: "Liquide (cohésion van der Waals)",
    description:
      "L'argon froid se tient en gouttelette liquide (avec une surface libre) au lieu de se disperser comme un gaz parfait — la cohésion de Lennard-Jones",
    config: make({
      level: "L2",
      speciesName: "ARGON",
      particleCount: 700,
      boxLength: 6, // vacuum around the droplet ⇒ a clear liquid surface
      initialClump: true, // start packed; cohesion holds it as a liquid drop
      initialTemperature: 130, // warm ⇒ it jiggles and rounds
      temperature: 90, // a cohesive liquid (below T_c)
      timestep: 0.005,
      thermostat: "berendsen",
      thermostatTau: 0.4,
    }),
    colorMode: "coordination", // dense liquid core (warm) vs vapour (cool)
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
    label: "Cristallisation (liquide → solide)",
    description: "Argon liquide trempé bien sous le point de fusion ⇒ il gèle en cristal ordonné",
    config: make({
      level: "L2",
      speciesName: "ARGON",
      particleCount: 500,
      boxLength: 2.9, // near solid density so the lattice can pack
      initialTemperature: 110, // start liquid
      temperature: 35, // just below freezing ⇒ orders (not a glassy quench)
      timestep: 0.004,
      thermostat: "berendsen",
      thermostatTau: 1.2, // slow anneal ⇒ atoms have time to order
    }),
    colorMode: "coordination", // dense ordered core (warm) vs surface (cool)
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
      particleCount: 170, // fewer ⇒ faster ⇒ you watch the cube round into a sphere
      boxLength: 3.2,
      initialTemperature: 80, // start cold & blocky (a little cube)
      temperature: 235, // warm liquid ⇒ surface tension rounds it into a sphere
      timestep: 0.002,
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
      thermostat: "berendsen", // NVT ⇒ stays at T (gravity work doesn't overheat it)
      thermostatTau: 0.5,
    }),
    colorMode: "coordination", // the dense sediment pile (warm) vs the gas above (cool)
  },
  {
    id: "boil",
    label: "Ébullition (liquide → gaz)",
    description:
      "Gouttelette d'argon froide chauffée bien au-dessus de l'ébullition ⇒ elle s'évapore et le gaz remplit la boîte",
    config: make({
      level: "L2",
      speciesName: "ARGON",
      particleCount: 500,
      boxLength: 6, // room for the gas to expand into
      initialTemperature: 55, // start as a cold condensed droplet
      temperature: 250, // heat well above boiling ⇒ evaporates
      initialClump: true, // start packed as a droplet (vacuum around)
      timestep: 0.005,
      thermostat: "berendsen",
      thermostatTau: 0.5,
    }),
    colorMode: "coordination", // watch the droplet (warm) boil away into gas (cool)
  },
];
