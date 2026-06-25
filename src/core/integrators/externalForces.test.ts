import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { NoForce } from "../forces/none";
import { createState } from "../state";
import type { Species } from "../types";
import { velocityVerletStep } from "./velocityVerlet";

const ION: Species = {
  name: "TEST_ION",
  mass: 10,
  sigma: 0.3,
  epsilon: 1,
  charge: 2,
  color: 0xffffff,
  radius: 0.15,
};

/**
 * A uniform electric field exerts F = q·E (charge-dependent, along +x). With no other forces
 * this is constant acceleration a = q·E/m, so the ion's analytic trajectory is exact and we can
 * pin both the velocity and displacement — and confirm a neutral atom is untouched.
 */
describe("electric field (external force q·E)", () => {
  it("accelerates a charged particle by a = q·E/m along +x", () => {
    const box = createBox(100, "periodic"); // large ⇒ no wrapping over the test
    const state = createState(1, new Uint8Array([0]));
    const species = [ION];
    const E = 5;
    const dt = 0.001;
    const steps = 1000;

    for (let s = 0; s < steps; s++) {
      velocityVerletStep(state, box, species, NoForce, dt, 0, E);
    }

    const t = steps * dt;
    const a = (ION.charge * E) / ION.mass; // q·E/m
    // v = a·t (from rest); x = ½·a·t². Velocity-Verlet is exact for constant acceleration.
    expect(state.velocities[0]).toBeCloseTo(a * t, 6);
    expect(state.positions[0]).toBeCloseTo(0.5 * a * t * t, 4);
    // No force on the transverse axes.
    expect(state.velocities[1]).toBeCloseTo(0, 10);
    expect(state.velocities[2]).toBeCloseTo(0, 10);
  });

  it("leaves a neutral atom unaffected", () => {
    const neutral: Species = { ...ION, charge: 0 };
    const box = createBox(100, "periodic");
    const state = createState(1, new Uint8Array([0]));
    for (let s = 0; s < 500; s++) {
      velocityVerletStep(state, box, [neutral], NoForce, 0.002, 0, 9);
    }
    expect(state.velocities[0]).toBeCloseTo(0, 12);
    expect(state.positions[0]).toBeCloseTo(0, 12);
  });

  it("pushes opposite charges in opposite directions (electrophoresis)", () => {
    const cation: Species = { ...ION, charge: 1 };
    const anion: Species = { ...ION, charge: -1 };
    const box = createBox(100, "periodic");
    const state = createState(2, new Uint8Array([0, 1]));
    for (let s = 0; s < 200; s++) {
      velocityVerletStep(state, box, [cation, anion], NoForce, 0.002, 0, 4);
    }
    expect(state.velocities[0]).toBeGreaterThan(0); // + ion drifts +x
    expect(state.velocities[3]).toBeLessThan(0); // − ion drifts −x
    expect(state.velocities[0]).toBeCloseTo(-state.velocities[3], 8); // symmetric
  });
});
