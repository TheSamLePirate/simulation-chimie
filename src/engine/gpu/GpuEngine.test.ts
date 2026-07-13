import { describe, expect, it } from "vitest";
import type { SimConfig } from "../types";
import { GpuEngine, unpackGpuVec3 } from "./GpuEngine";

describe("GPU engine buffer and L11 contracts", () => {
  it("removes the WebGPU vec3 alignment lane on readback", () => {
    expect(Array.from(unpackGpuVec3(Float32Array.from([1, 2, 3, 99, 4, 5, 6, 99]), 2))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(() => unpackGpuVec3(new Float32Array(5), 2)).toThrow(/buffer length/);
  });

  it("constructs the anisotropic L11 GPU system before the support gate is lifted", async () => {
    const config: SimConfig = {
      seed: 7,
      particleCount: 8,
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
    const engine = new GpuEngine(config);
    expect(engine.boxLengths.toArray()).toEqual([1.8, 1.8, 8]);
    expect((await engine.readPositions()).length).toBe(9 * config.particleCount);
  });
});
