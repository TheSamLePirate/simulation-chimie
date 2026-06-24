import { z } from "zod";
import type { SimConfig } from "../engine/types";

/** Zod schema mirroring {@link SimConfig}; used to validate imported scenes/snapshots. */
export const simConfigSchema = z.object({
  seed: z.number().int(),
  particleCount: z.number().int().min(1).max(200000),
  boxLength: z.number().positive(),
  boundary: z.enum(["periodic", "reflective"]),
  temperature: z.number().min(0),
  timestep: z.number().positive(),
  level: z.enum(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]),
  speciesName: z.string(),
  secondSpeciesName: z.string().nullable(),
  fractionSecond: z.number().min(0).max(1),
  crossScale: z.number().min(0).max(2),
  thermostat: z.enum(["none", "berendsen", "csvr"]),
  thermostatTau: z.number().positive(),
  barostat: z.enum(["none", "berendsen"]),
  pressureTarget: z.number(),
  gravity: z.number(),
  engineKind: z.enum(["cpu", "gpu"]),
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
