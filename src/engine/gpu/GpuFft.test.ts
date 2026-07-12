import { describe, expect, it } from "vitest";
import { fftBitReverseIndices, GpuFft1d } from "./GpuFft";

describe("GPU FFT topology", () => {
  it("builds the exact radix-2 bit-reversal permutation", () => {
    expect(Array.from(fftBitReverseIndices(8))).toEqual([0, 4, 2, 6, 1, 5, 3, 7]);
  });

  it("rejects non-power-of-two and malformed buffers before GPU dispatch", () => {
    expect(() => fftBitReverseIndices(6)).toThrow(/power of two/);
    expect(() => new GpuFft1d(new Float32Array(7))).toThrow(/complex pairs/);
  });
});
