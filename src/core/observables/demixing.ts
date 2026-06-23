import type { Box, SimState } from "../types";

/**
 * Demixing order parameter: the average fraction of same-species neighbours within
 * `cutoff`. For a well-mixed binary system it equals Σ f_t² (0.5 for an even 50/50
 * mixture); as the two species segregate it rises toward 1. O(N²); analysis snapshot.
 */
export function demixingOrderParameter(state: SimState, box: Box, cutoff: number): number {
  const { count, positions, typeIds } = state;
  const [lx, ly, lz] = box.lengths;
  const periodic = box.boundary === "periodic";
  const cutoff2 = cutoff * cutoff;

  let fractionSum = 0;
  let counted = 0;

  for (let i = 0; i < count; i++) {
    const ix = positions[3 * i];
    const iy = positions[3 * i + 1];
    const iz = positions[3 * i + 2];
    let same = 0;
    let total = 0;
    for (let j = 0; j < count; j++) {
      if (j === i) continue;
      let dx = ix - positions[3 * j];
      let dy = iy - positions[3 * j + 1];
      let dz = iz - positions[3 * j + 2];
      if (periodic) {
        dx -= lx * Math.round(dx / lx);
        dy -= ly * Math.round(dy / ly);
        dz -= lz * Math.round(dz / lz);
      }
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < cutoff2 && r2 > 1e-12) {
        total += 1;
        if (typeIds[j] === typeIds[i]) same += 1;
      }
    }
    if (total > 0) {
      fractionSum += same / total;
      counted += 1;
    }
  }

  return counted > 0 ? fractionSum / counted : 0;
}
