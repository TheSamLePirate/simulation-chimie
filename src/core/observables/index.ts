import type { SimState, Species, Vec3 } from "../types";
import { temperatureFromKinetic } from "../units";

/** Total translational kinetic energy, kJ·mol⁻¹. */
export function kineticEnergy(state: SimState, species: readonly Species[]): number {
  const { count, velocities, typeIds } = state;
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const mass = species[typeIds[i]].mass;
    const vx = velocities[3 * i];
    const vy = velocities[3 * i + 1];
    const vz = velocities[3 * i + 2];
    sum += 0.5 * mass * (vx * vx + vy * vy + vz * vz);
  }
  return sum;
}

/**
 * Instantaneous kinetic temperature (K). With `removeCom`, the 3 centre-of-mass
 * degrees of freedom are subtracted (the convention when COM motion is removed).
 */
export function temperature(
  state: SimState,
  species: readonly Species[],
  removeCom = true,
): number {
  const dof = 3 * state.count - (removeCom ? 3 : 0);
  return temperatureFromKinetic(kineticEnergy(state, species), dof);
}

/** Total linear momentum (u·nm·ps⁻¹). */
export function totalMomentum(state: SimState, species: readonly Species[]): Vec3 {
  const { count, velocities, typeIds } = state;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < count; i++) {
    const mass = species[typeIds[i]].mass;
    px += mass * velocities[3 * i];
    py += mass * velocities[3 * i + 1];
    pz += mass * velocities[3 * i + 2];
  }
  return [px, py, pz];
}

/** Centre-of-mass velocity (nm·ps⁻¹). */
export function centerOfMassVelocity(state: SimState, species: readonly Species[]): Vec3 {
  const { count, typeIds } = state;
  if (count === 0) return [0, 0, 0];
  let totalMass = 0;
  for (let i = 0; i < count; i++) totalMass += species[typeIds[i]].mass;
  const [px, py, pz] = totalMomentum(state, species);
  return [px / totalMass, py / totalMass, pz / totalMass];
}

/** Subtract the centre-of-mass velocity so total momentum becomes ~0. Mutates state. */
export function removeCenterOfMassMotion(state: SimState, species: readonly Species[]): void {
  const [cx, cy, cz] = centerOfMassVelocity(state, species);
  const { count, velocities } = state;
  for (let i = 0; i < count; i++) {
    velocities[3 * i] -= cx;
    velocities[3 * i + 1] -= cy;
    velocities[3 * i + 2] -= cz;
  }
}

/**
 * Virial pressure (kJ·mol⁻¹·nm⁻³): P = (2·E_kin + W) / (3V), where W = Σ r_ij·F_ij.
 * For an ideal gas (W = 0) this reduces to P = N·k_B·T / V.
 */
export function pressure(kineticEnergyKjPerMol: number, virial: number, volume: number): number {
  if (volume <= 0) return 0;
  return (2 * kineticEnergyKjPerMol + virial) / (3 * volume);
}
