import { buildAlkaneSystem } from "../core/alkane";
import { createBox, createBoxXYZ } from "../core/box";
import { type DistanceConstraints, rattle } from "../core/constraints";
import { buildSaltWaterSystem } from "../core/dissolution";
import type { AngleList, BondList, DihedralList } from "../core/forces/molecular";
import { placeOnLattice, setMaxwellBoltzmannVelocities } from "../core/init";
import { buildOilWaterSystem } from "../core/mixture";
import { buildMorseSystem } from "../core/morseDiatomic";
import { kineticEnergy } from "../core/observables";
import { Rng } from "../core/rng";
import { SPECIES_LIBRARY } from "../core/species";
import { createState } from "../core/state";
import { buildTip4p2005Slab } from "../core/tip4p2005";
import { buildExclusions, type NonbondedExclusions } from "../core/topology";
import type { Box, SimState, Species } from "../core/types";
import { BOLTZMANN_KJ_PER_MOL_K } from "../core/units";
import {
  buildWaterSystem,
  WATER_ANGLE_K,
  WATER_ANGLE_THETA0,
  WATER_BOND_K,
  WATER_BOND_R0,
  type WaterTopology,
} from "../core/water";
import type { AccuracyLevel, SimConfig } from "./types";

/**
 * How a level's forces are evaluated. The canonical system states this so the CPU builds its
 * force model from the same description the GPU packs its kernels from — instead of each engine
 * re-deriving the level→physics mapping and drifting apart.
 */
export type ForceSpec =
  | { readonly kind: "none" }
  | { readonly kind: "wca" }
  | { readonly kind: "lennardJones"; readonly crossScale: number }
  | { readonly kind: "ionic" }
  | {
      readonly kind: "water";
      readonly topology: WaterTopology;
      readonly rigid: boolean;
    }
  | {
      readonly kind: "molecular";
      readonly ljCutoffFactor: number;
      readonly coulombCutoff: number;
    }
  /** L11 owns its own force stack (TIP4P/2005 + PME + slab + tail) inside its experiment. */
  | { readonly kind: "surfaceTension" };

/** A fully-built simulation system, in Float64, that both engines consume. */
export interface BuiltSystem {
  readonly state: SimState;
  readonly box: Box;
  readonly species: readonly Species[];
  /** Harmonic or Morse bonds (`morseA[n] > 0` ⇒ anharmonic/dissociable). */
  readonly bonds: BondList;
  readonly angles: AngleList;
  /** Ryckaert-Bellemans torsions (L9); empty elsewhere. */
  readonly dihedrals: DihedralList;
  readonly constraints: DistanceConstraints;
  /** Render bonds (i,j) for ball-and-stick drawing, or null (monatomic). */
  readonly renderBonds: { i: Int32Array; j: Int32Array } | null;
  /** True when the system is molecular (has topology / rigid constraints). */
  readonly molecular: boolean;
  /** Which force model evaluates this system. */
  readonly forceSpec: ForceSpec;
  /** Actual atoms simulated — for molecular levels this exceeds `config.particleCount`. */
  readonly atomCount: number;
  /**
   * Which nonbonded pairs the topology removes (1-2/1-3/1-4), derived from bonds + constraints.
   * Both engines classify pairs from this one policy.
   */
  readonly exclusions: NonbondedExclusions;
}

// ── GPU packing ─────────────────────────────────────────────────────────────────

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
/** Flat, GPU-uploadable distance constraints (rigid molecules). */
export interface FlatConstraints {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly d0: Float32Array;
}

export interface GpuTopology {
  readonly bonds: FlatBonds;
  readonly angles: FlatAngles;
  readonly constraints: FlatConstraints;
}

/**
 * Narrow the canonical Float64 system to the Float32 arrays the GPU uploads. Packing lives here,
 * downstream of construction, so the canonical model stays precision-independent.
 */
