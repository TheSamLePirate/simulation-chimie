import type { Box, ForceModel, ForceResult, SimState, Species } from "../types";

/** Lennard-Jones cutoff in units of σ. */
const CUTOFF_FACTOR = 2.5;

/**
 * L2 — full Lennard-Jones 12-6 with the **shifted-force** truncation at r_c = 2.5σ:
 * both the potential and the force vanish continuously at the cutoff, which keeps NVE
 * energy drift small.
 *
 *   V(r)    = 4ε[(σ/r)¹² − (σ/r)⁶]
 *   f(r)    = 24ε/r · [2(σ/r)¹² − (σ/r)⁶]                (radial, +=repulsive)
 *   f_sf(r) = f(r) − f(r_c)
 *   V_sf(r) = V(r) − V(r_c) + (r − r_c)·f(r_c)
 *
 * Adds the attractive well missing from WCA (L1), so gas→liquid condensation, surface
 * tension and structured g(r) emerge. Cross-interactions use Lorentz-Berthelot mixing.
 * O(N²) reference implementation.
 */
export class LennardJonesForce implements ForceModel {
  readonly name = "Lennard-Jones (12-6)";

  /** @param crossScale cross-species ε multiplier (< 1 ⇒ immiscibility / demixing). */
  constructor(private readonly crossScale = 1) {}

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

        const sj = species[typeIds[j]];
        const sigma = 0.5 * (si.sigma + sj.sigma);
        const mix = typeIds[i] === typeIds[j] ? 1 : this.crossScale;
        const epsilon = Math.sqrt(si.epsilon * sj.epsilon) * mix;
        const rc = CUTOFF_FACTOR * sigma;
        if (r2 >= rc * rc || r2 < 1e-12) continue;

        const r = Math.sqrt(r2);
        const sigma2 = sigma * sigma;
        const inv2 = sigma2 / r2;
        const inv6 = inv2 * inv2 * inv2;
        const inv12 = inv6 * inv6;

        // Values at the cutoff (for the shifted-force correction).
        const c2 = sigma2 / (rc * rc);
        const c6 = c2 * c2 * c2;
        const c12 = c6 * c6;
        const fAtRc = (24 * epsilon * (2 * c12 - c6)) / rc;
        const vAtRc = 4 * epsilon * (c12 - c6);

        const fRadial = (24 * epsilon * (2 * inv12 - inv6)) / r; // f(r)
        const fOverR = (fRadial - fAtRc) / r; // shifted-force / r
        const v = 4 * epsilon * (inv12 - inv6);

        potentialEnergy += v - vAtRc + (r - rc) * fAtRc;

        forces[3 * i] += fOverR * dx;
        forces[3 * i + 1] += fOverR * dy;
        forces[3 * i + 2] += fOverR * dz;
        forces[3 * j] -= fOverR * dx;
        forces[3 * j + 1] -= fOverR * dy;
        forces[3 * j + 2] -= fOverR * dz;

        virial += fOverR * r2;
      }
    }

    return { potentialEnergy, virial };
  }
}
