import { erfc } from "../math/erf";
import { forEachNeighborPair } from "../neighbors";
import type { Box, ForceModel, ForceResult, SimState, Species } from "../types";
import { COULOMB_CONSTANT } from "../units";

const LJ_CUTOFF_FACTOR = 2.5;
const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

/** Harmonic bonds (i–j at r0, stiffness k). */
export interface BondList {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly r0: Float64Array;
  readonly k: Float64Array;
}

/** Harmonic angles i–j–k (j = vertex) at theta0, stiffness kt. */
export interface AngleList {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly k: Int32Array;
  readonly theta0: Float64Array;
  readonly kt: Float64Array;
}

/**
 * General multi-molecule force field: non-bonded Lennard-Jones (Lorentz-Berthelot mixing)
 * + Coulomb (Wolf DSF) with intramolecular exclusions, plus per-bond harmonic bonds and
 * per-angle harmonic angles. Used for the atomistic oil/water mixture. Atoms that are held
 * rigid (e.g. SPC water under SHAKE) simply contribute no bonds/angles here.
 *
 * All separations use the minimum image, so per-atom periodic wrapping never tears a
 * molecule apart.
 */
export class MolecularForce implements ForceModel {
  readonly name = "Mélange moléculaire";

  constructor(
    private readonly bonds: BondList,
    private readonly angles: AngleList,
    private readonly alpha = 2.5,
    private readonly coulombCutoff = 0.9,
  ) {}

