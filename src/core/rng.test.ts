import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

describe("Rng", () => {
  it("is deterministic for a given seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 16 }, () => a.nextUint32());
    const seqB = Array.from({ length: 16 }, () => b.nextUint32());
    expect(seqA).toEqual(seqB);
  });

  it("produces different streams for different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.nextUint32()).not.toBe(b.nextUint32());
  });

  it("returns floats in [0, 1)", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const x = rng.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("Gaussian sampler approximates the target mean and std", () => {
    const rng = new Rng(123);
    const n = 50_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = rng.gaussian(2, 3);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(mean).toBeCloseTo(2, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(3, 1);
  });
});
