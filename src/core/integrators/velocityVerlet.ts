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
 */
export function velocityVerletStep(
  state: SimState,
  box: Box,
  species: readonly Species[],
  force: ForceModel,
  dt: number,
): StepResult {
  const { count, positions, velocities, forces, typeIds } = state;
  const halfDt = 0.5 * dt;

  // First half-kick + drift.
  for (let i = 0; i < count; i++) {
    const invMass = 1 / species[typeIds[i]].mass;
    for (let c = 0; c < 3; c++) {
      const idx = 3 * i + c;
      velocities[idx] += halfDt * forces[idx] * invMass;
      positions[idx] += dt * velocities[idx];
    }
  }

  const wallImpulse = applyBoundary(state, box, species);

  // Recompute forces F(t+Δt).
  const result = force.compute(state, box, species);

  // Second half-kick.
  for (let i = 0; i < count; i++) {
    const invMass = 1 / species[typeIds[i]].mass;
    for (let c = 0; c < 3; c++) {
      const idx = 3 * i + c;
      velocities[idx] += halfDt * forces[idx] * invMass;
    }
  }

  return { ...result, wallImpulse };
}
