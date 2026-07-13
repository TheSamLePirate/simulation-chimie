import { describe, expect, it } from "vitest";
import { buildSystem } from "./buildSystem";
import { CpuEngine } from "./cpu/CpuEngine";
import type { SimConfig } from "./types";

const base: SimConfig = {
  seed: 1234,
  particleCount: 64,
  boxLength: 2,
  boundary: "periodic",
  temperature: 300,
  timestep: 0.001,
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

/**
 * The GPU engine builds its initial system via {@link buildSystem}; the CPU reference engine
 * builds it internally. They MUST agree atom-for-atom (same seed) or GPU and CPU diverge. This
 * pins that lock-step across representative levels, including molecular ones.
 */
describe("buildSystem matches the CPU engine initial state", () => {
  const cases: Array<[string, Partial<SimConfig>]> = [
    ["L1 monatomic", { level: "L1", particleCount: 64 }],
    [
      "L3 ionic (rock-salt)",
      {
        level: "L3",
        speciesName: "SODIUM",
        secondSpeciesName: "CHLORIDE",
        fractionSecond: 0.5,
        particleCount: 64,
        boxLength: 1.5,
      },
    ],
    [
      "L4 flexible water",
      {
        level: "L4",
        speciesName: "WATER_O",
        particleCount: 32,
        boxLength: 1.6,
        timestep: 0.0005,
      },
    ],
    [
      "L5 rigid water",
      {
        level: "L5",
        speciesName: "WATER_O",
        particleCount: 32,
        boxLength: 1.7,
        timestep: 0.002,
      },
    ],
    [
      "L8 dissolution",
      {
        level: "L8",
        speciesName: "WATER_O",
        secondSpeciesName: "SODIUM",
        particleCount: 27,
        boxLength: 2,
        timestep: 0.002,
      },
    ],
    [
      "L11 TIP4P/2005 slab",
      {
        level: "L11",
        speciesName: "WATER_O",
        particleCount: 8,
        boxLength: 1.8,
        timestep: 0.002,
        thermostat: "csvr",
        thermostatTau: 1,
      },
    ],
  ];

  for (const [name, patch] of cases) {
    it(name, () => {
      const config = { ...base, ...patch };
      const cpu = new CpuEngine(config);
      const sys = buildSystem(config);
      expect(sys.state.count).toBe(cpu.state.count);
      expect(Array.from(sys.state.typeIds)).toEqual(Array.from(cpu.state.typeIds));
      // Positions + velocities identical to float precision (deterministic seeded build).
      for (let i = 0; i < sys.state.positions.length; i++) {
        expect(sys.state.positions[i]).toBeCloseTo(cpu.state.positions[i], 10);
        expect(sys.state.velocities[i]).toBeCloseTo(cpu.state.velocities[i], 10);
      }
    });
  }
});
