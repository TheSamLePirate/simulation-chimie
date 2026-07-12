import { describe, expect, it } from "vitest";
import { createBoxXYZ } from "../../core/box";
import { GpuPmeReciprocal } from "./GpuPmeReciprocal";

describe("GPU smooth-PME reciprocal contract", () => {
  const box = createBoxXYZ(2, 2, 3, "periodic");

  it("builds a neutral order-6 mesh and rejects malformed charge sites", () => {
    const pme = new GpuPmeReciprocal({
      count: 2,
      positions: Float32Array.from([-0.3, 0.1, -0.5, 0.4, -0.2, 0.7]),
      charges: Float32Array.from([1, -1]),
      box,
      alpha: 3.5,
      grid: [8, 8, 16],
    });
    expect(pme.count).toBe(2);
    expect([pme.fft.nx, pme.fft.ny, pme.fft.nz]).toEqual([8, 8, 16]);
    expect(
      () =>
        new GpuPmeReciprocal({
          count: 2,
          positions: new Float32Array(6),
          charges: Float32Array.from([1, 0]),
          box,
          alpha: 3.5,
          grid: [8, 8, 16],
        }),
    ).toThrow(/neutral/);
    expect(
      () =>
        new GpuPmeReciprocal({
          count: 2,
          positions: new Float32Array(6),
          charges: Float32Array.from([1, -1]),
          box,
          alpha: 3.5,
          grid: [8, 8, 16],
          realCutoff: 1.1,
        }),
    ).toThrow(/minimum-image/);
  });
});
