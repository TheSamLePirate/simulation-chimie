import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { buildOilWaterSystem } from "../mixture";
import { Rng } from "../rng";
import { OIL_CH2, OIL_CH3, WATER_H, WATER_O } from "../species";
import { createState } from "../state";
import type { SimState } from "../types";
import { type AngleList, type BondList, MolecularForce } from "./molecular";

const SPECIES = [WATER_O, WATER_H, OIL_CH3, OIL_CH2];
const BIG_BOX = createBox(100, "reflective");

const OIL_BONDS: BondList = {
  i: Int32Array.from([0, 1]),
  j: Int32Array.from([1, 2]),
  r0: Float64Array.from([0.154, 0.154]),
  k: Float64Array.from([200000, 200000]),
};
const OIL_ANGLES: AngleList = {
  i: Int32Array.from([0]),
  j: Int32Array.from([1]),
  k: Int32Array.from([2]),
  theta0: Float64Array.from([(114 * Math.PI) / 180]),
  kt: Float64Array.from([519.6]),
};

function cloneWith(base: SimState, idx: number, delta: number): SimState {
  const s = createState(base.count, base.typeIds.slice(), base.moleculeId.slice());
  s.positions.set(base.positions);
  s.positions[idx] += delta;
  return s;
}

describe("MolecularForce bonded terms vs numerical gradient (oil molecule)", () => {
  it("bond + angle forces match −dV/d(position)", () => {
    const force = new MolecularForce(OIL_BONDS, OIL_ANGLES);
    // CH3–CH2–CH3, one molecule, off-equilibrium bent geometry.
    const state = createState(3, Uint8Array.from([2, 3, 2]), Int32Array.from([0, 0, 0]));
    state.positions.set([0.15, 0.02, 0, 0, 0, 0, -0.13, 0.05, 0.01]);

    const h = 1e-6;
    for (const [atom, comp] of [
      [0, 0],
      [0, 1],
      [2, 2],
      [1, 1],
    ] as const) {
      const idx = 3 * atom + comp;
      const pot = (d: number) =>
        force.compute(cloneWith(state, idx, d), BIG_BOX, SPECIES).potentialEnergy;
      const numeric = -(pot(h) - pot(-h)) / (2 * h);
      const s = cloneWith(state, idx, 0);
      force.compute(s, BIG_BOX, SPECIES);
      expect(s.forces[idx]).toBeCloseTo(numeric, 1);
    }
  });
});

describe("buildOilWaterSystem", () => {
  it("assembles the right atom/bond/constraint counts", () => {
    const box = createBox(3, "reflective");
    const sys = buildOilWaterSystem(40, 20, box, 300, new Rng(7));
    expect(sys.state.count).toBe(60 * 3);
    expect(sys.species.length).toBe(4);
    // Oil: 2 bonds + 1 angle per molecule; water: 3 distance constraints per molecule.
    expect(sys.bonds.i.length).toBe(20 * 2);
    expect(sys.angles.j.length).toBe(20);
    expect(sys.constraints.i.length).toBe(40 * 3);
    expect(sys.state.positions.every((x) => Number.isFinite(x))).toBe(true);
  });
});
