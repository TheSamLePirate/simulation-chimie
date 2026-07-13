import { describe, expect, it } from "vitest";
import type { SimConfig } from "../engine/types";
import { gpuSupportsConfig } from "./drivers";

describe("GPU support gate", () => {
  it("admits validated L11 NVT but keeps NPT on the CPU", () => {
    const config: SimConfig = {
      seed: 1,
      particleCount: 256,
      boxLength: 1.8,
      boundary: "periodic",
      temperature: 300,
      timestep: 0.002,
      level: "L11",
      speciesName: "WATER_O",
      secondSpeciesName: null,
      fractionSecond: 0,
      crossScale: 1,
      thermostat: "csvr",
      thermostatTau: 1,
      barostat: "none",
      pressureTarget: 1,
      gravity: 0,
      engineKind: "gpu",
    };
    expect(gpuSupportsConfig(config)).toBe(true);
    expect(gpuSupportsConfig({ ...config, barostat: "berendsen" })).toBe(false);
  });
});
