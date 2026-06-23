import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { createState } from "../state";
import type { Species } from "../types";
import { LennardJonesForce } from "./lennardJones";

const SP: Species = {
  name: "X",
  mass: 1,
  sigma: 0.34,
  epsilon: 1,
  charge: 0,
  color: 0,
  radius: 0.17,
};
const RC = 2.5 * SP.sigma; // 0.85
const R_MIN = 1.122462048309373 * SP.sigma; // ~0.3815 (potential minimum)

function pairAt(r: number) {
  const state = createState(2);
  state.positions[0] = r / 2;
  state.positions[3] = -r / 2;
  return state;
}

describe("LennardJonesForce", () => {
  const force = new LennardJonesForce();
  const box = createBox(100, "reflective");

  it("vanishes beyond the cutoff", () => {
    const state = pairAt(RC + 0.05);
    const res = force.compute(state, box, [SP]);
    expect(res.potentialEnergy).toBe(0);
    expect(state.forces.every((f) => f === 0)).toBe(true);
  });

  it("is repulsive below the minimum and attractive above it", () => {
    const below = pairAt(0.3);
    force.compute(below, box, [SP]);
    expect(below.forces[0]).toBeGreaterThan(0); // pushed apart

    const above = pairAt(0.5);
    force.compute(above, box, [SP]);
    expect(above.forces[0]).toBeLessThan(0); // pulled together (cohesion)
  });

  it("force and energy go continuously to zero at the cutoff (shifted-force)", () => {
    const nearRc = pairAt(RC - 1e-3);
    const res = force.compute(nearRc, box, [SP]);
    expect(Math.abs(nearRc.forces[0])).toBeLessThan(1e-1);
    expect(Math.abs(res.potentialEnergy)).toBeLessThan(1e-3);
  });

  it("force matches the numerical derivative of the shifted potential", () => {
    const r = 0.45;
    const h = 1e-6;
    const potentialAt = (sep: number) => force.compute(pairAt(sep), box, [SP]).potentialEnergy;
    const numeric = -(potentialAt(r + h) - potentialAt(r - h)) / (2 * h);
    const state = pairAt(r);
    force.compute(state, box, [SP]);
    expect(state.forces[0]).toBeCloseTo(numeric, 4);
  });

  it("has a negative potential well near the minimum", () => {
    const res = force.compute(pairAt(R_MIN), box, [SP]);
    expect(res.potentialEnergy).toBeLessThan(0); // bound state
  });
});
