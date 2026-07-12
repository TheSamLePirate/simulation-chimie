function assertPowerOfTwo(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1 || (value & (value - 1)) !== 0) {
    throw new RangeError(`${name} must be a positive power of two`);
  }
}

/** In-place radix-2 complex FFT. Complex values are interleaved [re₀,im₀,re₁,im₁,…]. */
export function fft1d(data: Float64Array, inverse = false): void {
  if (data.length % 2 !== 0) throw new RangeError("complex FFT data length must be even");
  const n = data.length / 2;
  assertPowerOfTwo(n, "FFT length");

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i >= j) continue;
    const re = data[2 * i];
    const im = data[2 * i + 1];
    data[2 * i] = data[2 * j];
    data[2 * i + 1] = data[2 * j + 1];
    data[2 * j] = re;
    data[2 * j + 1] = im;
  }

  const sign = inverse ? 1 : -1;
  for (let length = 2; length <= n; length *= 2) {
    const angle = (sign * 2 * Math.PI) / length;
    const rootRe = Math.cos(angle);
    const rootIm = Math.sin(angle);
    const half = length / 2;
    for (let start = 0; start < n; start += length) {
      let wRe = 1;
      let wIm = 0;
      for (let offset = 0; offset < half; offset++) {
        const even = start + offset;
        const odd = even + half;
        const oddRe = data[2 * odd];
        const oddIm = data[2 * odd + 1];
        const tRe = wRe * oddRe - wIm * oddIm;
        const tIm = wRe * oddIm + wIm * oddRe;
        const evenRe = data[2 * even];
        const evenIm = data[2 * even + 1];
        data[2 * even] = evenRe + tRe;
        data[2 * even + 1] = evenIm + tIm;
        data[2 * odd] = evenRe - tRe;
        data[2 * odd + 1] = evenIm - tIm;
        const nextRe = wRe * rootRe - wIm * rootIm;
        wIm = wRe * rootIm + wIm * rootRe;
        wRe = nextRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < data.length; i++) data[i] /= n;
  }
}

/**
 * In-place separable 3D FFT on an x-fastest complex grid.
 * Inverse transform includes the full 1/(nx·ny·nz) normalization.
 */
export function fft3d(
  data: Float64Array,
  nx: number,
  ny: number,
  nz: number,
  inverse = false,
): void {
  assertPowerOfTwo(nx, "nx");
  assertPowerOfTwo(ny, "ny");
  assertPowerOfTwo(nz, "nz");
  if (data.length !== 2 * nx * ny * nz) {
    throw new RangeError("3D FFT data length does not match dimensions");
  }
  const scratch = new Float64Array(2 * Math.max(nx, ny, nz));
  const transformLine = (length: number, indexAt: (offset: number) => number) => {
    const line = scratch.subarray(0, 2 * length);
    for (let offset = 0; offset < length; offset++) {
      const index = indexAt(offset);
      line[2 * offset] = data[2 * index];
      line[2 * offset + 1] = data[2 * index + 1];
    }
    fft1d(line, inverse);
    for (let offset = 0; offset < length; offset++) {
      const index = indexAt(offset);
      data[2 * index] = line[2 * offset];
      data[2 * index + 1] = line[2 * offset + 1];
    }
  };

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) transformLine(nx, (x) => x + nx * (y + ny * z));
  }
  for (let z = 0; z < nz; z++) {
    for (let x = 0; x < nx; x++) transformLine(ny, (y) => x + nx * (y + ny * z));
  }
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) transformLine(nz, (z) => x + nx * (y + ny * z));
  }
}
