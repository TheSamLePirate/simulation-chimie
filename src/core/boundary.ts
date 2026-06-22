import type { Box, SimState, Species } from "./types";

/**
 * Apply the cell boundary to all particles after a position update.
 *
 * - `periodic`: wrap coordinates back into [−L/2, L/2). Returns 0.
 * - `reflective`: mirror coordinates at the walls and flip the normal velocity,
 *   returning the total normal momentum transferred to the walls this call
 *   (Σ 2·m·|v_n|). That impulse drives the kinetic-theory pressure meter, which
 *   lets us *measure* P·V = N·k_B·T rather than assert it.
 */
export function applyBoundary(state: SimState, box: Box, species: readonly Species[]): number {
  return box.boundary === "periodic"
    ? applyPeriodic(state, box)
    : applyReflective(state, box, species);
}

function applyPeriodic(state: SimState, box: Box): number {
  const { count, positions } = state;
  const [lx, ly, lz] = box.lengths;
  for (let i = 0; i < count; i++) {
    positions[3 * i] -= lx * Math.round(positions[3 * i] / lx);
    positions[3 * i + 1] -= ly * Math.round(positions[3 * i + 1] / ly);
    positions[3 * i + 2] -= lz * Math.round(positions[3 * i + 2] / lz);
  }
  return 0;
}

function applyReflective(state: SimState, box: Box, species: readonly Species[]): number {
  const { count, positions, velocities, typeIds } = state;
  let impulse = 0;

  for (let i = 0; i < count; i++) {
    const mass = species[typeIds[i]].mass;
    for (let c = 0; c < 3; c++) {
      const idx = 3 * i + c;
      const half = box.lengths[c] * 0.5;
      let x = positions[idx];

      if (x > half) {
        x = 2 * half - x;
        impulse += 2 * mass * Math.abs(velocities[idx]);
        velocities[idx] = -velocities[idx];
      } else if (x < -half) {
        x = -2 * half - x;
        impulse += 2 * mass * Math.abs(velocities[idx]);
        velocities[idx] = -velocities[idx];
      }
      positions[idx] = x;
    }
  }

  return impulse;
}