  compute(state: SimState, box: Box, species: readonly Species[]): ForceResult {
    const { positions, forces, typeIds, moleculeId } = state;
    forces.fill(0);

    const [lx, ly, lz] = box.lengths;
    const periodic = box.boundary === "periodic";
    const min = (d: number, l: number) => (periodic ? d - l * Math.round(d / l) : d);

    const ke = COULOMB_CONSTANT;
    const alpha = this.alpha;
    // Cutoffs must respect the minimum-image limit (≤ L/2), else an atom interacts with a
    // neighbour and its periodic image ⇒ double-counted force ⇒ slow blow-up.
    const minImage = 0.49 * Math.min(lx, ly, lz);
    const rcC = Math.min(this.coulombCutoff, minImage);
    const rcC2 = rcC * rcC;
    const erfcRc = erfc(alpha * rcC);
    const expRc = Math.exp(-alpha * alpha * rcC * rcC);
    const shift = erfcRc / rcC2 + (TWO_OVER_SQRT_PI * alpha * expRc) / rcC;

    let pe = 0;
    let virial = 0;

    let maxSigma = 0;
    for (const s of species) if (s.epsilon > 0) maxSigma = Math.max(maxSigma, s.sigma);
    const gridCutoff = Math.min(minImage, Math.max(rcC, LJ_CUTOFF_FACTOR * maxSigma));

    // --- Non-bonded (LJ Lorentz-Berthelot + Coulomb DSF), intramolecular excluded (cell-list) ---
    forEachNeighborPair(state, box, gridCutoff, (i, j, dx, dy, dz, r2) => {
      if (moleculeId[j] === moleculeId[i]) return;
      const si = species[typeIds[i]];
      const sj = species[typeIds[j]];
      let fOverR = 0;
      let r = -1;

      const epsilon = Math.sqrt(si.epsilon * sj.epsilon);
      if (epsilon > 0) {
        const sigma = 0.5 * (si.sigma + sj.sigma);
        const rcLj = Math.min(LJ_CUTOFF_FACTOR * sigma, minImage);
        if (r2 < rcLj * rcLj) {
          r = Math.sqrt(r2);
          const inv2 = (sigma * sigma) / r2;
          const inv6 = inv2 * inv2 * inv2;
          const inv12 = inv6 * inv6;
          const c2 = (sigma * sigma) / (rcLj * rcLj);
          const c6 = c2 * c2 * c2;
          const c12 = c6 * c6;
          const fAtRc = (24 * epsilon * (2 * c12 - c6)) / rcLj;
          const vAtRc = 4 * epsilon * (c12 - c6);
          fOverR += ((24 * epsilon * (2 * inv12 - inv6)) / r - fAtRc) / r;
          pe += 4 * epsilon * (inv12 - inv6) - vAtRc + (r - rcLj) * fAtRc;
        }
      }

      const qq = si.charge * sj.charge;
      if (qq !== 0 && r2 < rcC2) {
        if (r < 0) r = Math.sqrt(r2);
        const erfcR = erfc(alpha * r);
        const expR = Math.exp(-alpha * alpha * r2);
        const fCoul = ke * qq * (erfcR / r2 + (TWO_OVER_SQRT_PI * alpha * expR) / r - shift);
        fOverR += fCoul / r;
        pe += ke * qq * (erfcR / r - erfcRc / rcC + shift * (r - rcC));
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
    });

    // --- Harmonic bonds ---
    const b = this.bonds;
    for (let n = 0; n < b.i.length; n++) {
      const i = b.i[n];
      const j = b.j[n];
      const dx = min(positions[3 * i] - positions[3 * j], lx);
      const dy = min(positions[3 * i + 1] - positions[3 * j + 1], ly);
      const dz = min(positions[3 * i + 2] - positions[3 * j + 2], lz);
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r < 1e-9) continue;
      const dr = r - b.r0[n];
      pe += 0.5 * b.k[n] * dr * dr;
      const fOverR = (-b.k[n] * dr) / r;
      forces[3 * i] += fOverR * dx;
      forces[3 * i + 1] += fOverR * dy;
      forces[3 * i + 2] += fOverR * dz;
      forces[3 * j] -= fOverR * dx;
      forces[3 * j + 1] -= fOverR * dy;
      forces[3 * j + 2] -= fOverR * dz;
      virial += fOverR * r * r;
    }

    // --- Harmonic angles (j = vertex) ---
    const a = this.angles;
    for (let n = 0; n < a.j.length; n++) {
      const i = a.i[n];
      const j = a.j[n];
      const k = a.k[n];
      const rijx = min(positions[3 * i] - positions[3 * j], lx);
      const rijy = min(positions[3 * i + 1] - positions[3 * j + 1], ly);
      const rijz = min(positions[3 * i + 2] - positions[3 * j + 2], lz);
      const rkjx = min(positions[3 * k] - positions[3 * j], lx);
      const rkjy = min(positions[3 * k + 1] - positions[3 * j + 1], ly);
      const rkjz = min(positions[3 * k + 2] - positions[3 * j + 2], lz);
      const lij = Math.hypot(rijx, rijy, rijz);
      const lkj = Math.hypot(rkjx, rkjy, rkjz);
      if (lij < 1e-9 || lkj < 1e-9) continue;
      let cosT = (rijx * rkjx + rijy * rkjy + rijz * rkjz) / (lij * lkj);
      cosT = Math.max(-1, Math.min(1, cosT));
      const theta = Math.acos(cosT);
      const sinT = Math.max(Math.sin(theta), 1e-8);
      const dVdTheta = a.kt[n] * (theta - a.theta0[n]);
      pe += 0.5 * a.kt[n] * (theta - a.theta0[n]) ** 2;
      const factor = dVdTheta / sinT;

      const fix = factor * (rkjx / (lij * lkj) - (cosT * rijx) / (lij * lij));
      const fiy = factor * (rkjy / (lij * lkj) - (cosT * rijy) / (lij * lij));
      const fiz = factor * (rkjz / (lij * lkj) - (cosT * rijz) / (lij * lij));
      const fkx = factor * (rijx / (lij * lkj) - (cosT * rkjx) / (lkj * lkj));
      const fky = factor * (rijy / (lij * lkj) - (cosT * rkjy) / (lkj * lkj));
      const fkz = factor * (rijz / (lij * lkj) - (cosT * rkjz) / (lkj * lkj));

      forces[3 * i] += fix;
      forces[3 * i + 1] += fiy;
      forces[3 * i + 2] += fiz;
      forces[3 * k] += fkx;
      forces[3 * k + 1] += fky;
      forces[3 * k + 2] += fkz;
      forces[3 * j] -= fix + fkx;
      forces[3 * j + 1] -= fiy + fky;
      forces[3 * j + 2] -= fiz + fkz;
    }

    return { potentialEnergy: pe, virial };
  }
}
