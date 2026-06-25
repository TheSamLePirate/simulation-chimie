import { describe, expect, it } from "vitest";
import { CpuEngine } from "../../engine/cpu/CpuEngine";
import type { SimConfig } from "../../engine/types";
import { langevinFactors } from "./index";

const base: SimConfig = {
  seed: 7,
  particleCount: 200,
  boxLength: 7,
  boundary: "periodic",
  temperature: 300,
  initialTemperature: 50, // start cold ⇒ the thermostat must HEAT it to the target
  timestep: 0.005,
  level: "L1",
  speciesName: "ARGON",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "langevin",
  thermostatTau: 0.4,
  barostat: "none",
  pressureTarget: 1,
  gravity: 0,
  engineKind: "cpu",
};

describe("Langevin thermostat", () => {
  it("c₁,c₂ satisfy the fluctuation-dissipation relation (steady-state variance = k_B·T/m)", () => {
    const { c1, c2 } = langevinFactors(0.005, 0.4, 300, 10);
    // Stationary variance of v ← c₁v + c₂η is σ²_v = c₂²/(1−c₁²) = k_B·T/m.
    const steadyVar = (c2 * c2) / (1 - c1 * c1);
    const kT_over_m = (0.00831446 * 300) / 10;
    expect(steadyVar).toBeCloseTo(kT_over_m, 6);
    expect(c1).toBeLessThan(1);
    expect(c1).toBeGreaterThan(0);
  });

  it("drives the system from cold (50 K) to the target temperature (NVT)", () => {
    const engine = new CpuEngine(base);
    engine.step(4000); // equilibrate
    let sumT = 0;
    const samples = 40;
    for (let s = 0; s < samples; s++) {
      engine.step(50);
      sumT += engine.observables().temperature;
    }
    const meanT = sumT / samples;
    // Canonical sampling around 300 K (tolerant band — it's a stochastic thermostat).
    expect(meanT).toBeGreaterThan(255);
    expect(meanT).toBeLessThan(345);
  });

  it("is reproducible for a fixed seed", () => {
    const a = new CpuEngine(base);
    const b = new CpuEngine(base);
    a.step(500);
    b.step(500);
    expect(a.observables().temperature).toBeCloseTo(b.observables().temperature, 10);
  });
});
