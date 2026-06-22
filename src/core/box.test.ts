import { describe, expect, it } from "vitest";
import { createBox, minimumImage, volume, wrapCoordinate } from "./box";

describe("box geometry", () => {
  it("computes the cell volume", () => {
    expect(volume(createBox(2))).toBeCloseTo(8, 12);
  });

  it("minimum image maps displacements into [-L/2, L/2)", () => {
    const L = 10;
    expect(minimumImage(1, L)).toBeCloseTo(1, 12);
    expect(minimumImage(6, L)).toBeCloseTo(-4, 12); // 6 - 10
    expect(minimumImage(-6, L)).toBeCloseTo(4, 12);
    expect(minimumImage(14, L)).toBeCloseTo(4, 12); // 14 - 10
  });

  it("wraps coordinates back into the centred cell", () => {
    const L = 10;
    expect(wrapCoordinate(0, L)).toBeCloseTo(0, 12);
    expect(wrapCoordinate(6, L)).toBeCloseTo(-4, 12);
    expect(wrapCoordinate(-7, L)).toBeCloseTo(3, 12);
    const w = wrapCoordinate(123.4, L);
    expect(w).toBeGreaterThanOrEqual(-L / 2);
    expect(w).toBeLessThan(L / 2);
  });
});
