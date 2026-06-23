import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { createState } from "../state";
import type { Species } from "../types";
import { IonicForce } from "./ionic";

/** Point charges with no LJ (epsilon = 0) to isolate the Coulomb term. */
const PLUS: Species = {
  name: "+",
  mass: 1,
  sigma: 0.3,
  epsilon: 0,
  charge: 1,
  color: 0,
  radius: 0.1,
};
const MINUS: Species = {
  name: "-",
  mass: 1,
  sigma: 0.3,
  epsilon: 0,
  charge: -1,
  color: 0,
  radius: 0.1,
};
const NEUTRAL: Species = {
  name: "0",
  mass: 1,
  sigma: 0.3,
  epsilon: 0,
  charge: 0,
  color: 0,
  radius: 0.1,
};

const RC = 1.0; // default Coulomb cutoff

/** Two particles on the x-axis separated by `r`, with the given species. */
function pair(r: number, a: Species, b: Species) {
  const state = createState(2, new Uint8Array([0, 1]));
  state.positions[0] = r / 2;
  state.positions[3] = -r / 2;
  return { state, species: [a, b] };
}

describe("IonicForce — Coulomb (Wolf DSF)", () => {
  const force = new IonicForce();
  const box = createBox(100, "reflective"); // large ⇒ no minimum-image, rc clamps to 1.0

  it("opposite charges attract, like charges repel", () => {
    const opposite = pair(0.5, PLUS, MINUS);
    force.compute(opposite.state, box, opposite.species);
    expect(opposite.state.forces[0]).toBeLessThan(0); // + pulled toward −

    const like = pair(0.5, PLUS, PLUS);
    force.compute(like.state, box, like.species);
    expect(like.state.forces[0]).toBeGreaterThan(0); // pushed apart
  });

  it("force matches the numerical derivative of the DSF potential", () => {
    const r = 0.4;
    const h = 1e-6;
    const potentialAt = (sep: number) => {
      const p = pair(sep, PLUS, MINUS);
      return force.compute(p.state, box, p.species).potentialEnergy;
    };
    const numeric = -(potentialAt(r + h) - potentialAt(r - h)) / (2 * h);
    const p = pair(r, PLUS, MINUS);
    force.compute(p.state, box, p.species);
    expect(Math.abs(p.state.forces[0] - numeric) / Math.abs(numeric)).toBeLessThan(1e-3);
  });

  it("force and energy vanish at the Coulomb cutoff", () => {
    const p = pair(RC - 1e-3, PLUS, MINUS);
    const res = force.compute(p.state, box, p.species);
    expect(Math.abs(p.state.forces[0])).toBeLessThan(5);
    expect(Math.abs(res.potentialEnergy)).toBeLessThan(0.5);
    const beyond = pair(RC + 0.1, PLUS, MINUS);
    const res2 = force.compute(beyond.state, box, beyond.species);
    expect(res2.potentialEnergy).toBe(0);
  });

  it("no Coulomb when a partner is neutral", () => {
    const p = pair(0.4, PLUS, NEUTRAL);
    const res = force.compute(p.state, box, p.species);
    expect(res.potentialEnergy).toBe(0);
    expect(p.state.forces[0]).toBe(0);
  });
});
