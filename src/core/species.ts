import type { Species } from "./types";

/**
 * Species / force-field parameter library.
 *
 * Phase 1 only needs monatomic Lennard-Jones particles. Argon is the canonical
 * MD test fluid with well-characterised literature values, which makes it ideal
 * for validating the engine against known physics before water/oil arrive (P4).
 */

export const ARGON: Species = {
  name: "Ar",
  mass: 39.948, // u
  sigma: 0.3405, // nm
  epsilon: 0.9977, // kJ·mol⁻¹ (≈ 119.8 K · k_B)
  charge: 0,
  color: 0x4f9dff,
  radius: 0.17,
};

/** A light, fast generic particle — handy for snappy ideal-gas / soft-sphere demos. */
export const NEON: Species = {
  name: "Ne",
  mass: 20.18,
  sigma: 0.2782,
  epsilon: 0.2964,
  charge: 0,
  color: 0x7ee0c0,
  radius: 0.14,
};

export const SPECIES_LIBRARY = { ARGON, NEON } as const;
