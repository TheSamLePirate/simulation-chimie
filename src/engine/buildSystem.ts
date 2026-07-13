import { createBox, createBoxXYZ } from "../core/box";
import { rattle } from "../core/constraints";
import { buildSaltWaterSystem } from "../core/dissolution";
import { placeOnLattice, setMaxwellBoltzmannVelocities } from "../core/init";
import { buildOilWaterSystem } from "../core/mixture";
import { kineticEnergy } from "../core/observables";
import { Rng } from "../core/rng";
import { SPECIES_LIBRARY } from "../core/species";
import { createState } from "../core/state";
import { buildTip4p2005Slab } from "../core/tip4p2005";
import type { Box, SimState, Species } from "../core/types";
import { BOLTZMANN_KJ_PER_MOL_K } from "../core/units";
import {
  buildWaterSystem,
  WATER_ANGLE_K,
  WATER_ANGLE_THETA0,
  WATER_BOND_K,
  WATER_BOND_R0,
} from "../core/water";
import type { SimConfig } from "./types";

/** Flat, GPU-uploadable harmonic bonds (i–j at r0, stiffness k). */
export interface FlatBonds {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly r0: Float32Array;
  readonly k: Float32Array;
}
/** Flat, GPU-uploadable harmonic angles i–j–k (j = vertex) at theta0, stiffness kt. */
export interface FlatAngles {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly k: Int32Array;
  readonly theta0: Float32Array;
  readonly kt: Float32Array;
}
/** Flat, GPU-uploadable distance constraints (rigid molecules: SETTLE on GPU). */
export interface FlatConstraints {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly d0: Float32Array;
}

/** A fully-built simulation system in a uniform shape both engines can consume. */
export interface BuiltSystem {
  readonly state: SimState;
  readonly box: Box;
  readonly species: readonly Species[];
  readonly bonds: FlatBonds;
  readonly angles: FlatAngles;
  readonly constraints: FlatConstraints;
  /** Render bonds (i,j) for ball-and-stick molecular drawing, or null (monatomic). */
  readonly renderBonds: { i: Int32Array; j: Int32Array } | null;
  /** True when the system is molecular (has topology / rigid constraints). */
  readonly molecular: boolean;
}

const EMPTY_BONDS: FlatBonds = {
  i: new Int32Array(0),
  j: new Int32Array(0),
  r0: new Float32Array(0),
  k: new Float32Array(0),
};
const EMPTY_ANGLES: FlatAngles = {
  i: new Int32Array(0),
  j: new Int32Array(0),
  k: new Int32Array(0),
  theta0: new Float32Array(0),
  kt: new Float32Array(0),
};
const EMPTY_CONSTRAINTS: FlatConstraints = {
  i: new Int32Array(0),
  j: new Int32Array(0),
  d0: new Float32Array(0),
};

function resolveSpecies(name: string): Species {
  const key = name.toUpperCase() as keyof typeof SPECIES_LIBRARY;
  return SPECIES_LIBRARY[key] ?? SPECIES_LIBRARY.ARGON;
}

/** Rock-salt species assignment matching placeOnLattice's ix→iy→iz fill order (L3 ionic). */
function buildRockSaltTypeIds(count: number): Uint8Array {
  const ids = new Uint8Array(count);
  const perSide = Math.ceil(Math.cbrt(count));
  for (let p = 0; p < count; p++) {
    const iz = p % perSide;
    const iy = Math.floor(p / perSide) % perSide;
    const ix = Math.floor(p / (perSide * perSide));
    ids[p] = (ix + iy + iz) & 1;
  }
  return ids;
}

function seededTypeIds(count: number, fraction: number, seed: number): Uint8Array {
  const ids = new Uint8Array(count);
  if (fraction > 0) {
    const rng = new Rng(seed ^ 0x5bd1e995);
    for (let i = 0; i < count; i++) ids[i] = rng.next() < fraction ? 1 : 0;
  }
  return ids;
}

/** Expand the water topology (uniform bond/angle params) into flat per-bond/per-angle arrays. */
function waterBondsAngles(topology: {
  bondI: Int32Array;
  bondJ: Int32Array;
  angleI: Int32Array;
  angleJ: Int32Array;
  angleK: Int32Array;
}): { bonds: FlatBonds; angles: FlatAngles } {
  const nb = topology.bondI.length;
  const bonds: FlatBonds = {
    i: Int32Array.from(topology.bondI),
    j: Int32Array.from(topology.bondJ),
    r0: new Float32Array(nb).fill(WATER_BOND_R0),
    k: new Float32Array(nb).fill(WATER_BOND_K),
  };
  const na = topology.angleI.length;
  const angles: FlatAngles = {
    i: Int32Array.from(topology.angleI),
    j: Int32Array.from(topology.angleJ),
    k: Int32Array.from(topology.angleK),
    theta0: new Float32Array(na).fill(WATER_ANGLE_THETA0),
    kt: new Float32Array(na).fill(WATER_ANGLE_K),
  };
  return { bonds, angles };
}

const flatBonds = (b: {
  i: Int32Array;
  j: Int32Array;
  r0: Float64Array;
  k: Float64Array;
}): FlatBonds => ({
  i: Int32Array.from(b.i),
  j: Int32Array.from(b.j),
  r0: Float32Array.from(b.r0),
  k: Float32Array.from(b.k),
});
const flatAngles = (a: {
  i: Int32Array;
  j: Int32Array;
  k: Int32Array;
  theta0: Float64Array;
  kt: Float64Array;
}): FlatAngles => ({
  i: Int32Array.from(a.i),
  j: Int32Array.from(a.j),
  k: Int32Array.from(a.k),
  theta0: Float32Array.from(a.theta0),
  kt: Float32Array.from(a.kt),
});
const flatConstraints = (c: {
  i: Int32Array;
  j: Int32Array;
  d0: Float64Array;
}): FlatConstraints => ({
  i: Int32Array.from(c.i),
  j: Int32Array.from(c.j),
  d0: Float32Array.from(c.d0),
});

