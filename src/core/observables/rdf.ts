import type { Box, SimState } from "../types";

export interface RadialDistribution {
  /** Bin-centre radii, nm. */
  readonly r: number[];
  /** g(r) at each bin (→ 1 for an ideal gas, peaks for structured liquids/solids). */
  readonly g: number[];
}

/**
 * Radial distribution function g(r): the ratio of the observed pair density at
 * separation r to that of an ideal gas of the same density. Computed by histogramming
 * minimum-image pair distances and normalising by the exact spherical-shell volume.
 *
 * O(N²); intended for periodic analysis snapshots rather than every frame.
 */
export function radialDistribution(
  state: SimState,
  box: Box,
  options: { bins?: number; rMax?: number } = {},
): RadialDistribution {
  const { count, positions } = state;
  const [lx, ly, lz] = box.lengths;
  const periodic = box.boundary === "periodic";

  const bins = options.bins ?? 100;
  const rMax = options.rMax ?? 0.5 * Math.min(lx, ly, lz);
  const dr = rMax / bins;
  const hist = new Float64Array(bins);

  for (let i = 0; i < count; i++) {
    const ix = positions[3 * i];
    const iy = positions[3 * i + 1];
    const iz = positions[3 * i + 2];
    for (let j = i + 1; j < count; j++) {
      let dx = ix - positions[3 * j];
      let dy = iy - positions[3 * j + 1];
      let dz = iz - positions[3 * j + 2];
      if (periodic) {
        dx -= lx * Math.round(dx / lx);
        dy -= ly * Math.round(dy / ly);
        dz -= lz * Math.round(dz / lz);
      }
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r < rMax) hist[Math.floor(r / dr)] += 1;
    }
  }

  const volume = lx * ly * lz;
  const totalPairs = (count * (count - 1)) / 2;
  const r: number[] = [];
  const g: number[] = [];
  for (let b = 0; b < bins; b++) {
    const rInner = b * dr;
    const rOuter = rInner + dr;
    const shellVolume = (4 / 3) * Math.PI * (rOuter ** 3 - rInner ** 3);
    const idealPairs = totalPairs * (shellVolume / volume);
    r.push(0.5 * (rInner + rOuter));
    g.push(idealPairs > 0 ? hist[b] / idealPairs : 0);
  }
  return { r, g };
}
