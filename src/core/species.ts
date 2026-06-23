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

/**
 * Coarse-grained "water" and "oil" beads for the immiscible-mixture (demixing) demo.
 * Each bead lumps several heavy atoms; immiscibility is produced by reducing the
 * cross-species attraction (see {@link SimConfig.crossScale}), not by these parameters.
 */
export const WATER: Species = {
  name: "Eau",
  mass: 18.015,
  sigma: 0.31,
  epsilon: 1.0,
  charge: 0,
  color: 0x4aa3ff,
  radius: 0.16,
};

export const OIL: Species = {
  name: "Huile",
  mass: 60,
  sigma: 0.42,
  epsilon: 1.3,
  charge: 0,
  color: 0xf2b134,
  radius: 0.22,
};

/** Monatomic ions for the electrostatics (L3) demo: Na⁺ and Cl⁻ (Joung-Cheatham-like). */
export const SODIUM: Species = {
  name: "Na⁺",
  mass: 22.99,
  sigma: 0.251,
  epsilon: 0.544,
  charge: 1,
  color: 0xa066ff,
  radius: 0.13,
};

export const CHLORIDE: Species = {
  name: "Cl⁻",
  mass: 35.45,
  sigma: 0.448,
  epsilon: 0.42,
  charge: -1,
  color: 0x49d17a,
  radius: 0.22,
};

export const SPECIES_LIBRARY = {
  ARGON,
  NEON,
  WATER,
  OIL,
  SODIUM,
  CHLORIDE,
} as const;
