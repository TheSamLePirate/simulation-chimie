import { describe, expect, it } from "vitest";
import type { SimConfig } from "../types";
import { CpuEngine } from "./CpuEngine";

const BASE: SimConfig = {
  seed: 5,
  particleCount: 256,
  boxLength: 2.2, // compressed argon liquid ⇒ high pressure
  boundary: "periodic",
  temperature: 150,
  timestep: 0.002,
  level: "L2",
  speciesName: "ARGON",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "berendsen",
  thermostatTau: 0.3,
  barostat: "berendsen",
  pressureTarget: 50, // bar — well below the initial pressure
  gravity: 0,
  engineKind: "cpu",
};

describe("Berendsen barostat (NPT)", () => {
  it("expands a compressed liquid toward the target pressure", () => {
    const engine = new CpuEngine(BASE);
    const initialL = engine.box.lengths[0];
    const initialP = engine.observables().pressure;

    engine.step(4000);

    const finalL = engine.box.lengths[0];
    const finalP = engine.observables().pressure;

    // Over-pressurised ⇒ the cell grows (density drops).
    expect(finalL).toBeGreaterThan(initialL + 0.05);
    // Pressure relaxes toward the (much lower) target.
    expect(finalP).toBeLessThan(initialP);
    // Stays finite / sane.
    expect(Number.isFinite(finalP)).toBe(true);
  }, 20_000);

  it("leaves the box fixed when the barostat is off", () => {
    const engine = new CpuEngine({ ...BASE, barostat: "none" });
    const initialL = engine.box.lengths[0];
    engine.step(500);
    expect(engine.box.lengths[0]).toBe(initialL);
  });
});
