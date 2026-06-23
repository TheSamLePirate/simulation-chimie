import { describe, expect, it } from "vitest";
import { createBox } from "./box";
import { NoForce } from "./forces/none";
import { placeOnLattice, setMaxwellBoltzmannVelocities } from "./init";
import { velocityVerletStep } from "./integrators/velocityVerlet";
import { Rng } from "./rng";
import { ARGON } from "./species";
import { createState } from "./state";

const SPECIES = [ARGON];

function meanY(positions: Float64Array, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += positions[3 * i + 1];
  return sum / count;
}

function makeSystem() {
  const box = createBox(5, "reflective");
  const state = createState(400);
  const rng = new Rng(1);
  placeOnLattice(state, box, { jitter: 0.05, rng });
  setMaxwellBoltzmannVelocities(state, SPECIES, 120, rng);
  NoForce.compute(state, box, SPECIES);
  return { state, box };
}

describe("gravity", () => {
  it("pulls the centre of mass downward (sedimentation)", () => {
    const { state, box } = makeSystem();
    const before = meanY(state.positions, state.count);
    for (let s = 0; s < 2000; s++) {
      velocityVerletStep(state, box, SPECIES, NoForce, 0.005, 0.12);
    }
    const after = meanY(state.positions, state.count);
    expect(after).toBeLessThan(before - 0.5);
  });

  it("leaves the centre of mass put when gravity is off", () => {
    const { state, box } = makeSystem();
    const before = meanY(state.positions, state.count);
    for (let s = 0; s < 2000; s++) {
      velocityVerletStep(state, box, SPECIES, NoForce, 0.005, 0);
    }
    const after = meanY(state.positions, state.count);
    expect(Math.abs(after - before)).toBeLessThan(0.1);
  });
});
