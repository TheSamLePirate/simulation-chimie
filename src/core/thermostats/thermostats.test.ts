import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { LennardJonesForce } from "../forces/lennardJones";
import { placeOnLattice, setMaxwellBoltzmannVelocities } from "../init";
import { velocityVerletStep } from "../integrators/velocityVerlet";
import { kineticEnergy, temperature } from "../observables";
import { Rng } from "../rng";
import { ARGON } from "../species";
import { createState } from "../state";
import { BOLTZMANN_KJ_PER_MOL_K } from "../units";
import { berendsenLambda, csvrLambda } from "./index";

describe("berendsenLambda", () => {
  it("is 1 exactly at the target temperature", () => {
    expect(berendsenLambda(100, 100, 0.01, 0.5)).toBeCloseTo(1, 9);
  });
  it("heats below target (λ > 1) and cools above (λ < 1)", () => {
    expect(berendsenLambda(50, 100, 0.01, 0.5)).toBeGreaterThan(1);
    expect(berendsenLambda(200, 100, 0.01, 0.5)).toBeLessThan(1);
  });
});

const SPECIES = [ARGON];

function makeSystem(seed: number, temp: number) {
  const box = createBox(3, "periodic");
  const state = createState(216);
  const rng = new Rng(seed);
  placeOnLattice(state, box, { jitter: 0.05, rng });
  setMaxwellBoltzmannVelocities(state, SPECIES, temp, rng);
  return { state, box };
}

describe("NVT thermostats drive temperature to target", () => {
  const force = new LennardJonesForce();
  const dt = 0.004;
  const dof = 3 * 216 - 3;

  it("Berendsen cools an LJ system toward the target", () => {
    const { state, box } = makeSystem(1, 300);
    force.compute(state, box, SPECIES);
    const target = 120;
    for (let s = 0; s < 4000; s++) {
      velocityVerletStep(state, box, SPECIES, force, dt);
      const t = (2 * kineticEnergy(state, SPECIES)) / (dof * BOLTZMANN_KJ_PER_MOL_K);
      const lambda = berendsenLambda(t, target, dt, 0.2);
      const v = state.velocities;
      for (let k = 0; k < v.length; k++) v[k] *= lambda;
    }
    expect(temperature(state, SPECIES, true)).toBeGreaterThan(80);
    expect(temperature(state, SPECIES, true)).toBeLessThan(170);
  }, 60_000);

  it("CSVR maintains temperature near the target on average", () => {
    const { state, box } = makeSystem(2, 150);
    force.compute(state, box, SPECIES);
    const target = 150;
    const targetKE = 0.5 * dof * BOLTZMANN_KJ_PER_MOL_K * target;
    const rng = new Rng(99);
    let sumT = 0;
    let samples = 0;
    for (let s = 0; s < 4000; s++) {
      velocityVerletStep(state, box, SPECIES, force, dt);
      const ke = kineticEnergy(state, SPECIES);
      const lambda = csvrLambda(ke, targetKE, dof, dt, 0.2, rng);
      const v = state.velocities;
      for (let k = 0; k < v.length; k++) v[k] *= lambda;
      if (s > 2000) {
        sumT += temperature(state, SPECIES, true);
        samples += 1;
      }
    }
    expect(sumT / samples).toBeGreaterThan(120);
    expect(sumT / samples).toBeLessThan(180);
  }, 60_000);
});
