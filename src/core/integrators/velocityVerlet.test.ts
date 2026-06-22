import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { WcaForce } from "../forces/wca";
import { placeOnLattice, setMaxwellBoltzmannVelocities } from "../init";
import { kineticEnergy, totalMomentum } from "../observables";
import { Rng } from "../rng";
import { ARGON } from "../species";
import { createState } from "../state";
import type { Box, SimState } from "../types";
import { velocityVerletStep } from "./velocityVerlet";

const SPECIES = [ARGON];

/** A 64-particle argon system at near-contact spacing so WCA forces are active. */
function makeSystem(seed: number): { state: SimState; box: Box } {
  const count = 64;
  const box = createBox(1.4, "periodic"); // spacing 0.35 nm < cutoff ⇒ repulsion
  const state = createState(count);
  placeOnLattice(state, box);
  setMaxwellBoltzmannVelocities(state, SPECIES, 120, new Rng(seed));
  return { state, box };
}

describe("velocityVerletStep", () => {
  const force = new WcaForce();

  it("conserves total energy under NVE (symplectic, bounded drift)", () => {
    const { state, box } = makeSystem(1);
    let res = force.compute(state, box, SPECIES); // F(0)
    const energy0 = kineticEnergy(state, SPECIES) + res.potentialEnergy;

    let minE = energy0;
    let maxE = energy0;
    const dt = 0.002; // ps (2 fs)
    for (let step = 0; step < 1500; step++) {
      res = velocityVerletStep(state, box, SPECIES, force, dt);
      const energy = kineticEnergy(state, SPECIES) + res.potentialEnergy;
      minE = Math.min(minE, energy);
      maxE = Math.max(maxE, energy);
    }

    const drift = (maxE - minE) / Math.abs(energy0);
    expect(drift).toBeLessThan(0.01); // < 1 % peak-to-peak
  });

  it("conserves total linear momentum (~0 after COM removal)", () => {
    const { state, box } = makeSystem(2);
    force.compute(state, box, SPECIES);
    const dt = 0.002;
    for (let step = 0; step < 500; step++) {
      velocityVerletStep(state, box, SPECIES, force, dt);
    }
    const [px, py, pz] = totalMomentum(state, SPECIES);
    const magnitude = Math.hypot(px, py, pz);
    expect(magnitude).toBeLessThan(1e-9);
  });

  it("is bit-for-bit deterministic for identical seeds", () => {
    const a = makeSystem(99);
    const b = makeSystem(99);
    const force2 = new WcaForce();
    force.compute(a.state, a.box, SPECIES);
    force2.compute(b.state, b.box, SPECIES);
    const dt = 0.003;
    for (let step = 0; step < 300; step++) {
      velocityVerletStep(a.state, a.box, SPECIES, force, dt);
      velocityVerletStep(b.state, b.box, SPECIES, force2, dt);
    }
    expect(Array.from(a.state.positions)).toEqual(Array.from(b.state.positions));
    expect(Array.from(a.state.velocities)).toEqual(Array.from(b.state.velocities));
  });
});
