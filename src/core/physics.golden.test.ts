import { describe, expect, it } from "vitest";
/**
 * "Golden physics" tests: the engine must reproduce textbook results, not just run.
 * These are the scientific acceptance criteria for the L0/L1 levels.
 */
import { createBox, volume } from "./box";
import { NoForce } from "./forces/none";
import { placeOnLattice, setMaxwellBoltzmannVelocities } from "./init";
import { velocityVerletStep } from "./integrators/velocityVerlet";
import { kineticEnergy, temperature } from "./observables";
import { Rng } from "./rng";
import { ARGON } from "./species";
import { createState } from "./state";
import { BOLTZMANN_KJ_PER_MOL_K } from "./units";

const SPECIES = [ARGON];

describe("equipartition (ideal gas)", () => {
  it("sets the kinetic temperature exactly to the target", () => {
    const state = createState(512);
    const box = createBox(6, "periodic");
    placeOnLattice(state, box);
    setMaxwellBoltzmannVelocities(state, SPECIES, 150, new Rng(5));
    expect(temperature(state, SPECIES)).toBeCloseTo(150, 6);
  });

  it("holds temperature constant under NVE with no interactions", () => {
    const state = createState(512);
    const box = createBox(6, "periodic");
    placeOnLattice(state, box);
    setMaxwellBoltzmannVelocities(state, SPECIES, 150, new Rng(6));
    NoForce.compute(state, box, SPECIES);

    const ke0 = kineticEnergy(state, SPECIES);
    for (let step = 0; step < 500; step++) {
      velocityVerletStep(state, box, SPECIES, NoForce, 0.01);
    }
    // No forces ⇒ kinetic energy (hence T) is invariant to machine precision.
    expect(kineticEnergy(state, SPECIES)).toBeCloseTo(ke0, 6);
    expect(temperature(state, SPECIES)).toBeCloseTo(150, 6);
  });
});

describe("ideal gas law (measured via wall collisions)", () => {
  it("reproduces P·V = N·k_B·T from reflective-wall momentum transfer", () => {
    const count = 500;
    const targetT = 300;
    const length = 5;
    const box = createBox(length, "reflective");
    const state = createState(count);
    placeOnLattice(state, box);
    setMaxwellBoltzmannVelocities(state, SPECIES, targetT, new Rng(2024));
    NoForce.compute(state, box, SPECIES);

    const dt = 0.01;
    const steps = 40_000;
    let impulse = 0;
    for (let step = 0; step < steps; step++) {
      impulse += velocityVerletStep(state, box, SPECIES, NoForce, dt).wallImpulse;
    }

    // P = Σimpulse / (totalWallArea · elapsedTime); cube ⇒ area = 6·L².
    const elapsed = steps * dt;
    const measuredP = impulse / (6 * length * length * elapsed);
    const idealP = (count * BOLTZMANN_KJ_PER_MOL_K * targetT) / volume(box);

    expect(measuredP / idealP).toBeCloseTo(1, 1); // within ~10 %
  });
});
