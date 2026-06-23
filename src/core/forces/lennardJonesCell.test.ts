import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { placeOnLattice } from "../init";
import { Rng } from "../rng";
import { ARGON, OIL, WATER } from "../species";
import { createState } from "../state";
import { LennardJonesForce } from "./lennardJones";
import { LennardJonesCellForce } from "./lennardJonesCell";

function maxAbsDiff(a: Float64Array, b: Float64Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("LennardJonesCellForce ≡ O(N²) reference", () => {
  it("matches forces/energy/virial for a single-species liquid (cell path)", () => {
    const species = [ARGON];
    const box = createBox(4, "periodic"); // ~4 cells/axis ⇒ cell path
    const state = createState(400);
    placeOnLattice(state, box, { jitter: 0.3, rng: new Rng(3) });

    const brute = new LennardJonesForce().compute(state, box, species);
    const bruteForces = Float64Array.from(state.forces);
    const cell = new LennardJonesCellForce().compute(state, box, species);

    expect(maxAbsDiff(bruteForces, state.forces)).toBeLessThan(1e-6);
    expect(cell.potentialEnergy).toBeCloseTo(brute.potentialEnergy, 4);
    expect(cell.virial).toBeCloseTo(brute.virial, 4);
  });

  it("matches for a binary mixture with reduced cross-attraction", () => {
    const species = [WATER, OIL];
    const box = createBox(4.5, "periodic");
    const rng = new Rng(8);
    const types = new Uint8Array(432);
    for (let i = 0; i < types.length; i++) types[i] = rng.next() < 0.5 ? 1 : 0;
    const state = createState(432, types);
    placeOnLattice(state, box, { jitter: 0.3, rng });

    const brute = new LennardJonesForce(0.4).compute(state, box, species);
    const bruteForces = Float64Array.from(state.forces);
    const cell = new LennardJonesCellForce(0.4).compute(state, box, species);

    expect(maxAbsDiff(bruteForces, state.forces)).toBeLessThan(1e-6);
    expect(cell.potentialEnergy).toBeCloseTo(brute.potentialEnergy, 4);
  });

  it("falls back to brute for a box too small to grid", () => {
    const species = [ARGON];
    const box = createBox(1.5, "periodic"); // < 3 cells/axis ⇒ fallback
    const state = createState(64);
    placeOnLattice(state, box, { jitter: 0.2, rng: new Rng(5) });

    const brute = new LennardJonesForce().compute(state, box, species);
    const bruteForces = Float64Array.from(state.forces);
    const cell = new LennardJonesCellForce().compute(state, box, species);

    expect(maxAbsDiff(bruteForces, state.forces)).toBeLessThan(1e-9);
    expect(cell.potentialEnergy).toBeCloseTo(brute.potentialEnergy, 6);
  });
});
