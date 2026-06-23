import { erfc } from "../math/erf";
import type { Box, ForceModel, ForceResult, SimState, Species } from "../types";
import { COULOMB_CONSTANT } from "../units";
import {
  WATER_ANGLE_K,
  WATER_ANGLE_THETA0,
  WATER_BOND_K,
  WATER_BOND_R0,
  type WaterTopology,
} from "../water";

const LJ_CUTOFF_FACTOR = 2.5;
const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

/**
 * L4 — atomistic flexible water (SPC/Fw). Combines, in one evaluation:
 *  - non-bonded LJ (O–O) + Coulomb (Wolf DSF) with **intramolecular exclusions**,
 *  - harmonic O–H bonds and H–O–H angles.
 *
 * All inter-particle vectors use the minimum image, so the per-atom periodic wrapping
 * in the integrator never tears a molecule apart. Bonds are stiff ⇒ use a small timestep
 * (~0.5 fs).
 */
export class WaterForce implements ForceModel {
  readonly name = "Eau atomistique (SPC/Fw)";

  constructor(
    private readonly topology: WaterTopology,
    private readonly rigid = false,
    private readonly alpha = 2.5,
    private readonly coulombCutoff = 0.9,
  ) {}

  compute(state: SimState, box: Box, species: readonly Species[]): ForceResult {
    const { count, positions, forces, typeIds, moleculeId } = state;
    forces.fill(0);

    const [lx, ly, lz] = box.lengths;
    const periodic = box.boundary === "periodic";
    const min = (d: number, l: number) => (periodic ? d - l * Math.round(d / l) : d);

    const ke = COULOMB_CONSTANT;
    const alpha = this.alpha;
    const rcC = Math.min(this.coulombCutoff, 0.49 * Math.min(lx, ly, lz));
    const rcC2 = rcC * rcC;
    const erfcRc = erfc(alpha * rcC);
    const expRc = Math.exp(-alpha * alpha * rcC * rcC);
    const shift = erfcRc / rcC2 + (TWO_OVER_SQRT_PI * alpha * expRc) / rcC;

    let pe = 0;
    let virial = 0;

    // --- Non-bonded (LJ O–O + Coulomb DSF), excluding intramolecular pairs ---
    for (let i = 0; i < count; i++) {
      const ix = positions[3 * i];
      const iy = positions[3 * i + 1];
      const iz = positions[3 * i + 2];
      const si = species[typeIds[i]];
      const mi = moleculeId[i];

      for (let j = i + 1; j < count; j++) {
        if (moleculeId[j] === mi) continue; // intramolecular exclusion
        const dx = min(ix - positions[3 * j], lx);
        const dy = min(iy - positions[3 * j + 1], ly);
        const dz = min(iz - positions[3 * j + 2], lz);
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < 1e-12) continue;
        const sj = species[typeIds[j]];

        let fOverR = 0;
        let r = -1;

        const epsilon = Math.sqrt(si.epsilon * sj.epsilon);
        if (epsilon > 0) {
          const sigma = 0.5 * (si.sigma + sj.sigma);
          const rcLj = LJ_CUTOFF_FACTOR * sigma;
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
      }
    }

    // Rigid water: geometry is held by SHAKE/RATTLE constraints, not bonded forces.
    if (this.rigid) return { potentialEnergy: pe, virial };

    // --- Harmonic O–H bonds ---
    const { bondI, bondJ, angleI, angleJ, angleK } = this.topology;
    for (let b = 0; b < bondI.length; b++) {
      const i = bondI[b];
      const j = bondJ[b];
      const dx = min(positions[3 * i] - positions[3 * j], lx);
      const dy = min(positions[3 * i + 1] - positions[3 * j + 1], ly);
      const dz = min(positions[3 * i + 2] - positions[3 * j + 2], lz);
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r < 1e-9) continue;
      const dr = r - WATER_BOND_R0;
      pe += 0.5 * WATER_BOND_K * dr * dr;
      const fOverR = (-WATER_BOND_K * dr) / r;
      forces[3 * i] += fOverR * dx;
      forces[3 * i + 1] += fOverR * dy;
      forces[3 * i + 2] += fOverR * dz;
      forces[3 * j] -= fOverR * dx;
      forces[3 * j + 1] -= fOverR * dy;
      forces[3 * j + 2] -= fOverR * dz;
      virial += fOverR * r * r;
    }

    // --- Harmonic H–O–H angles (j = central O) ---
    for (let a = 0; a < angleJ.length; a++) {
      const i = angleI[a];
      const j = angleJ[a];
      const k = angleK[a];
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
      const dVdTheta = WATER_ANGLE_K * (theta - WATER_ANGLE_THETA0);
      pe += 0.5 * WATER_ANGLE_K * (theta - WATER_ANGLE_THETA0) ** 2;
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
