import { describe, expect, it } from "vitest";
import { fft1d, fft3d } from "./fft";

function directDft(data: Float64Array) {
  const n = data.length / 2;
  const out = new Float64Array(data.length);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      const angle = (-2 * Math.PI * j * k) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      out[2 * k] += data[2 * j] * c - data[2 * j + 1] * s;
      out[2 * k + 1] += data[2 * j] * s + data[2 * j + 1] * c;
    }
  }
  return out;
}

describe("radix-2 FFT", () => {
  it("matches the direct complex DFT", () => {
    const data = Float64Array.from([1, 0.5, -2, 1, 0.25, -0.75, 3, 2, 0, 1, 4, -1, -3, 0, 2, 0.5]);
    const expected = directDft(data);
    fft1d(data);
    for (let i = 0; i < data.length; i++) expect(data[i]).toBeCloseTo(expected[i], 11);
  });

  it("round-trips a 1D signal", () => {
    const data = Float64Array.from({ length: 64 }, (_, i) => Math.sin(0.73 * i) + 0.1 * i);
    const original = data.slice();
    fft1d(data);
    fft1d(data, true);
    for (let i = 0; i < data.length; i++) expect(data[i]).toBeCloseTo(original[i], 12);
  });

  it("round-trips a non-cubic 3D grid", () => {
    const nx = 4;
    const ny = 8;
    const nz = 2;
    const data = Float64Array.from(
      { length: 2 * nx * ny * nz },
      (_, i) => Math.cos(0.31 * i) + Math.sin(0.17 * i),
    );
    const original = data.slice();
    fft3d(data, nx, ny, nz);
    fft3d(data, nx, ny, nz, true);
    for (let i = 0; i < data.length; i++) expect(data[i]).toBeCloseTo(original[i], 11);
  });

  it("rejects invalid dimensions and buffers", () => {
    expect(() => fft1d(new Float64Array(12))).toThrow(/power of two/);
    expect(() => fft3d(new Float64Array(16), 2, 2, 3)).toThrow(/power of two/);
    expect(() => fft3d(new Float64Array(14), 2, 2, 2)).toThrow(/does not match/);
  });
});
