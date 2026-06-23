import { describe, expect, it } from "vitest";
import type { SimConfig } from "../types";
import { CpuEngine } from "./CpuEngine";

const BASE: SimConfig = {
  seed: 7,
  particleCount: 125,
  boxLength: 1.8, // 5×5×5 lattice ⇒ 0.36 nm spacing < WCA cutoff ⇒ active interactions
  boundary: "periodic",
  temperature: 120,
  timestep: 0.002,
  level: "L1",
  speciesName: "ARGON",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "none",
  thermostatTau: 0.5,
  barostat: "none",
  pressureTarget: 1,
  gravity: 0,
  engineKind: "cpu",
};

describe("CpuEngine", () => {
  it("initialises with sane observables", () => {
    const engine = new CpuEngine(BASE);
    const obs = engine.observables();
    expect(obs.step).toBe(0);
    expect(obs.temperature).toBeCloseTo(120, 0);
    expect(Number.isFinite(obs.totalEnergy)).toBe(true);
    expect(obs.kineticEnergy).toBeGreaterThan(0);
  });

  it("advances time and conserves total energy under NVE", () => {
    const engine = new CpuEngine(BASE);
    const e0 = engine.observables().totalEnergy;
    let min = e0;
    let max = e0;
    for (let i = 0; i < 30; i++) {
      engine.step(50);
      const e = engine.observables().totalEnergy;
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
    expect(engine.observables().step).toBe(1500);
    expect(engine.observables().time).toBeCloseTo(1500 * BASE.timestep, 6);
    expect((max - min) / Math.abs(e0)).toBeLessThan(0.01);
  });

  it("level L0 is a true ideal gas (zero potential energy)", () => {
    const engine = new CpuEngine({ ...BASE, level: "L0" });
    engine.step(200);
    expect(engine.observables().potentialEnergy).toBe(0);
  });

  it("setLevel swaps the force model live", () => {
    const engine = new CpuEngine({ ...BASE, level: "L0" });
    expect(engine.observables().potentialEnergy).toBe(0);
    engine.setLevel("L1");
    // With particles on a jittered near-contact lattice, WCA gives positive PE.
    expect(engine.observables().potentialEnergy).toBeGreaterThan(0);
  });

  it("reset re-initialises and can change particle count", () => {
    const engine = new CpuEngine(BASE);
    engine.step(100);
    engine.reset({ particleCount: 64 });
    expect(engine.state.count).toBe(64);
    expect(engine.observables().step).toBe(0);
  });

  it("is deterministic for a given seed", () => {
    const a = new CpuEngine(BASE);
    const b = new CpuEngine(BASE);
    a.step(300);
    b.step(300);
    expect(Array.from(a.state.positions)).toEqual(Array.from(b.state.positions));
  });
});
