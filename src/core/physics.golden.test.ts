import { describe, expect, it } from "vitest";
/**
 * "Golden physics" tests: the engine must reproduce textbook results, not just run.
 * These are the scientific acceptance criteria for the L0/L1 levels.
 */
import { createBox, volume } from "./box";
import { LennardJonesForce } from "./forces/lennardJones";
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
  }, 20_000); // heavy: 40k steps × 500 particles
});

describe("Lennard-Jones (L2) — cohesion & conservation", () => {
  const force = new LennardJonesForce();

  function makeLiquid(seed: number) {
    const box = createBox(2.6, "periodic"); // ~liquid density for argon
    const state = createState(256);
    placeOnLattice(state, box, { jitter: 0.05, rng: new Rng(seed) });
    setMaxwellBoltzmannVelocities(state, SPECIES, 90, new Rng(seed + 1));
    return { state, box };
  }

  it("conserves total energy under NVE", () => {
    const { state, box } = makeLiquid(3);
    let res = force.compute(state, box, SPECIES);
    const e0 = kineticEnergy(state, SPECIES) + res.potentialEnergy;
    let min = e0;
    let max = e0;
    for (let s = 0; s < 1500; s++) {
      res = velocityVerletStep(state, box, SPECIES, force, 0.002);
      const e = kineticEnergy(state, SPECIES) + res.potentialEnergy;
      min = Math.min(min, e);
      max = Math.max(max, e);
    }
    expect((max - min) / Math.abs(e0)).toBeLessThan(0.02);
  }, 20_000);

  it("shows cohesion: negative potential energy at liquid density", () => {
    const { state, box } = makeLiquid(4);
    const res = force.compute(state, box, SPECIES);
    expect(res.potentialEnergy).toBeLessThan(0);
  });
});
