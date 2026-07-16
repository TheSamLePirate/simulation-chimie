import type { Box, ForceModel, ForceResult, SimState, Species } from "../types";

/** 2^(1/6): the LJ minimum, where the WCA potential is truncated. */
/** WCA truncation radius in units of σ (the LJ minimum). Exported for config validation. */
export const WCA_CUTOFF_FACTOR = 1.122462048309373;
const TWO_POW_1_6 = WCA_CUTOFF_FACTOR;

/**
 * L1 — Weeks-Chandler-Andersen soft spheres: the purely repulsive part of the
 * Lennard-Jones potential, shifted up by ε and truncated at r_c = 2^(1/6)·σ so both
 * energy and force vanish smoothly at the cutoff.
 *
 *   V_WCA(r) = 4ε[(σ/r)¹² − (σ/r)⁶] + ε   for r < r_c, else 0
 *
 * Cross-interactions use Lorentz-Berthelot mixing. This is an O(N²) reference
 * implementation; the GPU engine (P2) replaces it with cell-list O(N) search.
 */
export class WcaForce implements ForceModel {
  readonly name = "WCA (sphères molles)";

  compute(state: SimState, box: Box, species: readonly Species[]): ForceResult {
    const { count, positions, forces, typeIds } = state;
    forces.fill(0);

    const [lx, ly, lz] = box.lengths;
    const periodic = box.boundary === "periodic";

    let potentialEnergy = 0;
    let virial = 0;

    for (let i = 0; i < count; i++) {
      const ix = positions[3 * i];
      const iy = positions[3 * i + 1];
      const iz = positions[3 * i + 2];
      const si = species[typeIds[i]];

      for (let j = i + 1; j < count; j++) {
        let dx = ix - positions[3 * j];
        let dy = iy - positions[3 * j + 1];
        let dz = iz - positions[3 * j + 2];

        if (periodic) {
          dx -= lx * Math.round(dx / lx);
          dy -= ly * Math.round(dy / ly);
          dz -= lz * Math.round(dz / lz);
        }

        const r2 = dx * dx + dy * dy + dz * dz;

        // Lorentz-Berthelot mixing for the (i, j) pair.
        const sj = species[typeIds[j]];
        const sigma = 0.5 * (si.sigma + sj.sigma);
        const epsilon = Math.sqrt(si.epsilon * sj.epsilon);
        const rc = TWO_POW_1_6 * sigma;

        if (r2 >= rc * rc || r2 < 1e-12) continue;

        const inv2 = (sigma * sigma) / r2;
        const inv6 = inv2 * inv2 * inv2;
        const inv12 = inv6 * inv6;

        potentialEnergy += 4 * epsilon * (inv12 - inv6) + epsilon;

        // F_i = (24ε/r²)(2·inv12 − inv6) · r_vec, with r_vec = r_i − r_j.
        const fOverR = (24 * epsilon * (2 * inv12 - inv6)) / r2;
        forces[3 * i] += fOverR * dx;
        forces[3 * i + 1] += fOverR * dy;
        forces[3 * i + 2] += fOverR * dz;
        forces[3 * j] -= fOverR * dx;
        forces[3 * j + 1] -= fOverR * dy;
        forces[3 * j + 2] -= fOverR * dz;

        // r_ij · F_ij = fOverR · r².
        virial += fOverR * r2;
      }
    }

    return { potentialEnergy, virial };
  }
}
