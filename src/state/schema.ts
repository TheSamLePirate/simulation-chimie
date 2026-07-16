import { z } from "zod";
import { LJ_CUTOFF_FACTOR } from "../core/forces/lennardJonesCell";
import { WCA_CUTOFF_FACTOR } from "../core/forces/wca";
import { SPECIES_LIBRARY } from "../core/species";
import { scientificSafetyIssues } from "../engine/scientificStatus";
import type { SimConfig } from "../engine/types";

/** Species must exist in the library: an unknown name used to fall back to argon silently. */
const SPECIES_NAMES = Object.keys(SPECIES_LIBRARY) as [string, ...string[]];
const speciesName = z.enum(SPECIES_NAMES, {
  message: `Espèce inconnue (attendu : ${SPECIES_NAMES.join(", ")})`,
});

/** Levels whose GPU kernels do not exist (dihedrals/Morse); they must stay on the CPU. */
const CPU_ONLY_LEVELS = new Set(["L9", "L10"]);

/**
 * Zod schema mirroring {@link SimConfig}, used for every config entering the app (scene, import,
 * snapshot). Strict: unknown keys are an error rather than being silently stripped, so a config
 * from a newer/hand-edited source can never appear to apply a field this build ignores.
 */
export const simConfigSchema = z
  .strictObject({
    seed: z.number().int(),
    particleCount: z.number().int().min(1).max(200000),
    boxLength: z.number().positive(),
    boundary: z.enum(["periodic", "reflective"]),
    temperature: z.number().min(0),
    initialTemperature: z.number().min(0).optional(),
    initialClump: z.boolean().optional(),
    timestep: z.number().positive(),
    level: z.enum(["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11"]),
    speciesName,
    secondSpeciesName: speciesName.nullable(),
    fractionSecond: z.number().min(0).max(1),
    crossScale: z.number().min(0).max(2),
    thermostat: z.enum(["none", "berendsen", "csvr", "langevin"]),
    thermostatTau: z.number().positive(),
    barostat: z.enum(["none", "berendsen"]),
    pressureTarget: z.number(),
    gravity: z.number(),
    electricField: z.number().optional(),
    engineKind: z.enum(["cpu", "gpu"]),
  })
  .superRefine((value, context) => {
    const config = value as unknown as SimConfig;

    // P64 containment: known-invalid physics combinations are rejected, never silently ignored.
    for (const issue of scientificSafetyIssues(config)) {
      context.addIssue({
        code: "custom",
        message: issue.message,
        path: [issue.code === "molecular-npt-uncertified" ? "barostat" : "thermostat"],
      });
    }

    if (CPU_ONLY_LEVELS.has(config.level) && config.engineKind === "gpu") {
      context.addIssue({
        code: "custom",
        message: `Le niveau ${config.level} n'a pas de kernel GPU (dièdres/Morse) : utilisez le moteur CPU.`,
        path: ["engineKind"],
      });
    }

    // The L11 slab builder packs molecules symmetrically about the interface.
    if (config.level === "L11" && config.particleCount % 2 !== 0) {
      context.addIssue({
        code: "custom",
        message: "L11 exige un nombre pair de molécules pour construire le slab.",
        path: ["particleCount"],
      });
    }

    // Minimum image. L1/L2 apply their nominal cutoff (WCA 2^(1/6)σ, LJ 2.5σ) without clamping,
    // so a periodic box narrower than 2·rc lets an atom interact with a neighbour AND that
    // neighbour's own image — double counting, i.e. genuinely wrong forces. L3+ instead clamp the
    // cutoff to 0.49·L: a documented accuracy reduction, not an invalid state, so it is allowed.
    const uncappedFactor =
      config.level === "L1" ? WCA_CUTOFF_FACTOR : config.level === "L2" ? LJ_CUTOFF_FACTOR : 0;
    if (config.boundary === "periodic" && uncappedFactor > 0) {
      const sigmas = [config.speciesName, config.secondSpeciesName]
        .filter((name): name is string => name !== null)
        .map((name) => SPECIES_LIBRARY[name as keyof typeof SPECIES_LIBRARY]?.sigma ?? 0);
      const minimum = 2 * uncappedFactor * Math.max(...sigmas);
      if (config.boxLength < minimum) {
        context.addIssue({
          code: "custom",
          message: `Boîte périodique trop petite (${config.boxLength} nm) : ${config.level} applique un cutoff non borné, l'image minimale exige au moins ${minimum.toFixed(2)} nm.`,
          path: ["boxLength"],
        });
      }
    }
  });

/** Parse + validate an unknown value into a SimConfig (throws on invalid). */
export function parseConfig(value: unknown): SimConfig {
  return simConfigSchema.parse(value) as SimConfig;
}

/** Full simulation snapshot: config + serialised state for exact restore. */
export const snapshotSchema = z.object({
  version: z.literal(1),
  config: simConfigSchema,
  step: z.number().int().min(0),
  time: z.number().min(0),
  positions: z.array(z.number()),
  velocities: z.array(z.number()),
  typeIds: z.array(z.number().int()),
});

export type Snapshot = z.infer<typeof snapshotSchema>;

export function parseSnapshot(value: unknown): Snapshot {
  return snapshotSchema.parse(value);
}
