import { redistributeTip4pVirtualForce, TIP4P_2005, tip4pVirtualPositionInBox } from "../tip4p2005";
import type { Box, ForceModel, ForceResult, SimState, Species } from "../types";
import { computeEwald3d, type EwaldOptions, type EwaldResult, ewaldKBounds } from "./ewald";

const DEFAULT_ALPHA = 3.5;
const DEFAULT_RECIPROCAL_TOLERANCE = 1e-7;

export interface Tip4p2005EwaldOptions {
  readonly alpha?: number;
  readonly kMax?: readonly [number, number, number];
  readonly realImages?: readonly [number, number, number];
  readonly slabCorrection?: boolean;
}

/**
 * Periodic TIP4P/2005 CPU oracle: shifted-force O–O LJ plus direct Ewald H/H/M electrostatics.
 * This is correct but intentionally expensive; smooth PME will reproduce it for production.
 */
export class Tip4p2005EwaldForce implements ForceModel {
  readonly name = "TIP4P/2005 + direct Ewald";
  lastEwald: EwaldResult | null = null;

  constructor(private readonly options: Tip4p2005EwaldOptions = {}) {}

  compute(state: SimState, box: Box, _species: readonly Species[]): ForceResult {
    if (box.boundary !== "periodic")
      throw new Error("TIP4P/2005 Ewald requires periodic boundaries");
    if (state.count % 3 !== 0) throw new Error("TIP4P/2005 state must contain O,H,H triples");
    const molecules = state.count / 3;
    const { positions, forces } = state;
    forces.fill(0);

    const chargePositions = new Float64Array(9 * molecules);
    const charges = new Float64Array(3 * molecules);
    for (let m = 0; m < molecules; m++) {
      const o = 3 * m;
      const oxygen = positions.subarray(3 * o, 3 * o + 3);
      const h1 = positions.subarray(3 * (o + 1), 3 * (o + 1) + 3);
      const h2 = positions.subarray(3 * (o + 2), 3 * (o + 2) + 3);
      // Use unwrapped O-relative H coordinates so the virtual site remains inside the molecule.
      const unwrap = (hydrogen: Float64Array, component: number) => {
        let delta = hydrogen[component] - oxygen[component];
        const length = box.lengths[component];
        delta -= length * Math.round(delta / length);
        return oxygen[component] + delta;
      };
      for (let c = 0; c < 3; c++) {
        chargePositions[9 * m + c] = unwrap(h1, c);
        chargePositions[9 * m + 3 + c] = unwrap(h2, c);
      }
      const virtual = tip4pVirtualPositionInBox(oxygen, h1, h2, box);
      chargePositions.set(virtual, 9 * m + 6);
      charges[3 * m] = TIP4P_2005.chargeH;
      charges[3 * m + 1] = TIP4P_2005.chargeH;
      charges[3 * m + 2] = TIP4P_2005.chargeM;
    }

    const alpha = this.options.alpha ?? DEFAULT_ALPHA;
    const kCutoff = 2 * alpha * Math.sqrt(-Math.log(DEFAULT_RECIPROCAL_TOLERANCE));
    const dynamicBounds = ewaldKBounds(box, kCutoff);
    const ewaldOptions: EwaldOptions = {
      alpha,
      kMax: this.options.kMax ?? [dynamicBounds[0], dynamicBounds[1], dynamicBounds[2]],
      realImages: this.options.realImages ?? [1, 1, 1],
      slabCorrection: this.options.slabCorrection ?? false,
    };
    const ewald = computeEwald3d(
      { count: 3 * molecules, positions: chargePositions, charges },
      box,
      ewaldOptions,
    );
    this.lastEwald = ewald;

    // H forces are direct sites; M forces are redistributed with the exact virtual-site Jacobian.
    for (let m = 0; m < molecules; m++) {
      const o = 3 * m;
      for (let h = 0; h < 2; h++) {
        const atom = o + 1 + h;
        const site = 3 * m + h;
        forces[3 * atom] += ewald.forces[3 * site];
        forces[3 * atom + 1] += ewald.forces[3 * site + 1];
        forces[3 * atom + 2] += ewald.forces[3 * site + 2];
      }
      const siteM = 3 * m + 2;
      const distributed = redistributeTip4pVirtualForce(
        ewald.forces.subarray(3 * siteM, 3 * siteM + 3),
      );
      const targets = [distributed.oxygen, distributed.hydrogen1, distributed.hydrogen2];
      for (let site = 0; site < 3; site++) {
        const atom = o + site;
        forces[3 * atom] += targets[site][0];
        forces[3 * atom + 1] += targets[site][1];
        forces[3 * atom + 2] += targets[site][2];
      }
    }

    // Shifted-force O–O Lennard-Jones, capped below the minimum-image limit.
    const [lx, ly, lz] = box.lengths;
    const cutoff = Math.min(2.5 * TIP4P_2005.sigmaO, 0.49 * Math.min(lx, ly, lz));
    const cutoff2 = cutoff * cutoff;
    const sigma2 = TIP4P_2005.sigmaO ** 2;
    const c2 = sigma2 / cutoff2;
    const c6 = c2 * c2 * c2;
    const c12 = c6 * c6;
    const fAtCutoff = (24 * TIP4P_2005.epsilonO * (2 * c12 - c6)) / cutoff;
    const vAtCutoff = 4 * TIP4P_2005.epsilonO * (c12 - c6);
    let ljEnergy = 0;
    let ljVirial = 0;
    for (let i = 0; i < molecules; i++) {
      const oi = 3 * i;
      for (let j = i + 1; j < molecules; j++) {
        const oj = 3 * j;
        let dx = positions[3 * oi] - positions[3 * oj];
        let dy = positions[3 * oi + 1] - positions[3 * oj + 1];
        let dz = positions[3 * oi + 2] - positions[3 * oj + 2];
        dx -= lx * Math.round(dx / lx);
        dy -= ly * Math.round(dy / ly);
        dz -= lz * Math.round(dz / lz);
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= cutoff2 || r2 < 1e-12) continue;
        const r = Math.sqrt(r2);
        const inv2 = sigma2 / r2;
        const inv6 = inv2 * inv2 * inv2;
        const inv12 = inv6 * inv6;
        const fRadial = (24 * TIP4P_2005.epsilonO * (2 * inv12 - inv6)) / r;
        const fOverR = (fRadial - fAtCutoff) / r;
        const fx = fOverR * dx;
        const fy = fOverR * dy;
        const fz = fOverR * dz;
        forces[3 * oi] += fx;
        forces[3 * oi + 1] += fy;
        forces[3 * oi + 2] += fz;
        forces[3 * oj] -= fx;
        forces[3 * oj + 1] -= fy;
        forces[3 * oj + 2] -= fz;
        ljEnergy += 4 * TIP4P_2005.epsilonO * (inv12 - inv6) - vAtCutoff + (r - cutoff) * fAtCutoff;
        ljVirial += fOverR * r2;
      }
    }
    return {
      potentialEnergy: ewald.potentialEnergy + ljEnergy,
      virial: ewald.virial + ljVirial,
    };
  }
}
