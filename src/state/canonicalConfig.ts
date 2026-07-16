import { z } from "zod";
import type { SimConfig } from "../engine/types";
import { parseConfig } from "./schema";

/**
 * Config schema version. Bump when a change alters the meaning of an existing field or adds a
 * field whose absence cannot be safely defaulted; `migrateConfig` must then handle the old shape.
 */
export const CONFIG_VERSION = 1;

/** Serialised config: a versioned envelope, never a bare object, so imports are unambiguous. */
export interface ConfigEnvelope {
  readonly configVersion: number;
  readonly config: Record<string, unknown>;
}

/**
 * Optional fields are serialised explicitly as `null` rather than omitted. `JSON.stringify` drops
 * `undefined` properties, which previously let an imported config inherit the *previous* scene's
 * value through the store's merge — e.g. an electric field leaking into a neutral scene.
 */
const OPTIONAL_KEYS = ["initialTemperature", "initialClump", "electricField"] as const;

function isEnvelope(value: unknown): value is ConfigEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "configVersion" in value &&
    "config" in value &&
    typeof (value as ConfigEnvelope).config === "object"
  );
}

/** Serialise a config into its canonical, fully explicit envelope. */
export function exportConfigEnvelope(config: SimConfig): ConfigEnvelope {
  const explicit = { ...config } as Record<string, unknown>;
  for (const key of OPTIONAL_KEYS) {
    if (explicit[key] === undefined) explicit[key] = null;
  }
  return { configVersion: CONFIG_VERSION, config: explicit };
}

/** Normalise the explicit `null`s back to `undefined` so the runtime shape stays exact-optional. */
function normaliseOptionals(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  for (const key of OPTIONAL_KEYS) {
    if (next[key] === null) delete next[key];
  }
  return next;
}

/**
 * Turn a validation failure into a readable summary. Zod's own `message` is a JSON dump of every
 * issue, which is unusable as user-facing text at the import boundary.
 */
export function describeConfigError(error: unknown): string {
  if (!(error instanceof z.ZodError)) {
    return error instanceof Error ? error.message : String(error);
  }
  return error.issues
    .map((issue) => {
      const field = issue.path.join(".");
      return field ? `${field} : ${issue.message}` : issue.message;
    })
    .join(" · ");
}

/**
 * Parse any accepted serialised form — a versioned envelope or a legacy bare config — into one
 * validated canonical `SimConfig`. Throws with a human-readable reason; never silently repairs.
 */
export function parseConfigEnvelope(value: unknown): SimConfig {
  if (isEnvelope(value)) {
    if (value.configVersion !== CONFIG_VERSION) {
      throw new Error(
        `Version de configuration ${value.configVersion} non prise en charge (attendu ${CONFIG_VERSION}).`,
      );
    }
    return parseConfig(normaliseOptionals(value.config));
  }
  // Legacy bare config (pre-P65 export): accepted, then normalised into the canonical shape.
  if (typeof value !== "object" || value === null) {
    throw new Error("Configuration invalide : objet attendu.");
  }
  return parseConfig(normaliseOptionals(value as Record<string, unknown>));
}
