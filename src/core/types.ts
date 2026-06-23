/**
 * Core domain types, shared by the CPU reference engine and (later) the GPU engine.
 *
 * State is stored as a Structure-of-Arrays (SoA) of flat typed arrays: cache-friendly
 * on CPU and a direct match for GPU storage buffers. Component layout is xyz-interleaved,
 * i.e. particle `i` occupies indices `3i, 3i+1, 3i+2`.
 *
 * Units are the internal engine units (see {@link ./units}): nm, ps, u, kJ·mol⁻¹, K, e.
 */

export type Vec3 = readonly [number, number, number];

/** Boundary handling for the cubic simulation cell, centred on the origin. */
export type BoundaryKind = "periodic" | "reflective";

/** Cubic simulation cell of side `lengths`, spanning [−L/2, L/2) on each axis. */
export interface Box {
  readonly lengths: Vec3;
  readonly boundary: BoundaryKind;
}

/** A chemical species / particle type and its force-field parameters. */
export interface Species {
  readonly name: string;
  /** Mass in unified atomic mass units (u). */
  readonly mass: number;
  /** Lennard-Jones diameter σ in nm. */
  readonly sigma: number;
  /** Lennard-Jones well depth ε in kJ·mol⁻¹. */
  readonly epsilon: number;
  /** Partial charge in elementary charge units (e). Unused until L3. */
  readonly charge: number;
  /** Render colour (0xRRGGBB). */
  readonly color: number;
  /** Render radius in nm (visual only; defaults to σ/2). */
  readonly radius: number;
}

/** Mutable simulation state (SoA). CPU engine uses Float64 for energy-conserving precision. */
export interface SimState {
  readonly count: number;
  /** Positions, nm. Length `3·count`. */
  readonly positions: Float64Array;
  /** Velocities, nm·ps⁻¹. Length `3·count`. */
  readonly velocities: Float64Array;
  /** Forces, kJ·mol⁻¹·nm⁻¹. Length `3·count`. */
  readonly forces: Float64Array;
  /** Species index per particle. Length `count`. */
  readonly typeIds: Uint8Array;
  /**
   * Molecule index per particle (length `count`). Atoms sharing an id belong to the
   * same molecule and are excluded from non-bonded interactions. Defaults to a unique
   * id per atom (monatomic ⇒ no exclusions).
   */
  readonly moleculeId: Int32Array;
}

/** Result of a force-model evaluation over the whole system. */
export interface ForceResult {
  /** Total potential energy, kJ·mol⁻¹. */
  readonly potentialEnergy: number;
  /** Scalar virial Σ_pairs r_ij · F_ij, kJ·mol⁻¹. */
  readonly virial: number;
}

/**
 * A pairwise (or trivial) force model. `compute` overwrites `state.forces` in place
 * and returns the system potential energy and virial. Pure with respect to positions:
 * it must not mutate positions or velocities.
 */
export interface ForceModel {
  readonly name: string;
  compute(state: SimState, box: Box, species: readonly Species[]): ForceResult;
}
