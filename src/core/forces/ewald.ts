import { erfc } from "../math/erf";
import type { Box, Vec3 } from "../types";
import { COULOMB_CONSTANT } from "../units";

const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

export interface EwaldOptions {
  /** Gaussian splitting parameter, nm⁻¹. */
  readonly alpha: number;
  /** Reciprocal integer bounds along x/y/z; the zero vector is excluded. */
  readonly kMax: readonly [number, number, number];
  /** Real-space lattice-image bounds along x/y/z. */
  readonly realImages: readonly [number, number, number];
  /** Yeh–Berkowitz correction for a slab normal to z. */
  readonly slabCorrection?: boolean;
}

export interface EwaldResult {
  readonly potentialEnergy: number;
  readonly forces: Float64Array;
  /** Scalar configurational virial −∂U/∂ln(scale), kJ·mol⁻¹. */
  readonly virial: number;
  readonly realEnergy: number;
  readonly reciprocalEnergy: number;
  readonly selfEnergy: number;
  readonly slabEnergy: number;
}

export interface ChargeSites {
  readonly count: number;
  /** xyz-interleaved positions, nm. */
  readonly positions: ArrayLike<number>;
  /** Charges, e. */
  readonly charges: ArrayLike<number>;
}

function validateVector(name: string, value: readonly number[], integer: boolean): void {
  if (value.length !== 3) throw new RangeError(`${name} must have three components`);
  for (const component of value) {
    if (component < 0 || (integer && !Number.isInteger(component))) {
      throw new RangeError(`${name} components must be non-negative integers`);
    }
  }
}

/**
 * Direct 3D Ewald oracle for a neutral collection of point charges. It evaluates the real lattice
 * sum and the complete ±k reciprocal box explicitly, so it is deliberately a small-system
 * correctness reference rather than a production algorithm.
 */
