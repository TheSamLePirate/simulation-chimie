import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { createState } from "../state";
import type { Species } from "../types";
import { WcaForce } from "./wca";

const SP: Species = {
  name: "X",
  mass: 1,
  sigma: 0.34,
  epsilon: 1,
  charge: 0,
  color: 0,
  radius: 0.17,
};
const RC = 1.122462048309373 * SP.sigma; // 2^(1/6) σ

/** Two particles on the x-axis, separated by `r`, centred on the origin. */
function pairAt(r: number) {
  const state = createState(2);
  state.positions[0] = r / 2;
  state.positions[3] = -r / 2;
  return state;
}

describe("WcaForce", () => {
  const force = new WcaForce();
  const box = createBox(100, "reflective"); // large box ⇒ no minimum-image effects

  it("vanishes beyond the cutoff", () => {
    const state = pairAt(RC + 0.05);
    const res = force.compute(state, box, [SP]);
    expect(res.potentialEnergy).toBe(0);
    expect(res.virial).toBe(0);
    expect(state.forces.every((f) => f === 0)).toBe(true);
  });

  it("is purely repulsive inside the cutoff (equal and opposite, positive virial)", () => {
    const state = pairAt(0.3);
    const res = force.compute(state, box, [SP]);
    // Particle 0 sits at +x, so it is pushed further +x.
    expect(state.forces[0]).toBeGreaterThan(0);
    expect(state.forces[3]).toBeCloseTo(-state.forces[0], 12);
    expect(state.forces[1]).toBeCloseTo(0, 12);
    expect(res.virial).toBeGreaterThan(0);
    expect(res.potentialEnergy).toBeGreaterThan(0);
  });

  it("force matches the numerical derivative of the potential (F = -dV/dr)", () => {
    const r = 0.31;
    const h = 1e-6;
    const potentialAt = (sep: number) => force.compute(pairAt(sep), box, [SP]).potentialEnergy;
    const numericForce = -(potentialAt(r + h) - potentialAt(r - h)) / (2 * h);

    const state = pairAt(r);
    force.compute(state, box, [SP]);
    // Force on particle 0 is along +x with magnitude |dV/dr|.
    expect(state.forces[0]).toBeCloseTo(numericForce, 4);
  });

  it("has its energy minimum (zero) exactly at the cutoff", () => {
    const justInside = force.compute(pairAt(RC - 1e-4), box, [SP]).potentialEnergy;
    expect(justInside).toBeGreaterThanOrEqual(0);
    expect(justInside).toBeLessThan(1e-3); // WCA → 0 at r_c
  });
});
