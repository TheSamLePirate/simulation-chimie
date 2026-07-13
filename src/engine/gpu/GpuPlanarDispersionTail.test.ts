import { instancedArray } from "three/tsl";
import { describe, expect, it } from "vitest";
import { GpuPlanarDispersionTail } from "./GpuPlanarDispersionTail";

describe("GPU Janecek planar tail contract", () => {
  it("validates bins and builds the four-pass convolution", () => {
    const positions = instancedArray(new Float32Array(24), "vec3");
    const forces = instancedArray(new Float32Array(24), "vec3");
    const energyVirial = instancedArray(new Float32Array(16), "vec2");
    const make = (bins: number) =>
      new GpuPlanarDispersionTail({
        molecules: 8,
        atomicPositions: positions,
        targetForces: forces,
        targetEnergyVirial: energyVirial,
        boxLengths: [2, 2, 8],
        sigma: 0.31589,
        epsilon: 0.7749,
        cutoff: 0.98,
        bins,
      });
    expect(make(80).kernels()).toHaveLength(4);
    expect(() => make(1)).toThrow(/bins/);
  });
});