/**
 * Build a complete simulation system from a config, in a uniform shape (state + species +
 * flat topology + constraints). Deterministic (seeded) — produces the SAME initial state as
 * {@link CpuEngine.configure} for a given config, so the GPU and CPU engines stay in lock-step.
 * This is the single place the level→system mapping lives for the GPU engine.
 */
export function buildSystem(config: SimConfig): BuiltSystem {
  const c = config;
  const initT = c.initialTemperature ?? c.temperature;

  if (c.level === "L11") {
    const lz = c.particleCount >= 1024 ? 10 : 8;
    const box = createBoxXYZ(c.boxLength, c.boxLength, lz, "periodic");
    const sys = buildTip4p2005Slab(c.particleCount, box, initT, new Rng(c.seed), 997);
    const inverseMass = new Float64Array(sys.state.count);
    for (let atom = 0; atom < sys.state.count; atom++) {
      inverseMass[atom] = 1 / sys.species[sys.state.typeIds[atom]].mass;
    }
    rattle(sys.state, sys.constraints, inverseMass, box);
    const currentKinetic = kineticEnergy(sys.state, sys.species);
    const targetKinetic = 0.5 * (6 * c.particleCount - 3) * BOLTZMANN_KJ_PER_MOL_K * initT;
    const velocityScale = Math.sqrt(targetKinetic / currentKinetic);
    for (let i = 0; i < sys.state.velocities.length; i++) {
      sys.state.velocities[i] *= velocityScale;
    }
    return {
      state: sys.state,
      box,
      species: sys.species,
      bonds: EMPTY_BONDS,
      angles: EMPTY_ANGLES,
      constraints: flatConstraints(sys.constraints),
      renderBonds: sys.renderBonds,
      molecular: true,
    };
  }

  // --- Molecular levels (L4–L8): dedicated builders return topology + constraints. ---
  if (c.level === "L4" || c.level === "L5" || c.level === "L7") {
    const box = createBox(c.boxLength, c.boundary);
    const rng = new Rng(c.seed);
    const rigid = c.level === "L5" || c.level === "L7";
    const spacing = c.level === "L7" ? 0.31 : undefined;
    const sys = buildWaterSystem(c.particleCount, box, initT, rng, spacing);
    const { bonds, angles } = waterBondsAngles(sys.topology);
    return {
      state: sys.state,
      box,
      species: sys.species,
      // Flexible water (L4) keeps its bonds/angles; rigid water (L5/L7) is held by constraints.
      bonds: rigid ? EMPTY_BONDS : bonds,
      angles: rigid ? EMPTY_ANGLES : angles,
      constraints: rigid ? flatConstraints(sys.constraints) : EMPTY_CONSTRAINTS,
      renderBonds: {
        i: Int32Array.from(sys.topology.bondI),
        j: Int32Array.from(sys.topology.bondJ),
      },
      molecular: true,
    };
  }

  if (c.level === "L6") {
    const box = createBoxXYZ(c.boxLength, c.boxLength * 2.5, c.boxLength, c.boundary);
    const nOil = Math.round(c.particleCount * c.fractionSecond);
    const nWater = Math.max(0, c.particleCount - nOil);
    const rng = new Rng(c.seed);
    const sys = buildOilWaterSystem(nWater, nOil, box, initT, rng);
    return {
      state: sys.state,
      box,
      species: sys.species,
      bonds: flatBonds(sys.bonds),
      angles: flatAngles(sys.angles),
      constraints: flatConstraints(sys.constraints),
      renderBonds: sys.renderBonds,
      molecular: true,
    };
  }

  if (c.level === "L8") {
    const box = createBox(c.boxLength, c.boundary);
    const crystalSide = Math.max(2, Math.round(Math.cbrt(c.particleCount)));
    const rng = new Rng(c.seed);
    const sys = buildSaltWaterSystem(box, initT, rng, crystalSide);
    return {
      state: sys.state,
      box,
      species: sys.species,
      bonds: flatBonds(sys.bonds),
      angles: flatAngles(sys.angles),
      constraints: flatConstraints(sys.constraints),
      renderBonds: sys.renderBonds,
      molecular: true,
    };
  }

  // --- Monatomic levels (L0–L3): lattice + Maxwell-Boltzmann, optional second species. ---
  const box = createBox(c.boxLength, c.boundary);
  const primary = resolveSpecies(c.speciesName);
  const second = c.secondSpeciesName ? resolveSpecies(c.secondSpeciesName) : null;
  const species = second ? [primary, second] : [primary];
  const ionicCrystal = c.level === "L3" && second !== null;
  const typeIds = ionicCrystal
    ? buildRockSaltTypeIds(c.particleCount)
    : seededTypeIds(c.particleCount, c.fractionSecond, c.seed);
  const state = createState(c.particleCount, typeIds);
  const rng = new Rng(c.seed);
  const spacing = c.initialClump ? 0.37 : undefined;
  placeOnLattice(state, box, { jitter: 0.05, rng, spacing });
  setMaxwellBoltzmannVelocities(state, species, initT, rng);
  return {
    state,
    box,
    species,
    bonds: EMPTY_BONDS,
    angles: EMPTY_ANGLES,
    constraints: EMPTY_CONSTRAINTS,
    renderBonds: null,
    molecular: false,
  };
}
