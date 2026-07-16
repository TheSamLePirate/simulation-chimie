import { describe, expect, it } from "vitest";
import { CpuEngine } from "../../engine/cpu/CpuEngine";
import type { SimConfig } from "../../engine/types";

const NACL: SimConfig = {
  seed: 1234,
  particleCount: 216, // 6×6×6 rock-salt
  boxLength: 1.75, // tight: Cl σ=0.44 ⇒ 2.5σ=1.1 nm > L/2=0.85 nm
  boundary: "periodic",
  temperature: 300,
  timestep: 0.001,
  level: "L3",
  speciesName: "SODIUM",
  secondSpeciesName: "CHLORIDE",
  fractionSecond: 0.5,
  crossScale: 1,
  thermostat: "berendsen",
  thermostatTau: 0.2,
  barostat: "none",
  pressureTarget: 1,
  gravity: 0,
  engineKind: "cpu",
};

/**
 * Regression: with an uncapped LJ cutoff, a tight NaCl crystal (box < 2·2.5σ_Cl) has each ion
 * interacting with a neighbour AND its periodic image — double-counted forces that slowly blow
 * the crystal up (it reached ~1e62 K after a few ps). Capping every cutoff at the minimum-image
 * limit (≤ L/2) keeps it a stable, thermostatted crystal near the target temperature.
 */
describe("minimum-image cutoff stability (tight NaCl)", () => {
  it("stays near the target temperature over ~10 ps instead of exploding", () => {
    const engine = new CpuEngine(NACL);
    for (let i = 0; i < 20; i++) engine.step(500); // 10 000 steps × 1 fs = 10 ps
    const T = engine.observables().temperature;
    expect(Number.isFinite(T)).toBe(true);
    expect(T).toBeGreaterThan(150);
    expect(T).toBeLessThan(600); // was ~1e62 K before the cap
    // 10k O(N²) ionic steps take ~9 s alone but can exceed 40 s when the suite saturates the
    // CPU in parallel. Time out generously so contention reads as slow, never as bad physics.
  }, 90_000);
});
