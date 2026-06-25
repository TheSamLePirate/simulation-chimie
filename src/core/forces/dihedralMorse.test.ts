import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { createState } from "../state";
import type { Species } from "../types";
import { type AngleList, type BondList, type DihedralList, MolecularForce } from "./molecular";

const C: Species = {
  name: "C",
  mass: 12,
  sigma: 0.35,
  epsilon: 0.3,
  charge: 0,
  color: 0x808080,
  radius: 0.17,
};

const EMPTY_BONDS: BondList = {
  i: new Int32Array(0),
  j: new Int32Array(0),
  r0: new Float64Array(0),
  k: new Float64Array(0),
};
const EMPTY_ANGLES: AngleList = {
  i: new Int32Array(0),
  j: new Int32Array(0),
  k: new Int32Array(0),
  theta0: new Float64Array(0),
  kt: new Float64Array(0),
};

/** Total PE for a set of positions (forces ignored). */
function energyAt(force: MolecularForce, pos: number[]): number {
  const box = createBox(100, "periodic"); // large ⇒ no min-image wrap intrudes
  // All 4 atoms in one molecule ⇒ non-bonded excluded; only the bonded term acts.
  const state = createState(4, new Uint8Array([0, 0, 0, 0]), new Int32Array([0, 0, 0, 0]));
  state.positions.set(pos);
  return force.compute(state, box, [C]).potentialEnergy;
}

/** Central-difference −∂PE/∂x_a for every coordinate ⇒ the analytic force must match. */
function numericalForces(force: MolecularForce, pos: number[]): Float64Array {
  const h = 1e-6;
  const out = new Float64Array(pos.length);
  for (let a = 0; a < pos.length; a++) {
    const plus = pos.slice();
    const minus = pos.slice();
    plus[a] += h;
    minus[a] -= h;
    out[a] = -(energyAt(force, plus) - energyAt(force, minus)) / (2 * h);
  }
  return out;
}

function analyticForces(force: MolecularForce, pos: number[]): Float64Array {
  const box = createBox(100, "periodic");
  const state = createState(4, new Uint8Array([0, 0, 0, 0]), new Int32Array([0, 0, 0, 0]));
  state.positions.set(pos);
  force.compute(state, box, [C]);
  return state.forces;
}

describe("dihedral (Ryckaert-Bellemans) force", () => {
  // OPLS butane RB converted to the cos(φ) basis (c'_n = (−1)ⁿ·C_n).
  const dih: DihedralList = {
    i: new Int32Array([0]),
    j: new Int32Array([1]),
    k: new Int32Array([2]),
    l: new Int32Array([3]),
    c: Float64Array.from([9.28, -12.16, -13.12, 3.06, 26.24, 31.5]),
  };
  const force = new MolecularForce(EMPTY_BONDS, EMPTY_ANGLES, 2.5, 0.9, dih);

  // A generic, non-planar 4-atom chain (so the torsion is well away from 0/π singularities).
  const pos = [0.0, 0.0, 0.0, 0.15, 0.0, 0.0, 0.21, 0.14, 0.0, 0.35, 0.18, 0.09];

  it("matches the numerical gradient of the energy (every coordinate)", () => {
    const a = analyticForces(force, pos);
    const num = numericalForces(force, pos);
    for (let q = 0; q < 12; q++) expect(a[q]).toBeCloseTo(num[q], 4);
  });

  it("conserves momentum (Σ forces = 0)", () => {
    const a = analyticForces(force, pos);
    for (let c = 0; c < 3; c++) {
      expect(a[c] + a[3 + c] + a[6 + c] + a[9 + c]).toBeCloseTo(0, 8);
    }
  });

  it("has trans (φ = 180°) lower in energy than cis (φ = 0°)", () => {
    // j-k along +x; i is +y of j. Trans: l is −y of k (anti). Cis: l is +y of k (eclipsed).
    const trans = [0, 0.1, 0, 0, 0, 0, 0.15, 0, 0, 0.15, -0.1, 0];
    const cis = [0, 0.1, 0, 0, 0, 0, 0.15, 0, 0, 0.15, 0.1, 0];
    expect(energyAt(force, trans)).toBeLessThan(energyAt(force, cis));
    expect(energyAt(force, trans)).toBeCloseTo(0, 4); // RB trans minimum ≈ 0
  });
});

describe("Morse bond", () => {
  const r0 = 0.15;
  const k = 200000; // harmonic-equivalent stiffness
  const a = 20; // width (nm⁻¹)
  const bonds: BondList = {
    i: new Int32Array([0]),
    j: new Int32Array([1]),
    r0: Float64Array.from([r0]),
    k: Float64Array.from([k]),
    morseA: Float64Array.from([a]),
  };
  const force = new MolecularForce(bonds, EMPTY_ANGLES);

  function pairForceAt(r: number): Float64Array {
    const box = createBox(100, "periodic");
    const state = createState(
      2,
      new Uint8Array([0, 0]),
      new Int32Array([0, 0]), // same molecule ⇒ no non-bonded LJ, isolate the Morse bond
    );
    state.positions.set([0, 0, 0, r, 0, 0]);
    force.compute(state, box, [C]);
    return state.forces;
  }
  function energyR(r: number): number {
    const box = createBox(100, "periodic");
    const state = createState(
      2,
      new Uint8Array([0, 0]),
      new Int32Array([0, 0]), // same molecule ⇒ no non-bonded LJ, isolate the Morse bond
    );
    state.positions.set([0, 0, 0, r, 0, 0]);
    return force.compute(state, box, [C]).potentialEnergy;
  }

  it("force matches −dV/dr (numerical) across the well", () => {
    const h = 1e-7;
    for (const r of [0.12, 0.15, 0.18, 0.25]) {
      const fx = pairForceAt(r)[0]; // force on atom 0 along x (= +∂... on the −x side)
      const numF = -(energyR(r + h) - energyR(r - h)) / (2 * h);
      // atom 0 sits at the −x end, so its x-force = −(dV/dr). Compare magnitudes/signs via atom 1.
      expect(fx).toBeCloseTo(numF * -1, 2);
    }
  });

  it("has zero force at the minimum r0 and Dₑ = k/(2a²) well depth", () => {
    expect(pairForceAt(r0)[0]).toBeCloseTo(0, 6);
    const De = k / (2 * a * a);
    // Far dissociation energy → Dₑ.
    expect(energyR(2.0)).toBeCloseTo(De, 1);
  });

  it("force vanishes as the bond breaks (r ≫ r0) — unlike a harmonic spring", () => {
    const fFar = Math.abs(pairForceAt(1.5)[0]);
    const fNear = Math.abs(pairForceAt(0.18)[0]);
    expect(fFar).toBeLessThan(1e-3); // essentially dissociated
    expect(fNear).toBeGreaterThan(100); // still strongly bound near r0
  });
});
