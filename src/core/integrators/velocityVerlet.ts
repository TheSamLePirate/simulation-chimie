import { applyBoundary } from "../boundary";
import type { Box, ForceModel, ForceResult, SimState, Species } from "../types";

/** Outcome of one integration step: post-step energetics plus wall impulse (reflective only). */
export interface StepResult extends ForceResult {
  /** Normal momentum transferred to the walls this step (0 for periodic). */
  readonly wallImpulse: number;
}

/**
 * One velocity-Verlet step. Assumes `state.forces` already holds F(t) (compute it
 * once before the first step). Symplectic and time-reversible, with O(Δt²) error.
 *
 *   v(t+½Δt) = v(t) + ½·a(t)·Δt
 *   x(t+Δt)  = x(t) + v(t+½Δt)·Δt
 *   a(t+Δt)  = F(t+Δt)/m
 *   v(t+Δt)  = v(t+½Δt) + ½·a(t+Δt)·Δt
 *
 * @param dt timestep in ps.
 * @param gravity downward acceleration in nm·ps⁻² applied to −y (0 = none).
 * @param electricField uniform field along +x in kJ·mol⁻¹·nm⁻¹·e⁻¹; force = q·E (0 = none).
 */
export function velocityVerletStep(
  state: SimState,
  box: Box,
  species: readonly Species[],
  force: ForceModel,
  dt: number,
  gravity = 0,
  electricField = 0,
): StepResult {
  const { count, positions, velocities, forces, typeIds } = state;
  const halfDt = 0.5 * dt;

  // First half-kick + drift. Gravity adds a uniform −y acceleration (mass-independent); the
  // electric field adds a charge-dependent +x acceleration q·E/m (0 for neutral atoms).
  for (let i = 0; i < count; i++) {
    const sp = species[typeIds[i]];
    const invMass = 1 / sp.mass;
    velocities[3 * i] += halfDt * (forces[3 * i] + sp.charge * electricField) * invMass;
    velocities[3 * i + 1] += halfDt * (forces[3 * i + 1] * invMass - gravity);
    velocities[3 * i + 2] += halfDt * forces[3 * i + 2] * invMass;
    positions[3 * i] += dt * velocities[3 * i];
    positions[3 * i + 1] += dt * velocities[3 * i + 1];
    positions[3 * i + 2] += dt * velocities[3 * i + 2];
  }

  const wallImpulse = applyBoundary(state, box, species);

  // Recompute forces F(t+Δt).
  const result = force.compute(state, box, species);

  // Second half-kick.
  for (let i = 0; i < count; i++) {
    const sp = species[typeIds[i]];
    const invMass = 1 / sp.mass;
    velocities[3 * i] += halfDt * (forces[3 * i] + sp.charge * electricField) * invMass;
    velocities[3 * i + 1] += halfDt * (forces[3 * i + 1] * invMass - gravity);
    velocities[3 * i + 2] += halfDt * forces[3 * i + 2] * invMass;
  }

  return { ...result, wallImpulse };
}
