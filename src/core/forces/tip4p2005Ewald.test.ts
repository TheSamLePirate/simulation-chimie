import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { Rng } from "../rng";
import { buildTip4p2005System, TIP4P_2005_SPECIES } from "../tip4p2005";
import { Tip4p2005EwaldForce } from "./tip4p2005Ewald";

const OPTIONS = {
  alpha: 3.5,
  kMax: [10, 10, 10] as const,
  realImages: [1, 1, 1] as const,
};

function periodicDimer() {
  const box = createBox(2.4, "periodic");
  const sys = buildTip4p2005System(2, box, 0, new Rng(7));
  const p = sys.state.positions;
  const target = [p[0] + 0.36, p[1] + 0.07, p[2] - 0.03];
  const shift = [target[0] - p[9], target[1] - p[10], target[2] - p[11]];
  for (let atom = 3; atom < 6; atom++) {
    p[3 * atom] += shift[0];
    p[3 * atom + 1] += shift[1];
    p[3 * atom + 2] += shift[2];
  }
  return { box, sys };
}

describe("TIP4P/2005 periodic Ewald force", () => {
  it("matches the energy gradient on all massive coordinates", () => {
    const { box, sys } = periodicDimer();
    const force = new Tip4p2005EwaldForce(OPTIONS);
    force.compute(sys.state, box, TIP4P_2005_SPECIES);
    const analytic = Float64Array.from(sys.state.forces);
    const h = 2e-6;
    for (let q = 0; q < sys.state.positions.length; q++) {
      const x = sys.state.positions[q];
      sys.state.positions[q] = x + h;
      const ep = force.compute(sys.state, box, TIP4P_2005_SPECIES).potentialEnergy;
      sys.state.positions[q] = x - h;
      const em = force.compute(sys.state, box, TIP4P_2005_SPECIES).potentialEnergy;
      sys.state.positions[q] = x;
      const numeric = -(ep - em) / (2 * h);
      const scale = Math.max(1, Math.abs(numeric), Math.abs(analytic[q]));
      expect(Math.abs(analytic[q] - numeric) / scale).toBeLessThan(4e-6);
    }
  });

  it("conserves total force and is invariant when a molecule straddles a boundary", () => {
    const { box, sys } = periodicDimer();
    const force = new Tip4p2005EwaldForce(OPTIONS);
    const a = force.compute(sys.state, box, TIP4P_2005_SPECIES);
    const forcesA = Float64Array.from(sys.state.forces);
    for (let c = 0; c < 3; c++) {
      let total = 0;
      for (let i = 0; i < sys.state.count; i++) total += forcesA[3 * i + c];
      expect(total).toBeCloseTo(0, 9);
    }

    // Move one H by exactly one lattice vector: physical geometry and energy must not change.
    sys.state.positions[3] += box.lengths[0];
    const b = force.compute(sys.state, box, TIP4P_2005_SPECIES);
    expect(b.potentialEnergy).toBeCloseTo(a.potentialEnergy, 9);
    for (let i = 0; i < forcesA.length; i++) {
      expect(sys.state.forces[i]).toBeCloseTo(forcesA[i], 8);
    }
  });

  it("includes a finite scalar Ewald virial and supports the slab correction", () => {
    const { box, sys } = periodicDimer();
    const bulk = new Tip4p2005EwaldForce(OPTIONS);
    const slab = new Tip4p2005EwaldForce({ ...OPTIONS, slabCorrection: true });
    const a = bulk.compute(sys.state, box, TIP4P_2005_SPECIES);
    const b = slab.compute(sys.state, box, TIP4P_2005_SPECIES);
    expect(Number.isFinite(a.virial)).toBe(true);
    expect(Number.isFinite(b.virial)).toBe(true);
    expect(slab.lastEwald?.slabEnergy).not.toBe(0);
  });
});
