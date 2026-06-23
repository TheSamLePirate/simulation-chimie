import { describe, expect, it } from "vitest";
import { createBox } from "../box";
import { Rng } from "../rng";
import { createState } from "../state";
import { radialDistribution } from "./rdf";

describe("radialDistribution", () => {
  it("gives g(r) ≈ 1 for a uniform random (ideal) distribution", () => {
    const length = 10;
    const box = createBox(length, "periodic");
    const state = createState(3000);
    const rng = new Rng(42);
    for (let i = 0; i < state.count; i++) {
      state.positions[3 * i] = rng.range(-length / 2, length / 2);
      state.positions[3 * i + 1] = rng.range(-length / 2, length / 2);
      state.positions[3 * i + 2] = rng.range(-length / 2, length / 2);
    }

    const { r, g } = radialDistribution(state, box, { bins: 50, rMax: 4 });
    let sum = 0;
    let n = 0;
    for (let b = 0; b < r.length; b++) {
      if (r[b] > 1 && r[b] < 4) {
        sum += g[b];
        n += 1;
      }
    }
    expect(Math.abs(sum / n - 1)).toBeLessThan(0.05);
  });

  it("produces a structured peak for a clustered configuration", () => {
    // Two tight clusters ⇒ excess pairs at short range ⇒ g(r) > 1 there.
    const box = createBox(20, "periodic");
    const state = createState(200);
    const rng = new Rng(7);
    for (let i = 0; i < state.count; i++) {
      const cx = i < 100 ? -5 : 5;
      state.positions[3 * i] = cx + rng.range(-0.5, 0.5);
      state.positions[3 * i + 1] = rng.range(-0.5, 0.5);
      state.positions[3 * i + 2] = rng.range(-0.5, 0.5);
    }
    const { r, g } = radialDistribution(state, box, { bins: 80, rMax: 9 });
    const shortRange = g.filter((_, b) => r[b] < 1.2);
    expect(Math.max(...shortRange)).toBeGreaterThan(1.5);
  });
});
