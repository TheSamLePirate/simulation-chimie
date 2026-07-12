import type { SimState, Species } from "../types";

/** Symmetric Cartesian tensor. Off-diagonal values use the xy/xz/yz convention. */
export interface SymmetricTensor3 {
  readonly xx: number;
  readonly yy: number;
  readonly zz: number;
  readonly xy: number;
  readonly xz: number;
  readonly yz: number;
}

export const ZERO_TENSOR: SymmetricTensor3 = {
  xx: 0,
  yy: 0,
  zz: 0,
  xy: 0,
  xz: 0,
  yz: 0,
};

/**
 * Kinetic contribution to the pressure tensor, Σᵢ mᵢ vᵢ⊗vᵢ, in kJ·mol⁻¹.
 * In the internal GROMACS units, u·(nm·ps⁻¹)² is directly kJ·mol⁻¹.
 */
export function kineticTensor(state: SimState, species: readonly Species[]): SymmetricTensor3 {
  let xx = 0;
  let yy = 0;
  let zz = 0;
  let xy = 0;
  let xz = 0;
  let yz = 0;
  for (let i = 0; i < state.count; i++) {
    const m = species[state.typeIds[i]].mass;
    const vx = state.velocities[3 * i];
    const vy = state.velocities[3 * i + 1];
    const vz = state.velocities[3 * i + 2];
    xx += m * vx * vx;
    yy += m * vy * vy;
    zz += m * vz * vz;
    xy += m * vx * vy;
    xz += m * vx * vz;
    yz += m * vy * vz;
  }
  return { xx, yy, zz, xy, xz, yz };
}

/** Pressure tensor P = (K + W) / V in kJ·mol⁻¹·nm⁻³. */
export function pressureTensor(
  kinetic: SymmetricTensor3,
  virial: SymmetricTensor3,
  volumeNm3: number,
): SymmetricTensor3 {
  if (volumeNm3 <= 0) return ZERO_TENSOR;
  return {
    xx: (kinetic.xx + virial.xx) / volumeNm3,
    yy: (kinetic.yy + virial.yy) / volumeNm3,
    zz: (kinetic.zz + virial.zz) / volumeNm3,
    xy: (kinetic.xy + virial.xy) / volumeNm3,
    xz: (kinetic.xz + virial.xz) / volumeNm3,
    yz: (kinetic.yz + virial.yz) / volumeNm3,
  };
}

/**
 * Mechanical surface tension of a planar interface normal to z:
 *   γ = Lz / n_interfaces · [Pzz − (Pxx + Pyy)/2]
 * Returns kJ·mol⁻¹·nm⁻².
 */
export function planarSurfaceTension(
  pressure: SymmetricTensor3,
  lengthZNm: number,
  interfaces = 2,
): number {
  if (lengthZNm <= 0 || interfaces <= 0) return 0;
  const tangential = 0.5 * (pressure.xx + pressure.yy);
  return (lengthZNm / interfaces) * (pressure.zz - tangential);
}

/** 1 kJ·mol⁻¹·nm⁻² in mN·m⁻¹. */
export const MN_PER_M_PER_KJ_PER_MOL_NM2 = 1.6605390671738467;

export function surfaceTensionToMilliNewtonPerMeter(value: number): number {
  return value * MN_PER_M_PER_KJ_PER_MOL_NM2;
}

export interface BlockStatistics {
  readonly mean: number;
  /** Standard error of the mean estimated from independent block means. */
  readonly standardError: number;
  readonly blockMeans: readonly number[];
  readonly blocks: number;
  readonly samplesUsed: number;
}

/**
 * Block-average a correlated time series. Incomplete trailing samples are intentionally
 * discarded so every block carries the same statistical weight.
 */
export function blockAverage(samples: ArrayLike<number>, blockSize: number): BlockStatistics {
  if (!Number.isInteger(blockSize) || blockSize < 1) {
    throw new RangeError("blockSize must be a positive integer");
  }
  const blocks = Math.floor(samples.length / blockSize);
  if (blocks === 0) {
    return { mean: 0, standardError: 0, blockMeans: [], blocks: 0, samplesUsed: 0 };
  }

  const blockMeans = new Array<number>(blocks);
  let mean = 0;
  for (let block = 0; block < blocks; block++) {
    let sum = 0;
    const start = block * blockSize;
    for (let i = 0; i < blockSize; i++) sum += samples[start + i];
    const value = sum / blockSize;
    blockMeans[block] = value;
    mean += value;
  }
  mean /= blocks;

  if (blocks === 1) {
    return { mean, standardError: 0, blockMeans, blocks, samplesUsed: blockSize };
  }
  let squared = 0;
  for (const value of blockMeans) squared += (value - mean) ** 2;
  const sampleVariance = squared / (blocks - 1);
  return {
    mean,
    standardError: Math.sqrt(sampleVariance / blocks),
    blockMeans,
    blocks,
    samplesUsed: blocks * blockSize,
  };
}
