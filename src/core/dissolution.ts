import type { DistanceConstraints } from "./constraints";
import type { AngleList, BondList } from "./forces/molecular";
import { setMaxwellBoltzmannVelocities } from "./init";
import type { Rng } from "./rng";
import { CHLORIDE, SODIUM, WATER_H, WATER_O } from "./species";
import { createState } from "./state";
import type { Box, SimState, Species } from "./types";
import { WATER_ANGLE_THETA0, WATER_BOND_R0, WATER_HH } from "./water";

const ION_SPACING = 0.29; // nm, ~NaCl nearest-neighbour
const WATER_SPACING = 0.34; // nm (a touch below liquid density ⇒ stable, lighter)

export interface DissolutionSystem {
  readonly state: SimState;
  readonly species: readonly Species[];
  readonly bonds: BondList;
  readonly angles: AngleList;
  readonly constraints: DistanceConstraints;
  readonly renderBonds: { i: Int32Array; j: Int32Array };
}

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

/**
 * A rock-salt NaCl crystal (cube of `crystalSide` ions per axis) immersed in SPC water:
 * the polar water solvates the surface ions and the crystal dissolves. Species index map:
 * 0=O, 1=H, 2=Na⁺, 3=Cl⁻. Ions are free single atoms; water is rigid (SHAKE).
 */
export function buildSaltWaterSystem(
  box: Box,
  temperatureK: number,
  rng: Rng,
  crystalSide: number,
): DissolutionSystem {
  const [lx, ly, lz] = box.lengths;
  const half = ION_SPACING * (crystalSide - 1) * 0.5;
  // Ion positions (alternating rock-salt charge by parity), centred at the origin.
  const ionPos: number[] = [];
  const ionType: number[] = [];
  for (let ix = 0; ix < crystalSide; ix++) {
    for (let iy = 0; iy < crystalSide; iy++) {
      for (let iz = 0; iz < crystalSide; iz++) {
        ionPos.push(ix * ION_SPACING - half, iy * ION_SPACING - half, iz * ION_SPACING - half);
        ionType.push((ix + iy + iz) & 1 ? 3 : 2); // 2 = Na, 3 = Cl
      }
    }
  }
  // Neutralise the crystal (Wolf electrostatics assume ~charge neutrality): drop excess
  // corner ions of the majority type.
  let diff = ionType.filter((t) => t === 2).length - ionType.filter((t) => t === 3).length;
  const majority = diff > 0 ? 2 : 3;
  for (let k = ionType.length - 1; k >= 0 && diff !== 0; k--) {
    if (ionType[k] === majority) {
      ionType.splice(k, 1);
      ionPos.splice(3 * k, 3);
      diff += diff > 0 ? -1 : 1;
    }
  }

  const nIon = ionType.length;
  const crystalReach = half + 0.33; // keep water ≳ σ clear of the crystal (no initial overlap)

  // Water molecules on a lattice over the box, skipping the crystal region.
  const perSide = Math.max(1, Math.floor(Math.min(lx, ly, lz) / WATER_SPACING));
  const sx = lx / perSide;
  const sy = ly / perSide;
  const sz = lz / perSide;
  const waterO: number[] = [];
  for (let ix = 0; ix < perSide; ix++) {
    for (let iy = 0; iy < perSide; iy++) {
      for (let iz = 0; iz < perSide; iz++) {
        const x = -0.5 * lx + (ix + 0.5) * sx;
        const y = -0.5 * ly + (iy + 0.5) * sy;
        const z = -0.5 * lz + (iz + 0.5) * sz;
        if (
          Math.abs(x) < crystalReach &&
          Math.abs(y) < crystalReach &&
          Math.abs(z) < crystalReach
        ) {
          continue;
        }
        waterO.push(x, y, z);
      }
    }
  }
  const nWater = waterO.length / 3;

  const atoms = nIon + nWater * 3;
  const typeIds = new Uint8Array(atoms);
  const moleculeId = new Int32Array(atoms);
  const state = createState(atoms, typeIds, moleculeId);
  const pos = state.positions;
  const species = [WATER_O, WATER_H, SODIUM, CHLORIDE];

  // Ions: free single-atom "molecules".
  for (let k = 0; k < nIon; k++) {
    typeIds[k] = ionType[k];
    moleculeId[k] = k;
    pos[3 * k] = ionPos[3 * k];
    pos[3 * k + 1] = ionPos[3 * k + 1];
    pos[3 * k + 2] = ionPos[3 * k + 2];
  }

  // Water: O + 2H, rigid, random orientation.
  const hw = WATER_ANGLE_THETA0 / 2;
  const wH1 = [WATER_BOND_R0 * Math.sin(hw), WATER_BOND_R0 * Math.cos(hw), 0];
  const wH2 = [-WATER_BOND_R0 * Math.sin(hw), WATER_BOND_R0 * Math.cos(hw), 0];
  const cI: number[] = [];
  const cJ: number[] = [];
  const cD: number[] = [];
  const rbI: number[] = [];
  const rbJ: number[] = [];
  for (let w = 0; w < nWater; w++) {
    const o = nIon + 3 * w;
    const mol = nIon + w;
    typeIds[o] = 0;
    typeIds[o + 1] = 1;
    typeIds[o + 2] = 1;
    moleculeId[o] = mol;
    moleculeId[o + 1] = mol;
    moleculeId[o + 2] = mol;
    const a = rng.range(0, 2 * Math.PI);
    const b = rng.range(0, 2 * Math.PI);
    const rot = (v: readonly number[]): [number, number, number] => {
      const x1 = v[0] * Math.cos(a) - v[1] * Math.sin(a);
      const y1 = v[0] * Math.sin(a) + v[1] * Math.cos(a);
      const z1 = v[2];
      return [x1, y1 * Math.cos(b) - z1 * Math.sin(b), y1 * Math.sin(b) + z1 * Math.cos(b)];
    };
    const h1 = rot(wH1);
    const h2 = rot(wH2);
    pos[3 * o] = waterO[3 * w];
    pos[3 * o + 1] = waterO[3 * w + 1];
    pos[3 * o + 2] = waterO[3 * w + 2];
    pos[3 * (o + 1)] = waterO[3 * w] + h1[0];
    pos[3 * (o + 1) + 1] = waterO[3 * w + 1] + h1[1];
    pos[3 * (o + 1) + 2] = waterO[3 * w + 2] + h1[2];
    pos[3 * (o + 2)] = waterO[3 * w] + h2[0];
    pos[3 * (o + 2) + 1] = waterO[3 * w + 1] + h2[1];
    pos[3 * (o + 2) + 2] = waterO[3 * w + 2] + h2[2];
    cI.push(o, o, o + 1);
    cJ.push(o + 1, o + 2, o + 2);
    cD.push(WATER_BOND_R0, WATER_BOND_R0, WATER_HH);
    rbI.push(o, o);
    rbJ.push(o + 1, o + 2);
  }

  setMaxwellBoltzmannVelocities(state, species, temperatureK, rng);

  return {
    state,
    species,
    bonds: EMPTY_BONDS,
    angles: EMPTY_ANGLES,
    constraints: {
      i: Int32Array.from(cI),
      j: Int32Array.from(cJ),
      d0: Float64Array.from(cD),
    },
    renderBonds: { i: Int32Array.from(rbI), j: Int32Array.from(rbJ) },
  };
}
