import { describe, expect, it } from "vitest";
import { createBoxXYZ } from "../box";
import { TIP4P_2005 } from "../tip4p2005";
import { planarLennardJonesTailCorrection } from "./planarDispersionTail";

describe("planar Lennard-Jones long-range correction", () => {
  it("recovers the homogeneous bulk tail energy and zero mean force", () => {
    const count = 256;
    const box = createBoxXYZ(2, 2, 8, "periodic");
    const positions = new Float64Array(3 * count);
    for (let i = 0; i < count; i++) positions[3 * i + 2] = -4 + ((i + 0.5) * 8) / count;
    const density = (count - 1) / (2 * 2 * 8);
    for (const cutoff of [0.8, 0.9, 1.1]) {
      const result = planarLennardJonesTailCorrection(
        positions,
        box,
        TIP4P_2005.sigmaO,
        TIP4P_2005.epsilonO,
        cutoff,
        256,
        16,
      );
      const expectedPerParticle =
        8 *
        Math.PI *
        density *
        TIP4P_2005.epsilonO *
        (TIP4P_2005.sigmaO ** 12 / (9 * cutoff ** 9) - TIP4P_2005.sigmaO ** 6 / (3 * cutoff ** 3));
      expect(
        Math.abs(result.potentialEnergy / count - expectedPerParticle) /
          Math.abs(expectedPerParticle),
      ).toBeLessThan(0.02);
      expect(Math.abs(result.forcesZ.reduce((sum, force) => sum + force, 0))).toBeLessThan(1e-10);
    }
  });

  it("pulls the two faces of a liquid slab toward its dense centre", () => {
    const box = createBoxXYZ(3, 3, 10, "periodic");
    const positions = new Float64Array(3 * 80);
    for (let i = 0; i < 80; i++) positions[3 * i + 2] = -1 + (2 * i) / 79;
    const result = planarLennardJonesTailCorrection(
      positions,
      box,
      TIP4P_2005.sigmaO,
      TIP4P_2005.epsilonO,
      0.8,
      80,
    );
    expect(result.forcesZ[0]).toBeGreaterThan(0);
    expect(result.forcesZ.at(-1)).toBeLessThan(0);
    expect(Number.isFinite(result.potentialEnergy)).toBe(true);
  });

  it("is invariant under a full periodic translation", () => {
    const box = createBoxXYZ(2, 2, 6, "periodic");
    const positions = Float64Array.from([0, 0, -1, 0, 0, -0.2, 0, 0, 0.4, 0, 0, 1.1]);
    const a = planarLennardJonesTailCorrection(positions, box, 0.32, 0.8, 0.8, 60);
    for (let i = 2; i < positions.length; i += 3) positions[i] += box.lengths[2];
    const b = planarLennardJonesTailCorrection(positions, box, 0.32, 0.8, 0.8, 60);
    expect(b.potentialEnergy).toBeCloseTo(a.potentialEnergy, 11);
    for (let i = 0; i < a.forcesZ.length; i++) expect(b.forcesZ[i]).toBeCloseTo(a.forcesZ[i], 11);
  });
});
