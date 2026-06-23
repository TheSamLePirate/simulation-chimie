import { describe, expect, it } from "vitest";
import { CpuEngine } from "../engine/cpu/CpuEngine";
import type { SimConfig } from "../engine/types";
import { parseConfig, parseSnapshot } from "./schema";
import { captureSnapshot, restoreSnapshot } from "./snapshot";

const CONFIG: SimConfig = {
  seed: 42,
  particleCount: 125,
  boxLength: 1.8,
  boundary: "periodic",
  temperature: 120,
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
  engineKind: "cpu",
};

describe("snapshot round-trip", () => {
  it("restores exact state through JSON and continues identically", () => {
    const reference = new CpuEngine(CONFIG);
    reference.step(200);

    // Serialise exactly as a real save would, then restore.
    const json = JSON.parse(JSON.stringify(captureSnapshot(reference)));
    const restored = restoreSnapshot(parseSnapshot(json));

    // Continuations must match step-for-step.
    reference.step(150);
    restored.step(150);

    expect(restored.observables().step).toBe(reference.observables().step);
    expect(Array.from(restored.state.positions)).toEqual(Array.from(reference.state.positions));
    expect(Array.from(restored.state.velocities)).toEqual(Array.from(reference.state.velocities));
  });
});

describe("config schema validation", () => {
  it("accepts a valid config", () => {
    expect(() => parseConfig(CONFIG)).not.toThrow();
  });

  it("rejects an invalid enum value", () => {
    expect(() => parseConfig({ ...CONFIG, level: "L9" })).toThrow();
  });

  it("rejects an out-of-range field", () => {
    expect(() => parseConfig({ ...CONFIG, fractionSecond: 5 })).toThrow();
  });

  it("rejects missing fields", () => {
    expect(() => parseConfig({ seed: 1 })).toThrow();
  });
});