export function toGpuTopology(built: BuiltSystem): GpuTopology {
  return {
    bonds: {
      i: Int32Array.from(built.bonds.i),
      j: Int32Array.from(built.bonds.j),
      r0: Float32Array.from(built.bonds.r0),
      k: Float32Array.from(built.bonds.k),
    },
    angles: {
      i: Int32Array.from(built.angles.i),
      j: Int32Array.from(built.angles.j),
      k: Int32Array.from(built.angles.k),
      theta0: Float32Array.from(built.angles.theta0),
      kt: Float32Array.from(built.angles.kt),
    },
    constraints: {
      i: Int32Array.from(built.constraints.i),
      j: Int32Array.from(built.constraints.j),
      d0: Float32Array.from(built.constraints.d0),
    },
  };
}

// ── Canonical empties ───────────────────────────────────────────────────────────

const EMPTY_BONDS: BondList = {
  i: new Int32Array(0),
  j: new Int32Array(0),
  r0: new Float64Array(0),
  k: new Float64Array(0),
};
const EMPTY_ANGLES: AngleList = {
  i: new Int32Array(0),
  j: new Int32Array(0),
  k: new Int32Array(0),
  theta0: new Float64Array(0),
  kt: new Float64Array(0),
};
const EMPTY_DIHEDRALS: DihedralList = {
  i: new Int32Array(0),
  j: new Int32Array(0),
  k: new Int32Array(0),
  l: new Int32Array(0),
  c: new Float64Array(0),
};
const EMPTY_CONSTRAINTS: DistanceConstraints = {
  i: new Int32Array(0),
  j: new Int32Array(0),
  d0: new Float64Array(0),
};

/** Molecular nonbonded cutoffs shared by the alkane/mixture/dissolution force models. */
const MOLECULAR_LJ_CUTOFF_FACTOR = 2.5;
const MOLECULAR_COULOMB_CUTOFF = 0.9;

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

/** Expand the water topology (uniform bond/angle params) into per-bond/per-angle arrays. */
function waterBondsAngles(topology: WaterTopology): {
  bonds: BondList;
  angles: AngleList;
} {
  const nb = topology.bondI.length;
  const na = topology.angleI.length;
  return {
    bonds: {
      i: Int32Array.from(topology.bondI),
      j: Int32Array.from(topology.bondJ),
      r0: new Float64Array(nb).fill(WATER_BOND_R0),
      k: new Float64Array(nb).fill(WATER_BOND_K),
    },
    angles: {
      i: Int32Array.from(topology.angleI),
      j: Int32Array.from(topology.angleJ),
      k: Int32Array.from(topology.angleK),
      theta0: new Float64Array(na).fill(WATER_ANGLE_THETA0),
      kt: new Float64Array(na).fill(WATER_ANGLE_K),
    },
  };
}

const MOLECULAR_FORCE: ForceSpec = {
  kind: "molecular",
  ljCutoffFactor: MOLECULAR_LJ_CUTOFF_FACTOR,
  coulombCutoff: MOLECULAR_COULOMB_CUTOFF,
};

/** Monatomic levels are fully described by level + crossScale (no topology involved). */
export type MonatomicLevel = "L0" | "L1" | "L2" | "L3";

export function isMonatomicLevel(level: AccuracyLevel): level is MonatomicLevel {
  return level === "L0" || level === "L1" || level === "L2" || level === "L3";
}

/**
 * The force description for a monatomic level. Shared by {@link buildSystem} and the CPU engine's
 * live level swap, so a level always means the same physics wherever it is applied.
 */
export function monatomicForceSpec(level: MonatomicLevel, crossScale: number): ForceSpec {
  switch (level) {
    case "L0":
      return { kind: "none" };
    case "L1":
      return { kind: "wca" };
    case "L2":
      return { kind: "lennardJones", crossScale };
    case "L3":
      return { kind: "ionic" };
  }
}

/**
 * Attach the topology-derived nonbonded policy. Exclusions come from bonds AND constraints:
 * rigid molecules carry no springs, so a bonds-only graph would leave their own atoms
 * interacting through LJ/Coulomb.
 */
