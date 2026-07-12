import type { Box, SimState, Species } from "../types";

/** 1 u·nm⁻³ in kg·m⁻³. */
export const KG_PER_M3_PER_U_PER_NM3 = 1.6605390666;

export interface DensityProfile {
  /** Bin centres along z, nm. */
  readonly z: readonly number[];
  /** Mass density, kg·m⁻³. */
  readonly density: readonly number[];
  readonly binWidth: number;
}

/**
 * Mass-density profile ρ(z) for a slab. Atomic masses are accumulated in bins spanning
 * [−Lz/2, Lz/2), then divided by the bin volume. Positions are wrapped defensively so a
 * profile remains valid for a snapshot taken between boundary applications.
 */
export function massDensityProfileZ(
  state: SimState,
  box: Box,
  species: readonly Species[],
  bins = 100,
): DensityProfile {
  if (!Number.isInteger(bins) || bins < 1) throw new RangeError("bins must be a positive integer");
  const [lx, ly, lz] = box.lengths;
  const dz = lz / bins;
  const mass = new Float64Array(bins);
  for (let i = 0; i < state.count; i++) {
    const raw = state.positions[3 * i + 2];
    const wrapped = (((raw + lz / 2) % lz) + lz) % lz;
    const bin = Math.min(bins - 1, Math.floor(wrapped / dz));
    mass[bin] += species[state.typeIds[i]].mass;
  }

  const binVolume = lx * ly * dz;
  const z = new Array<number>(bins);
  const density = new Array<number>(bins);
  for (let i = 0; i < bins; i++) {
    z[i] = -lz / 2 + (i + 0.5) * dz;
    density[i] = (mass[i] / binVolume) * KG_PER_M3_PER_U_PER_NM3;
  }
  return { z, density, binWidth: dz };
}
