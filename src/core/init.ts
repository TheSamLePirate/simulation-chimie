import { removeCenterOfMassMotion, temperature } from "./observables";
import type { Rng } from "./rng";
import type { Box, SimState, Species } from "./types";
import { BOLTZMANN_KJ_PER_MOL_K } from "./units";

/**
 * Place particles on a simple-cubic lattice centred in the cell, optionally jittered.
 * A lattice start avoids overlaps, which keeps the WCA/LJ forces finite at t = 0.
 */
export function placeOnLattice(
  state: SimState,
  box: Box,
  options: { jitter?: number; rng?: Rng } = {},
): void {
  const { count, positions } = state;
  if (count === 0) return;

  const perSide = Math.ceil(Math.cbrt(count));
  const [lx, ly, lz] = box.lengths;
  const sx = lx / perSide;
  const sy = ly / perSide;
  const sz = lz / perSide;
  const jitter = options.jitter ?? 0;
  const rng = options.rng;

  let placed = 0;
  for (let ix = 0; ix < perSide && placed < count; ix++) {
    for (let iy = 0; iy < perSide && placed < count; iy++) {
      for (let iz = 0; iz < perSide && placed < count; iz++) {
        let x = -0.5 * lx + (ix + 0.5) * sx;
        let y = -0.5 * ly + (iy + 0.5) * sy;
        let z = -0.5 * lz + (iz + 0.5) * sz;
        if (jitter > 0 && rng) {
          x += jitter * sx * (rng.next() - 0.5);
          y += jitter * sy * (rng.next() - 0.5);
          z += jitter * sz * (rng.next() - 0.5);
        }
        positions[3 * placed] = x;
        positions[3 * placed + 1] = y;
        positions[3 * placed + 2] = z;
        placed++;
      }
    }
  }
}

/**
 * Draw velocities from the Maxwell-Boltzmann distribution at `temperatureK`: each
 * component is Gaussian with variance k_B·T/m. COM motion is removed, then velocities
 * are rescaled so the measured kinetic temperature matches the target exactly.
 */
export function setMaxwellBoltzmannVelocities(
  state: SimState,
  species: readonly Species[],
  temperatureK: number,
  rng: Rng,
): void {
  const { count, velocities, typeIds } = state;
  for (let i = 0; i < count; i++) {
    const mass = species[typeIds[i]].mass;
    const std = Math.sqrt((BOLTZMANN_KJ_PER_MOL_K * temperatureK) / mass);
    velocities[3 * i] = rng.gaussian(0, std);
    velocities[3 * i + 1] = rng.gaussian(0, std);
    velocities[3 * i + 2] = rng.gaussian(0, std);
  }

  removeCenterOfMassMotion(state, species);

  // Exact rescale to the target temperature (degrees of freedom = 3N − 3).
  if (count > 1 && temperatureK > 0) {
    const current = temperature(state, species, true);
    if (current > 0) {
      const factor = Math.sqrt(temperatureK / current);
      for (let k = 0; k < velocities.length; k++) velocities[k] *= factor;
    }
  }
}