function withExclusions(built: Omit<BuiltSystem, "exclusions">): BuiltSystem {
  return {
    ...built,
    exclusions: buildExclusions(built.atomCount, built.bonds, built.constraints),
  };
}

/**
 * Build a complete simulation system from a config: state + species + Float64 topology +
 * constraints + the force description. Deterministic (seeded) and backend-neutral — this is the
 * single place the level→system mapping lives, for BOTH engines. The GPU narrows the result
 * through {@link toGpuTopology}; the CPU builds its force model from `forceSpec`.
 */
export function buildSystem(config: SimConfig): BuiltSystem {
  const c = config;
  const initT = c.initialTemperature ?? c.temperature;
  const level: AccuracyLevel = c.level;

  switch (level) {
    // ── Monatomic: lattice + Maxwell-Boltzmann, optional second species ──────────
    case "L0":
    case "L1":
    case "L2":
    case "L3": {
      const box = createBox(c.boxLength, c.boundary);
      const primary = resolveSpecies(c.speciesName);
      const second = c.secondSpeciesName ? resolveSpecies(c.secondSpeciesName) : null;
      const species = second ? [primary, second] : [primary];
      // Ionic binaries start on a rock-salt lattice so opposite charges neighbour; everything
      // else uses a seeded random mix.
      const ionicCrystal = level === "L3" && second !== null;
      const typeIds = ionicCrystal
        ? buildRockSaltTypeIds(c.particleCount)
        : seededTypeIds(c.particleCount, second ? c.fractionSecond : 0, c.seed);
      const state = createState(c.particleCount, typeIds);
      const rng = new Rng(c.seed);
      const spacing = c.initialClump ? 0.37 : undefined;
      placeOnLattice(state, box, { jitter: 0.05, rng, spacing });
      setMaxwellBoltzmannVelocities(state, species, initT, rng);
      return withExclusions({
        state,
        box,
        species,
        bonds: EMPTY_BONDS,
        angles: EMPTY_ANGLES,
        dihedrals: EMPTY_DIHEDRALS,
        constraints: EMPTY_CONSTRAINTS,
        renderBonds: null,
        molecular: false,
        forceSpec: monatomicForceSpec(level, c.crossScale),
        atomCount: state.count,
      });
    }

    // ── Atomistic water: flexible (L4) or rigid (L5/L7 droplet) ─────────────────
    case "L4":
    case "L5":
    case "L7": {
      const box = createBox(c.boxLength, c.boundary);
      const rng = new Rng(c.seed);
      const rigid = level === "L5" || level === "L7";
      // L7: pack at liquid spacing in a centred clump ⇒ vacuum around ⇒ a droplet forms.
      const spacing = level === "L7" ? 0.31 : undefined;
      const sys = buildWaterSystem(c.particleCount, box, initT, rng, spacing);
      const { bonds, angles } = waterBondsAngles(sys.topology);
      return withExclusions({
        state: sys.state,
        box,
        species: sys.species,
        // Flexible water keeps its springs; rigid water is held by constraints instead.
        bonds: rigid ? EMPTY_BONDS : bonds,
        angles: rigid ? EMPTY_ANGLES : angles,
        dihedrals: EMPTY_DIHEDRALS,
        constraints: rigid ? sys.constraints : EMPTY_CONSTRAINTS,
        renderBonds: {
          i: Int32Array.from(sys.topology.bondI),
          j: Int32Array.from(sys.topology.bondJ),
        },
        molecular: true,
        forceSpec: { kind: "water", topology: sys.topology, rigid },
        atomCount: sys.state.count,
      });
    }

    // ── Oil/water mixture: rigid water + flexible alkane, layered by gravity ─────
    case "L6": {
      // Tall column so gravity makes the water/oil layering obvious along y.
      const box = createBoxXYZ(c.boxLength, c.boxLength * 2.5, c.boxLength, c.boundary);
      const nOil = Math.round(c.particleCount * c.fractionSecond);
      const nWater = Math.max(0, c.particleCount - nOil);
      const sys = buildOilWaterSystem(nWater, nOil, box, initT, new Rng(c.seed));
      return withExclusions({
        state: sys.state,
        box,
        species: sys.species,
        bonds: sys.bonds,
        angles: sys.angles,
        dihedrals: EMPTY_DIHEDRALS,
        constraints: sys.constraints,
        renderBonds: sys.renderBonds,
        molecular: true,
        forceSpec: MOLECULAR_FORCE,
        atomCount: sys.state.count,
      });
    }

    // ── Dissolution: a NaCl crystal solvated by SPC water ───────────────────────
    case "L8": {
      const box = createBox(c.boxLength, c.boundary);
      const crystalSide = Math.max(2, Math.round(Math.cbrt(c.particleCount)));
      const sys = buildSaltWaterSystem(box, initT, new Rng(c.seed), crystalSide);
      return withExclusions({
        state: sys.state,
        box,
        species: sys.species,
        bonds: sys.bonds,
        angles: sys.angles,
        dihedrals: EMPTY_DIHEDRALS,
        constraints: sys.constraints,
        renderBonds: sys.renderBonds,
        molecular: true,
        forceSpec: MOLECULAR_FORCE,
        atomCount: sys.state.count,
      });
    }

    // ── Alkane chains: bonds + angles + RB dihedrals ⇒ trans/gauche ─────────────
    case "L9": {
      const box = createBox(c.boxLength, c.boundary);
      const sys = buildAlkaneSystem(c.particleCount, ALKANE_CARBONS, box, initT, new Rng(c.seed));
      return withExclusions({
        state: sys.state,
        box,
        species: sys.species,
        bonds: sys.bonds,
        angles: sys.angles,
        dihedrals: sys.dihedrals,
        constraints: EMPTY_CONSTRAINTS,
        renderBonds: sys.renderBonds,
        molecular: true,
        forceSpec: MOLECULAR_FORCE,
        atomCount: sys.state.count,
      });
    }

    // ── Morse dissociation: anharmonic bonds that break when heated ─────────────
    case "L10": {
      const box = createBox(c.boxLength, c.boundary);
      const sys = buildMorseSystem(c.particleCount, box, initT, new Rng(c.seed));
      return withExclusions({
        state: sys.state,
        box,
        species: sys.species,
        bonds: sys.bonds,
        angles: sys.angles,
        dihedrals: EMPTY_DIHEDRALS,
        constraints: EMPTY_CONSTRAINTS,
        renderBonds: sys.renderBonds,
        molecular: true,
        forceSpec: MOLECULAR_FORCE,
        atomCount: sys.state.count,
      });
    }

    // ── Quantitative surface tension: TIP4P/2005 slab ───────────────────────────
    case "L11": {
      const box = createBoxXYZ(c.boxLength, c.boxLength, l11BoxHeight(c.particleCount), "periodic");
      const sys = buildTip4p2005Slab(c.particleCount, box, initT, new Rng(c.seed), L11_DENSITY);
      // Rigid water starts on its constraint manifold: project velocities, then restore the
      // target kinetic energy using the CONSTRAINED dof (6N−3), not 3N−3.
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
      return withExclusions({
        state: sys.state,
        box,
        species: sys.species,
        bonds: EMPTY_BONDS,
        angles: EMPTY_ANGLES,
        dihedrals: EMPTY_DIHEDRALS,
        constraints: sys.constraints,
        renderBonds: sys.renderBonds,
        molecular: true,
        forceSpec: { kind: "surfaceTension" },
        atomCount: sys.state.count,
      });
    }
  }
}

/** L9 chain length (united-atom carbons per chain). */
export const ALKANE_CARBONS = 9;
/** L11 reference liquid density (kg·m⁻³) the slab builder packs to. */
export const L11_DENSITY = 997;

/** L11 cell height: taller for the 1024-molecule reference so the vapour gap stays adequate. */
export function l11BoxHeight(molecules: number): number {
  return molecules >= 1024 ? 10 : 8;
}
