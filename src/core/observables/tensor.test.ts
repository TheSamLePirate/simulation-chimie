import { describe, expect, it } from "vitest";
import { createState } from "../state";
import type { Species } from "../types";
import {
  blockAverage,
  kineticTensor,
  planarSurfaceTension,
  pressureTensor,
  type SymmetricTensor3,
  surfaceTensionToMilliNewtonPerMeter,
} from "./tensor";

const SPECIES: readonly Species[] = [
  { name: "X", mass: 2, sigma: 0, epsilon: 0, charge: 0, color: 0, radius: 0.1 },
];

describe("tensor observables", () => {
  it("computes every component of the kinetic tensor", () => {
    const state = createState(2);
    state.velocities.set([1, 2, 3, -2, 1, 0.5]);
    expect(kineticTensor(state, SPECIES)).toEqual({
      xx: 10,
      yy: 10,
      zz: 18.5,
      xy: 0,
      xz: 4,
      yz: 13,
    });
  });

  it("forms the pressure tensor and planar mechanical surface tension", () => {
    const kinetic: SymmetricTensor3 = { xx: 4, yy: 6, zz: 8, xy: 2, xz: 0, yz: -2 };
    const virial: SymmetricTensor3 = { xx: 6, yy: 4, zz: 12, xy: 0, xz: 4, yz: 2 };
    const pressure = pressureTensor(kinetic, virial, 2);
    expect(pressure).toEqual({ xx: 5, yy: 5, zz: 10, xy: 1, xz: 2, yz: 0 });
    // Lz=4, two interfaces: γ = 2 × (10−5) = 10 kJ mol⁻¹ nm⁻².
    expect(planarSurfaceTension(pressure, 4)).toBe(10);
    expect(surfaceTensionToMilliNewtonPerMeter(10)).toBeCloseTo(16.6053906717, 10);
  });

  it("returns zero for invalid volume or interface geometry", () => {
    const t: SymmetricTensor3 = { xx: 1, yy: 1, zz: 1, xy: 0, xz: 0, yz: 0 };
    expect(pressureTensor(t, t, 0)).toEqual({ xx: 0, yy: 0, zz: 0, xy: 0, xz: 0, yz: 0 });
    expect(planarSurfaceTension(t, 0)).toBe(0);
    expect(planarSurfaceTension(t, 1, 0)).toBe(0);
  });
});

describe("block averaging", () => {
  it("uses equal blocks and reports their standard error", () => {
    const result = blockAverage([1, 3, 3, 5, 100], 2);
    expect(result.blockMeans).toEqual([2, 4]);
    expect(result.mean).toBe(3);
    expect(result.standardError).toBe(1);
    expect(result.samplesUsed).toBe(4);
  });

  it("handles empty and single-block inputs and rejects invalid sizes", () => {
    expect(blockAverage([], 4)).toEqual({
      mean: 0,
      standardError: 0,
      blockMeans: [],
      blocks: 0,
      samplesUsed: 0,
    });
    expect(blockAverage([2, 4], 2).standardError).toBe(0);
    expect(() => blockAverage([1], 0)).toThrow(RangeError);
  });
});
