import { redistributeTip4pVirtualForce, TIP4P_2005, tip4pVirtualPosition } from "../tip4p2005";
import type { Box, ForceModel, ForceResult, SimState, Species } from "../types";
import { COULOMB_CONSTANT } from "../units";

/**
 * Isolated-system TIP4P/2005 pair oracle: full O–O LJ plus direct Coulomb between H/H/M sites.
 * It intentionally rejects periodic boundaries: production L11 must use Ewald, never a minimum-image
 * 1/r truncation. This oracle exists for virtual-site gradient tests and Ewald validation.
 */
export class Tip4p2005DirectForce implements ForceModel {
  readonly name = "TIP4P/2005 direct isolated-pair oracle";

  compute(state: SimState, box: Box, _species: readonly Species[]): ForceResult {
    if (box.boundary === "periodic") {
      throw new Error("TIP4P/2005 periodic electrostatics require Ewald");
    }
    if (state.count % 3 !== 0) throw new Error("TIP4P/2005 state must contain O,H,H triples");
    const molecules = state.count / 3;
    const { positions, forces } = state;
    forces.fill(0);
    const mPositions = new Float64Array(3 * molecules);
    const mForces = new Float64Array(3 * molecules);
    for (let m = 0; m < molecules; m++) {
      const o = 3 * m;
      const virtual = tip4pVirtualPosition(
        positions.subarray(3 * o, 3 * o + 3),
        positions.subarray(3 * (o + 1), 3 * (o + 1) + 3),
        positions.subarray(3 * (o + 2), 3 * (o + 2) + 3),
      );
      mPositions.set(virtual, 3 * m);
    }

    let potentialEnergy = 0;
    let virial = 0;
    const sigma2 = TIP4P_2005.sigmaO ** 2;
    const charge = [TIP4P_2005.chargeH, TIP4P_2005.chargeH, TIP4P_2005.chargeM];

    const addForce = (m: number, site: number, fx: number, fy: number, fz: number) => {
      if (site === 2) {
        mForces[3 * m] += fx;
        mForces[3 * m + 1] += fy;
        mForces[3 * m + 2] += fz;
      } else {
        const atom = 3 * m + 1 + site;
        forces[3 * atom] += fx;
        forces[3 * atom + 1] += fy;
        forces[3 * atom + 2] += fz;
      }
    };
    const sitePosition = (m: number, site: number, component: number) =>
      site === 2 ? mPositions[3 * m + component] : positions[3 * (3 * m + 1 + site) + component];

    for (let i = 0; i < molecules; i++) {
      const oi = 3 * i;
      for (let j = i + 1; j < molecules; j++) {
        const oj = 3 * j;
        // Full isolated O–O Lennard-Jones interaction.
        const dx = positions[3 * oi] - positions[3 * oj];
        const dy = positions[3 * oi + 1] - positions[3 * oj + 1];
        const dz = positions[3 * oi + 2] - positions[3 * oj + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 < 1e-12) continue;
        const inv2 = sigma2 / r2;
        const inv6 = inv2 * inv2 * inv2;
        const inv12 = inv6 * inv6;
        potentialEnergy += 4 * TIP4P_2005.epsilonO * (inv12 - inv6);
        const fOverR = (24 * TIP4P_2005.epsilonO * (2 * inv12 - inv6)) / r2;
        const fx = fOverR * dx;
        const fy = fOverR * dy;
        const fz = fOverR * dz;
        forces[3 * oi] += fx;
        forces[3 * oi + 1] += fy;
        forces[3 * oi + 2] += fz;
        forces[3 * oj] -= fx;
        forces[3 * oj + 1] -= fy;
        forces[3 * oj + 2] -= fz;
        virial += fOverR * r2;

        // Direct Coulomb between the two H,H,M charge triplets.
        for (let si = 0; si < 3; si++) {
          for (let sj = 0; sj < 3; sj++) {
            const cdx = sitePosition(i, si, 0) - sitePosition(j, sj, 0);
            const cdy = sitePosition(i, si, 1) - sitePosition(j, sj, 1);
            const cdz = sitePosition(i, si, 2) - sitePosition(j, sj, 2);
            const cr2 = cdx * cdx + cdy * cdy + cdz * cdz;
            const cr = Math.sqrt(cr2);
            const qq = charge[si] * charge[sj];
            potentialEnergy += (COULOMB_CONSTANT * qq) / cr;
            const cfOverR = (COULOMB_CONSTANT * qq) / (cr2 * cr);
            const cfx = cfOverR * cdx;
            const cfy = cfOverR * cdy;
            const cfz = cfOverR * cdz;
            addForce(i, si, cfx, cfy, cfz);
            addForce(j, sj, -cfx, -cfy, -cfz);
            virial += cfOverR * cr2;
          }
        }
      }
    }

    for (let m = 0; m < molecules; m++) {
      const distributed = redistributeTip4pVirtualForce(mForces.subarray(3 * m, 3 * m + 3));
      const o = 3 * m;
      const targets = [distributed.oxygen, distributed.hydrogen1, distributed.hydrogen2];
      for (let site = 0; site < 3; site++) {
        const atom = o + site;
        forces[3 * atom] += targets[site][0];
        forces[3 * atom + 1] += targets[site][1];
        forces[3 * atom + 2] += targets[site][2];
      }
    }
    return { potentialEnergy, virial };
  }
}
