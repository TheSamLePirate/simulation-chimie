import { describe, expect, it } from "vitest";
import { createBox, createBoxXYZ } from "../box";
import { COULOMB_CONSTANT } from "../units";
import { computeEwald3d, type EwaldOptions, ewaldKBounds } from "./ewald";

const OPTIONS: EwaldOptions = {
  alpha: 3.5,
  kMax: [12, 12, 12],
  realImages: [1, 1, 1],
};

function neutralSites() {
  return {
    count: 4,
    positions: new Float64Array([
      -0.31, 0.12, -0.23, 0.28, -0.17, 0.19, -0.08, -0.33, 0.37, 0.34, 0.29, -0.11,
    ]),
    charges: new Float64Array([0.7, -0.7, 0.4, -0.4]),
  };
}

describe("direct Ewald oracle", () => {
  it("matches the numerical energy gradient on every coordinate", () => {
    const sites = neutralSites();
    const box = createBox(2.4, "periodic");
    const result = computeEwald3d(sites, box, OPTIONS);
    const h = 2e-6;
    for (let q = 0; q < sites.positions.length; q++) {
      const x = sites.positions[q];
      sites.positions[q] = x + h;
      const ep = computeEwald3d(sites, box, OPTIONS).potentialEnergy;
      sites.positions[q] = x - h;
      const em = computeEwald3d(sites, box, OPTIONS).potentialEnergy;
      sites.positions[q] = x;
      const numeric = -(ep - em) / (2 * h);
      const scale = Math.max(1, Math.abs(numeric), Math.abs(result.forces[q]));
      expect(Math.abs(result.forces[q] - numeric) / scale).toBeLessThan(3e-6);
    }
  });

  it("is translationally invariant and conserves total force", () => {
    const sites = neutralSites();
    const box = createBox(2.4, "periodic");
    const a = computeEwald3d(sites, box, OPTIONS);
    for (let i = 0; i < sites.count; i++) {
      sites.positions[3 * i] += 0.173;
      sites.positions[3 * i + 1] -= 0.219;
      sites.positions[3 * i + 2] += 0.087;
    }
    const b = computeEwald3d(sites, box, OPTIONS);
    expect(b.potentialEnergy).toBeCloseTo(a.potentialEnergy, 10);
    for (let c = 0; c < 3; c++) {
      let total = 0;
      for (let i = 0; i < sites.count; i++) total += b.forces[3 * i + c];
      expect(total).toBeCloseTo(0, 10);
    }
  });

  it("is stable against a different Ewald splitting", () => {
    const sites = neutralSites();
    const box = createBox(2.4, "periodic");
    const a = computeEwald3d(sites, box, OPTIONS);
    const b = computeEwald3d(sites, box, {
      alpha: 4.25,
      kMax: [15, 15, 15],
      realImages: [1, 1, 1],
    });
    expect(b.potentialEnergy).toBeCloseTo(a.potentialEnergy, 4);
    let maxForceDiff = 0;
    for (let i = 0; i < a.forces.length; i++) {
      maxForceDiff = Math.max(maxForceDiff, Math.abs(a.forces[i] - b.forces[i]));
    }
    expect(maxForceDiff).toBeLessThan(2e-4);
  });

  it("adds the exact Yeh–Berkowitz slab energy and force correction", () => {
    const sites = {
      count: 2,
      positions: new Float64Array([0, 0, 0.4, 0, 0, -0.4]),
      charges: new Float64Array([1, -1]),
    };
    const box = createBoxXYZ(2, 2, 5, "periodic");
    const base = computeEwald3d(sites, box, OPTIONS);
    const slab = computeEwald3d(sites, box, { ...OPTIONS, slabCorrection: true });
    const volume = 20;
    const mz = 0.8;
    const expectedEnergy = (COULOMB_CONSTANT * 2 * Math.PI * mz * mz) / volume;
    const expectedForce0 = (-COULOMB_CONSTANT * 4 * Math.PI * mz) / volume;
    expect(slab.slabEnergy).toBeCloseTo(expectedEnergy, 12);
    expect(slab.potentialEnergy - base.potentialEnergy).toBeCloseTo(expectedEnergy, 10);
    expect(slab.forces[2] - base.forces[2]).toBeCloseTo(expectedForce0, 10);
    expect(slab.forces[5] - base.forces[5]).toBeCloseTo(-expectedForce0, 10);
  });

  it("rejects non-neutral or malformed inputs and sizes reciprocal bounds per axis", () => {
    const box = createBoxXYZ(2, 3, 4, "periodic");
    expect(ewaldKBounds(box, 2 * Math.PI)).toEqual([2, 3, 4]);
    expect(() =>
      computeEwald3d({ count: 1, positions: [0, 0, 0], charges: [1] }, box, OPTIONS),
    ).toThrow("neutral");
    expect(() => computeEwald3d(neutralSites(), box, { ...OPTIONS, alpha: 0 })).toThrow(RangeError);
  });
});
