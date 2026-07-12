import { describe, expect, it } from "vitest";
import { createBoxXYZ } from "../box";
import { computeEwald3d, ewaldKBounds } from "./ewald";
import { computeSmoothPme } from "./pme";

const box = createBoxXYZ(2.4, 2.6, 3.2, "periodic");
const sites = {
  count: 6,
  positions: Float64Array.from([
    -0.71, 0.12, -0.55, -0.23, -0.62, 0.81, 0.18, 0.43, -0.91, 0.57, -0.31, 0.22, 0.82, 0.71, 1.03,
    -0.49, 0.83, -0.17,
  ]),
  charges: Float64Array.from([0.71, -0.43, 0.29, -0.66, 0.54, -0.45]),
};

describe("smooth particle-mesh Ewald", () => {
  it("matches the converged direct Ewald energy and force oracle", () => {
    const alpha = 3.5;
    const bounds = ewaldKBounds(box, 2 * alpha * Math.sqrt(-Math.log(1e-11)));
    const direct = computeEwald3d(sites, box, {
      alpha,
      kMax: [bounds[0], bounds[1], bounds[2]],
      realImages: [1, 1, 1],
      slabCorrection: true,
    });
    const pme = computeSmoothPme(sites, box, {
      alpha,
      grid: [64, 64, 128],
      slabCorrection: true,
    });
    expect(Math.abs(pme.potentialEnergy - direct.potentialEnergy)).toBeLessThan(2e-5);
    let squaredError = 0;
    let squaredReference = 0;
    for (let i = 0; i < direct.forces.length; i++) {
      squaredError += (pme.forces[i] - direct.forces[i]) ** 2;
      squaredReference += direct.forces[i] ** 2;
    }
    expect(Math.sqrt(squaredError / squaredReference)).toBeLessThan(1e-5);
    expect(Math.abs((pme.virial - direct.virial) / direct.virial)).toBeLessThan(1e-5);
    for (let component = 0; component < 3; component++) {
      let total = 0;
      for (let i = 0; i < sites.count; i++) total += pme.forces[3 * i + component];
      expect(total).toBeCloseTo(0, 12);
    }
  });

  it("is the numerical gradient of its own mesh energy", () => {
    const options = { alpha: 3.5, grid: [64, 64, 128] as const, slabCorrection: true };
    const analytic = computeSmoothPme(sites, box, options).forces;
    const h = 1e-6;
    for (const coordinate of [0, 4, 11]) {
      const x = sites.positions[coordinate];
      sites.positions[coordinate] = x + h;
      const plus = computeSmoothPme(sites, box, options).potentialEnergy;
      sites.positions[coordinate] = x - h;
      const minus = computeSmoothPme(sites, box, options).potentialEnergy;
      sites.positions[coordinate] = x;
      const numeric = -(plus - minus) / (2 * h);
      const scale = Math.max(1, Math.abs(analytic[coordinate]), Math.abs(numeric));
      // The zero-total-force projection removes the tiny mesh translation mode; its
      // difference from the raw energy gradient converges with mesh refinement.
      expect(Math.abs(analytic[coordinate] - numeric) / scale).toBeLessThan(5e-6);
    }
  });

  it("rejects non-neutral systems and invalid grids", () => {
    expect(() =>
      computeSmoothPme({ ...sites, charges: Float64Array.from([1, 0, 0, 0, 0, 0]) }, box, {
        alpha: 3.5,
        grid: [32, 32, 32],
      }),
    ).toThrow(/neutral/);
    expect(() => computeSmoothPme(sites, box, { alpha: 3.5, grid: [30, 32, 32] })).toThrow(
      /powers of two/,
    );
  });
});
