import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { LennardJonesForce } from "../forces/lennardJones";
import { placeOnLattice, setMaxwellBoltzmannVelocities } from "../init";
import { velocityVerletStep } from "../integrators/velocityVerlet";
import { Rng } from "../rng";
import { OIL, WATER } from "../species";
import { createState } from "../state";
import { demixingOrderParameter } from "./demixing";

function halfHalfTypes(n: number, rng: Rng): Uint8Array {
  const ids = new Uint8Array(n);
  for (let i = 0; i < n; i++) ids[i] = rng.next() < 0.5 ? 1 : 0;
  return ids;
}

describe("demixingOrderParameter", () => {
  it("is ≈ 0.5 for a well-mixed 50/50 system", () => {
    const length = 8;
    const box = createBox(length, "periodic");
    const rng = new Rng(1);
    const state = createState(1500, halfHalfTypes(1500, rng));
    for (let i = 0; i < state.count; i++) {
      state.positions[3 * i] = rng.range(-length / 2, length / 2);
      state.positions[3 * i + 1] = rng.range(-length / 2, length / 2);
      state.positions[3 * i + 2] = rng.range(-length / 2, length / 2);
    }
    const op = demixingOrderParameter(state, box, 1.0);
    expect(op).toBeGreaterThan(0.42);
    expect(op).toBeLessThan(0.58);
  });

  it("is ≈ 1 for fully segregated clusters", () => {
    const box = createBox(20, "periodic");
    const rng = new Rng(2);
    const types = new Uint8Array(200);
    const state = createState(200, types);
    for (let i = 0; i < state.count; i++) {
      types[i] = i < 100 ? 0 : 1;
      const cx = i < 100 ? -5 : 5;
      state.positions[3 * i] = cx + rng.range(-0.6, 0.6);
      state.positions[3 * i + 1] = rng.range(-0.6, 0.6);
      state.positions[3 * i + 2] = rng.range(-0.6, 0.6);
    }
    expect(demixingOrderParameter(state, box, 1.0)).toBeGreaterThan(0.9);
  });
});

describe("immiscible binary mixture", () => {
  it("demixes over time when cross-attraction is reduced", () => {
    const species = [WATER, OIL];
    const box = createBox(4.2, "periodic");
    const rng = new Rng(11);
    const state = createState(432, halfHalfTypes(432, rng));
    placeOnLattice(state, box, { jitter: 0.1, rng });
    setMaxwellBoltzmannVelocities(state, species, 130, rng);

    const cutoff = 1.5 * Math.max(WATER.sigma, OIL.sigma);
    const force = new LennardJonesForce(0.2); // weak unlike attraction ⇒ immiscible
    force.compute(state, box, species);

    const before = demixingOrderParameter(state, box, cutoff);
    for (let s = 0; s < 5000; s++) velocityVerletStep(state, box, species, force, 0.004);
    const after = demixingOrderParameter(state, box, cutoff);

    expect(after).toBeGreaterThan(before + 0.03);
  }, 60_000);
});
