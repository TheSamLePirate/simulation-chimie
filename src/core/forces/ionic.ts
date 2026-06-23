import { erfc } from "../math/erf";
import type { Box, ForceModel, ForceResult, SimState, Species } from "../types";
import { COULOMB_CONSTANT } from "../units";

const LJ_CUTOFF_FACTOR = 2.5;
const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

/**
 * L3 — Lennard-Jones + electrostatics via the **Wolf damped-shifted-force (DSF)** method:
 * an O(N) (here O(N²)) real-space Coulomb that reproduces Ewald to ~1 % without FFTs, ideal
 * for the browser. Both potential and force vanish continuously at the Coulomb cutoff.
 *
 *   V_DSF(r) = q_i q_j [ erfc(αr)/r − erfc(αr_c)/r_c + S·(r − r_c) ]
 *   F_DSF(r) = q_i q_j [ erfc(αr)/r² + (2α/√π)e^{−α²r²}/r − S ],  S = erfc(αr_c)/r_c² + (2α/√π)e^{−α²r_c²}/r_c
 *
 * Charges come from the species table; LJ uses Lorentz-Berthelot mixing. Enables ionic
 * systems (e.g. NaCl: opposite charges attract and crystallise).
 */
export class IonicForce implements ForceModel {
  readonly name = "Lennard-Jones + Coulomb (Wolf DSF)";

  /** @param alpha Wolf damping (nm⁻¹); @param coulombCutoff Coulomb cutoff (nm). */
  constructor(
    private readonly alpha = 2.5,
    private readonly coulombCutoff = 1.0,
  ) {}

  compute(state: SimState, box: Box, species: readonly Species[]): ForceResult {
    const { count, positions, forces, typeIds } = state;
    forces.fill(0);

    const [lx, ly, lz] = box.lengths;
    const periodic = box.boundary === "periodic";
    const ke = COULOMB_CONSTANT;
    const alpha = this.alpha;

    // Coulomb cutoff must respect the minimum-image limit (≤ L/2).
    const rcC = Math.min(this.coulombCutoff, 0.49 * Math.min(lx, ly, lz));
    const rcC2 = rcC * rcC;
    const erfcRc = erfc(alpha * rcC);
    const expRc = Math.exp(-alpha * alpha * rcC * rcC);
    const shift = erfcRc / rcC2 + (TWO_OVER_SQRT_PI * alpha * expRc) / rcC;

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
        if (r2 < 1e-12) continue;
        const sj = species[typeIds[j]];

        let fOverR = 0;

        // --- Lennard-Jones (shifted-force at 2.5σ) ---
        const sigma = 0.5 * (si.sigma + sj.sigma);
        const epsilon = Math.sqrt(si.epsilon * sj.epsilon);
        const rcLj = LJ_CUTOFF_FACTOR * sigma;
        let r = -1;
        if (epsilon > 0 && r2 < rcLj * rcLj) {
          r = Math.sqrt(r2);
          const inv2 = (sigma * sigma) / r2;
          const inv6 = inv2 * inv2 * inv2;
          const inv12 = inv6 * inv6;
          const c2 = (sigma * sigma) / (rcLj * rcLj);
          const c6 = c2 * c2 * c2;
          const c12 = c6 * c6;
          const fAtRc = (24 * epsilon * (2 * c12 - c6)) / rcLj;
          const vAtRc = 4 * epsilon * (c12 - c6);
          const fRadial = (24 * epsilon * (2 * inv12 - inv6)) / r;
          fOverR += (fRadial - fAtRc) / r;
          potentialEnergy += 4 * epsilon * (inv12 - inv6) - vAtRc + (r - rcLj) * fAtRc;
        }

        // --- Coulomb (Wolf DSF) ---
        const qq = si.charge * sj.charge;
        if (qq !== 0 && r2 < rcC2) {
          if (r < 0) r = Math.sqrt(r2);
          const erfcR = erfc(alpha * r);
          const expR = Math.exp(-alpha * alpha * r2);
          const fCoul = ke * qq * (erfcR / r2 + (TWO_OVER_SQRT_PI * alpha * expR) / r - shift);
          fOverR += fCoul / r;
          potentialEnergy += ke * qq * (erfcR / r - erfcRc / rcC + shift * (r - rcC));
        }

        if (fOverR !== 0) {
          forces[3 * i] += fOverR * dx;
          forces[3 * i + 1] += fOverR * dy;
          forces[3 * i + 2] += fOverR * dz;
          forces[3 * j] -= fOverR * dx;
          forces[3 * j + 1] -= fOverR * dy;
          forces[3 * j + 2] -= fOverR * dz;
          virial += fOverR * r2;
        }
      }
    }

    return { potentialEnergy, virial };
  }
}