export function computeEwald3d(sites: ChargeSites, box: Box, options: EwaldOptions): EwaldResult {
  if (sites.count < 1) throw new RangeError("Ewald requires at least one charge site");
  if (sites.positions.length < 3 * sites.count || sites.charges.length < sites.count) {
    throw new RangeError("charge-site buffers are shorter than count");
  }
  if (!(options.alpha > 0)) throw new RangeError("alpha must be positive");
  validateVector("kMax", options.kMax, true);
  validateVector("realImages", options.realImages, true);

  const [lx, ly, lz] = box.lengths;
  const volume = lx * ly * lz;
  if (!(volume > 0)) throw new RangeError("box volume must be positive");

  let totalCharge = 0;
  for (let i = 0; i < sites.count; i++) totalCharge += sites.charges[i];
  if (Math.abs(totalCharge) > 1e-10) {
    throw new Error("direct Ewald oracle requires a neutral charge set");
  }

  const forces = new Float64Array(3 * sites.count);
  const alpha = options.alpha;
  const alpha2 = alpha * alpha;
  const [imx, imy, imz] = options.realImages;
  let realEnergy = 0;
  let realVirial = 0;

  // Ordered i,j,image sum. Energy carries 1/2; force on i is accumulated without 1/2.
  for (let i = 0; i < sites.count; i++) {
    const qi = sites.charges[i];
    const ix = sites.positions[3 * i];
    const iy = sites.positions[3 * i + 1];
    const iz = sites.positions[3 * i + 2];
    for (let j = 0; j < sites.count; j++) {
      const qq = qi * sites.charges[j];
      if (qq === 0) continue;
      for (let nx = -imx; nx <= imx; nx++) {
        for (let ny = -imy; ny <= imy; ny++) {
          for (let nz = -imz; nz <= imz; nz++) {
            if (i === j && nx === 0 && ny === 0 && nz === 0) continue;
            const dx = ix - sites.positions[3 * j] - nx * lx;
            const dy = iy - sites.positions[3 * j + 1] - ny * ly;
            const dz = iz - sites.positions[3 * j + 2] - nz * lz;
            const r2 = dx * dx + dy * dy + dz * dz;
            const r = Math.sqrt(r2);
            const erfcR = erfc(alpha * r);
            const expR = Math.exp(-alpha2 * r2);
            realEnergy += 0.5 * COULOMB_CONSTANT * qq * (erfcR / r);
            const fOverR =
              COULOMB_CONSTANT * qq * (erfcR / (r2 * r) + (TWO_OVER_SQRT_PI * alpha * expR) / r2);
            forces[3 * i] += fOverR * dx;
            forces[3 * i + 1] += fOverR * dy;
            forces[3 * i + 2] += fOverR * dz;
            realVirial += 0.5 * fOverR * r2;
          }
        }
      }
    }
  }

  const [kmx, kmy, kmz] = options.kMax;
  let reciprocalEnergy = 0;
  let reciprocalVirial = 0;
  for (let nx = -kmx; nx <= kmx; nx++) {
    const kx = (2 * Math.PI * nx) / lx;
    for (let ny = -kmy; ny <= kmy; ny++) {
      const ky = (2 * Math.PI * ny) / ly;
      for (let nz = -kmz; nz <= kmz; nz++) {
        if (nx === 0 && ny === 0 && nz === 0) continue;
        const kz = (2 * Math.PI * nz) / lz;
        const k2 = kx * kx + ky * ky + kz * kz;
        const weight = Math.exp(-k2 / (4 * alpha2)) / k2;
        let structureReal = 0;
        let structureImag = 0;
        for (let i = 0; i < sites.count; i++) {
          const phase =
            kx * sites.positions[3 * i] +
            ky * sites.positions[3 * i + 1] +
            kz * sites.positions[3 * i + 2];
          const q = sites.charges[i];
          structureReal += q * Math.cos(phase);
          structureImag += q * Math.sin(phase);
        }
        const energyTerm =
          (COULOMB_CONSTANT *
            2 *
            Math.PI *
            weight *
            (structureReal * structureReal + structureImag * structureImag)) /
          volume;
        reciprocalEnergy += energyTerm;
        reciprocalVirial += energyTerm * (1 - k2 / (2 * alpha2));

        const forceScale = (COULOMB_CONSTANT * 4 * Math.PI * weight) / volume;
        for (let i = 0; i < sites.count; i++) {
          const phase =
            kx * sites.positions[3 * i] +
            ky * sites.positions[3 * i + 1] +
            kz * sites.positions[3 * i + 2];
          // −Im[S(k)e^(−ik·rᵢ)] = C sinφᵢ − S cosφᵢ.
          const projection = structureReal * Math.sin(phase) - structureImag * Math.cos(phase);
          const scale = forceScale * sites.charges[i] * projection;
          forces[3 * i] += scale * kx;
          forces[3 * i + 1] += scale * ky;
          forces[3 * i + 2] += scale * kz;
        }
      }
    }
  }

  let chargeSquareSum = 0;
  for (let i = 0; i < sites.count; i++) chargeSquareSum += sites.charges[i] ** 2;
  const selfEnergy = (-COULOMB_CONSTANT * alpha * chargeSquareSum) / Math.sqrt(Math.PI);

  let slabEnergy = 0;
  if (options.slabCorrection) {
    let dipoleZ = 0;
    for (let i = 0; i < sites.count; i++) dipoleZ += sites.charges[i] * sites.positions[3 * i + 2];
    slabEnergy = (COULOMB_CONSTANT * 2 * Math.PI * dipoleZ * dipoleZ) / volume;
    const slabScale = (-COULOMB_CONSTANT * 4 * Math.PI * dipoleZ) / volume;
    for (let i = 0; i < sites.count; i++) {
      forces[3 * i + 2] += slabScale * sites.charges[i];
    }
  }

  return {
    potentialEnergy: realEnergy + reciprocalEnergy + selfEnergy + slabEnergy,
    forces,
    virial: realVirial + reciprocalVirial + slabEnergy,
    realEnergy,
    reciprocalEnergy,
    selfEnergy,
    slabEnergy,
  };
}

/** Suggested reciprocal bounds for a target maximum |k| represented on each box axis. */
export function ewaldKBounds(box: Box, kCutoffNmInverse: number): Vec3 {
  if (!(kCutoffNmInverse > 0)) throw new RangeError("k cutoff must be positive");
  return box.lengths.map((length) => Math.ceil((kCutoffNmInverse * length) / (2 * Math.PI))) as [
    number,
    number,
    number,
  ];
}
