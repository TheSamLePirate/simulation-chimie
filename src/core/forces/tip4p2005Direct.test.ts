import { describe, expect, it } from "vitest";
import { createBox, createBoxXYZ } from "../box";
import { totalMomentum } from "../observables";
import { Rng } from "../rng";
import {
  buildTip4p2005Slab,
  buildTip4p2005System,
  redistributeTip4pVirtualForce,
  TIP4P_2005,
  TIP4P_2005_H,
  TIP4P_2005_HH,
  TIP4P_2005_O,
  TIP4P_2005_SPECIES,
  tip4pVirtualPosition,
} from "../tip4p2005";
import { Tip4p2005DirectForce } from "./tip4p2005Direct";

const distance = (p: Float64Array, i: number, j: number) =>
  Math.hypot(p[3 * i] - p[3 * j], p[3 * i + 1] - p[3 * j + 1], p[3 * i + 2] - p[3 * j + 2]);

const cross = (r: readonly number[], f: readonly number[]) => [
  r[1] * f[2] - r[2] * f[1],
  r[2] * f[0] - r[0] * f[2],
  r[0] * f[1] - r[1] * f[0],
];

describe("TIP4P/2005 geometry and virtual site", () => {
  it("builds exact rigid geometry, neutral charge and Maxwell velocities", () => {
    const sys = buildTip4p2005System(8, createBox(4, "periodic"), 300, new Rng(9));
    expect(sys.state.count).toBe(24);
    expect(sys.constraints.i.length).toBe(24);
    for (let m = 0; m < 8; m++) {
      expect(distance(sys.state.positions, 3 * m, 3 * m + 1)).toBeCloseTo(TIP4P_2005.rOH, 12);
      expect(distance(sys.state.positions, 3 * m, 3 * m + 2)).toBeCloseTo(TIP4P_2005.rOH, 12);
      expect(distance(sys.state.positions, 3 * m + 1, 3 * m + 2)).toBeCloseTo(TIP4P_2005_HH, 12);
    }
    expect(2 * TIP4P_2005.chargeH + TIP4P_2005.chargeM).toBeCloseTo(0, 15);
    const momentum = totalMomentum(sys.state, sys.species);
    expect(Math.hypot(...momentum)).toBeLessThan(1e-12);
  });

  it("places M at rOM and redistributes force while preserving force and torque", () => {
    const half = TIP4P_2005.angleHOH / 2;
    const o = [0, 0, 0];
    const h1 = [TIP4P_2005.rOH * Math.sin(half), TIP4P_2005.rOH * Math.cos(half), 0];
    const h2 = [-h1[0], h1[1], 0];
    const m = tip4pVirtualPosition(o, h1, h2);
    expect(Math.hypot(...m)).toBeCloseTo(TIP4P_2005.rOM, 15);

    const f = [2.5, -1.2, 0.7];
    const d = redistributeTip4pVirtualForce(f);
    for (let c = 0; c < 3; c++) {
      expect(d.oxygen[c] + d.hydrogen1[c] + d.hydrogen2[c]).toBeCloseTo(f[c], 15);
    }
    const torqueM = cross(m, f);
    const to = cross(o, d.oxygen);
    const th1 = cross(h1, d.hydrogen1);
    const th2 = cross(h2, d.hydrogen2);
    for (let c = 0; c < 3; c++) {
      expect(to[c] + th1[c] + th2[c]).toBeCloseTo(torqueM[c], 15);
    }
  });
});

describe("TIP4P/2005 liquid slab", () => {
  it("builds 1024 waters at the requested density with centred vacuum", () => {
    const box = createBoxXYZ(3.2, 3.2, 10, "periodic");
    const slab = buildTip4p2005Slab(1024, box, 300, new Rng(91), 997);
    const molecularMass = TIP4P_2005_O.mass + 2 * TIP4P_2005_H.mass;
    const density =
      (1024 * molecularMass * 1.6605390666) /
      (box.lengths[0] * box.lengths[1] * slab.liquidThickness);
    expect(density).toBeCloseTo(997, 12);
    expect(slab.liquidThickness).toBeCloseTo(3, 2);
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let molecule = 0; molecule < 1024; molecule++) {
      const oxygen = 3 * molecule;
      minZ = Math.min(minZ, slab.state.positions[3 * oxygen + 2]);
      maxZ = Math.max(maxZ, slab.state.positions[3 * oxygen + 2]);
      expect(distance(slab.state.positions, oxygen, oxygen + 1)).toBeCloseTo(TIP4P_2005.rOH, 12);
    }
    expect(minZ).toBeGreaterThan(-slab.liquidThickness / 2);
    expect(maxZ).toBeLessThan(slab.liquidThickness / 2);
  });

  it("rejects impossible slab specifications", () => {
    expect(() => buildTip4p2005Slab(3, createBox(2), 300, new Rng(1))).toThrow(/even/);
    expect(() => buildTip4p2005Slab(1024, createBoxXYZ(1, 1, 1), 300, new Rng(1))).toThrow(
      /does not fit/,
    );
  });
});

describe("TIP4P/2005 isolated-pair oracle", () => {
  function dimer() {
    const box = createBox(20, "reflective");
    const sys = buildTip4p2005System(2, box, 0, new Rng(4));
    const p = sys.state.positions;
    const target = [p[0] + 0.34, p[1] + 0.06, p[2] - 0.02];
    const shift = [target[0] - p[9], target[1] - p[10], target[2] - p[11]];
    for (let atom = 3; atom < 6; atom++) {
      p[3 * atom] += shift[0];
      p[3 * atom + 1] += shift[1];
      p[3 * atom + 2] += shift[2];
    }
    return { box, sys };
  }

  it("matches the numerical energy gradient on all atomic coordinates", () => {
    const { box, sys } = dimer();
    const force = new Tip4p2005DirectForce();
    force.compute(sys.state, box, TIP4P_2005_SPECIES);
    const analytic = Float64Array.from(sys.state.forces);
    const h = 1e-6;
    for (let q = 0; q < sys.state.positions.length; q++) {
      const x = sys.state.positions[q];
      sys.state.positions[q] = x + h;
      const ep = force.compute(sys.state, box, TIP4P_2005_SPECIES).potentialEnergy;
      sys.state.positions[q] = x - h;
      const em = force.compute(sys.state, box, TIP4P_2005_SPECIES).potentialEnergy;
      sys.state.positions[q] = x;
      const numeric = -(ep - em) / (2 * h);
      const scale = Math.max(1, Math.abs(numeric), Math.abs(analytic[q]));
      expect(Math.abs(analytic[q] - numeric) / scale).toBeLessThan(2e-7);
    }
  });

  it("conserves total force and rejects periodic minimum-image Coulomb", () => {
    const { box, sys } = dimer();
    const force = new Tip4p2005DirectForce();
    force.compute(sys.state, box, TIP4P_2005_SPECIES);
    for (let c = 0; c < 3; c++) {
      let total = 0;
      for (let i = 0; i < sys.state.count; i++) total += sys.state.forces[3 * i + c];
      expect(total).toBeCloseTo(0, 10);
    }
    expect(() => force.compute(sys.state, createBox(20, "periodic"), TIP4P_2005_SPECIES)).toThrow(
      "require Ewald",
    );
  });
});
