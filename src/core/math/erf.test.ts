import { describe, expect, it } from "vitest";
import { erfc, erfcAccurate } from "./erf";

describe("complementary error function", () => {
  it.each([
    [0, 1],
    [0.1, 0.8875370839817152],
    [0.5, 0.4795001221869535],
    [1, 0.15729920705028513],
    [2, 0.004677734981047266],
    [3, 0.00002209049699858544],
    [5, 1.5374597944280351e-12],
  ])("matches the reference value at x=%s", (x, expected) => {
    expect(erfcAccurate(x)).toBeCloseTo(expected, 14);
  });

  it("obeys symmetry and has the analytic derivative", () => {
    const h = 1e-6;
    for (const x of [0.2, 1, 1.49, 1.51, 2.7]) {
      expect(erfcAccurate(-x)).toBeCloseTo(2 - erfcAccurate(x), 14);
      const numeric = (erfcAccurate(x + h) - erfcAccurate(x - h)) / (2 * h);
      const analytic = (-2 / Math.sqrt(Math.PI)) * Math.exp(-x * x);
      expect(numeric).toBeCloseTo(analytic, 9);
    }
  });

  it("keeps the real-time approximation within its documented error", () => {
    for (const x of [0, 0.3, 1, 2, 4]) {
      expect(Math.abs(erfc(x) - erfcAccurate(x))).toBeLessThan(1.3e-7);
    }
  });
});
