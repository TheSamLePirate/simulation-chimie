import { describe, expect, it } from "vitest";
import type { SimConfig } from "../engine/types";
import { SCENES } from "../scenes/registry";
import {
  CONFIG_VERSION,
  describeConfigError,
  exportConfigEnvelope,
  parseConfigEnvelope,
} from "./canonicalConfig";
import { parseConfig } from "./schema";

const BASE: SimConfig = {
  seed: 42,
  particleCount: 125,
  boxLength: 1.8,
  boundary: "periodic",
  temperature: 120,
  initialTemperature: undefined,
  initialClump: undefined,
  timestep: 0.003,
  level: "L2",
  speciesName: "ARGON",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "none",
  thermostatTau: 0.5,
  barostat: "none",
  pressureTarget: 1,
  gravity: 0,
  electricField: undefined,
  engineKind: "cpu",
};

describe("canonical config envelope", () => {
  it("round-trips every scene through JSON without losing or inheriting fields", () => {
    for (const scene of SCENES) {
      const json = JSON.parse(JSON.stringify(exportConfigEnvelope(scene.config)));
      expect(parseConfigEnvelope(json), scene.id).toEqual(scene.config);
    }
  });

  it("restores optional fields explicitly so they cannot leak from the previous scene", () => {
    // The electrophoresis scene sets a field the LJ scene must clear, and vice versa.
    const withField: SimConfig = {
      ...BASE,
      electricField: 150,
      initialClump: true,
    };
    const withoutField: SimConfig = {
      ...BASE,
      electricField: undefined,
      initialClump: undefined,
    };

    const json = JSON.parse(JSON.stringify(exportConfigEnvelope(withoutField)));
    const restored = parseConfigEnvelope(json);

    // The envelope carries the cleared fields explicitly (as null), so the parsed config states
    // their absence rather than omitting them.
    expect(json.config.electricField).toBeNull();
    expect(restored.electricField).toBeUndefined();
    expect(restored.initialClump).toBeUndefined();
    // Applied as a replacement, the restored config equals the exported one exactly.
    expect(restored).toEqual(withoutField);

    // Demonstrate why replacement is required: merging this config over an active scene that had
    // the field set would silently retain the old electric field — the P65 defect.
    const merged = { ...withField, ...restored };
    expect(merged.electricField).toBe(150);
    expect(merged).not.toEqual(restored);
  });

  it("stamps and validates the config version", () => {
    const envelope = exportConfigEnvelope(BASE);
    expect(envelope.configVersion).toBe(CONFIG_VERSION);
    expect(() => parseConfigEnvelope({ ...envelope, configVersion: 999 })).toThrow(/version/i);
  });

  it("accepts a legacy bare config and normalises it to the canonical shape", () => {
    const legacy = { ...BASE };
    delete (legacy as Record<string, unknown>).initialTemperature;
    delete (legacy as Record<string, unknown>).electricField;
    expect(parseConfigEnvelope(legacy)).toEqual(BASE);
  });

  it("rejects unknown keys instead of silently dropping them", () => {
    expect(() => parseConfigEnvelope({ ...BASE, bogusKey: 1 })).toThrow();
  });
});

describe("import error reporting", () => {
  it("summarises validation failures as readable text, not a JSON dump", () => {
    try {
      parseConfigEnvelope({ ...BASE, speciesName: "ARGNO" });
      throw new Error("expected a validation failure");
    } catch (error) {
      const described = describeConfigError(error);
      expect(described).toMatch(/speciesName/);
      expect(described).toMatch(/Espèce inconnue/);
      expect(described).not.toContain("{");
    }
  });
});

describe("species validation", () => {
  it("rejects an unknown species instead of silently substituting argon", () => {
    expect(() => parseConfig({ ...BASE, speciesName: "ARGNO" })).toThrow(/esp[eè]ce/i);
    expect(() => parseConfig({ ...BASE, secondSpeciesName: "UNOBTAINIUM" })).toThrow(/esp[eè]ce/i);
  });

  it("accepts every species the library actually defines", () => {
    expect(() => parseConfig({ ...BASE, speciesName: "WATER_O" })).not.toThrow();
    expect(() =>
      parseConfig({
        ...BASE,
        level: "L3",
        speciesName: "SODIUM",
        secondSpeciesName: "CHLORIDE",
      }),
    ).not.toThrow();
  });
});

describe("cross-field validation", () => {
  it("requires an even, positive molecule count for the L11 slab builder", () => {
    const l11: SimConfig = {
      ...BASE,
      level: "L11",
      speciesName: "WATER_O",
      particleCount: 255,
      thermostat: "csvr",
      thermostatTau: 1,
      timestep: 0.002,
    };
    expect(() => parseConfig(l11)).toThrow(/pair/i);
    expect(() => parseConfig({ ...l11, particleCount: 256 })).not.toThrow();
  });

  it("rejects a periodic L2 box that double-counts across the minimum image", () => {
    // L2 does not clamp its cutoff: argon rc = 2.5 × 0.3405 nm ⇒ box must be ≥ 2·rc ≈ 1.70 nm.
    expect(() => parseConfig({ ...BASE, level: "L2", boxLength: 1.6 })).toThrow(/image minimale/i);
    expect(() => parseConfig({ ...BASE, level: "L2", boxLength: 1.75 })).not.toThrow();
    // Reflective walls have no periodic images, so the same tight box is legal.
    expect(() =>
      parseConfig({
        ...BASE,
        level: "L2",
        boxLength: 1.6,
        boundary: "reflective",
      }),
    ).not.toThrow();
  });

  it("allows tight boxes for levels that clamp their cutoff to the minimum image", () => {
    // L3+ clamp to 0.49·L (reduced accuracy, documented) — shipped water scenes rely on this.
    expect(() =>
      parseConfig({
        ...BASE,
        level: "L5",
        speciesName: "WATER_O",
        boxLength: 1.7,
        timestep: 0.002,
      }),
    ).not.toThrow();
  });

  it("rejects backends that cannot run the requested level", () => {
    expect(() => parseConfig({ ...BASE, level: "L9", engineKind: "gpu" })).toThrow(/GPU/);
    expect(() => parseConfig({ ...BASE, level: "L10", engineKind: "gpu" })).toThrow(/GPU/);
    expect(() => parseConfig({ ...BASE, level: "L9", engineKind: "cpu" })).not.toThrow();
  });

  it("keeps the P64 scientific containment rules", () => {
    expect(() => parseConfig({ ...BASE, level: "L5", barostat: "berendsen" })).toThrow();
    expect(() => parseConfig({ ...BASE, level: "L5", thermostat: "langevin" })).toThrow();
  });
});
