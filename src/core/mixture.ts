import type { DistanceConstraints } from "./constraints";
import type { AngleList, BondList } from "./forces/molecular";
import { setMaxwellBoltzmannVelocities } from "./init";
import type { Rng } from "./rng";
import { OIL_CH2, OIL_CH3, WATER_H, WATER_O } from "./species";
import { createState } from "./state";
import type { Box, SimState, Species } from "./types";
import { WATER_ANGLE_THETA0, WATER_BOND_R0, WATER_HH } from "./water";

// Oil (united-atom alkane, TraPPE) intramolecular parameters.
const OIL_BOND_R0 = 0.154; // nm (C–C)
const OIL_BOND_K = 200000; // kJ·mol⁻¹·nm⁻²
const OIL_ANGLE_THETA0 = (114 * Math.PI) / 180;
const OIL_ANGLE_K = 519.6; // kJ·mol⁻¹·rad⁻²

export interface MixtureSystem {
  readonly state: SimState;
  readonly species: readonly Species[];
  readonly bonds: BondList;
  readonly angles: AngleList;
  /** Rigid water constraints (SHAKE/RATTLE). */
  readonly constraints: DistanceConstraints;
  /** Bonds for rendering (water O–H + oil C–C). */
  readonly renderBonds: { i: Int32Array; j: Int32Array };
}

/** Random rigid rotation (yaw then pitch) — preserves bond lengths and angles. */
function makeRotation(rng: Rng): (v: readonly number[]) => [number, number, number] {
  const a = rng.range(0, 2 * Math.PI);
  const b = rng.range(0, 2 * Math.PI);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  return (v) => {
    const x1 = v[0] * ca - v[1] * sa;
    const y1 = v[0] * sa + v[1] * ca;
    const z1 = v[2];
    return [x1, y1 * cb - z1 * sb, y1 * sb + z1 * cb];
  };
}

/**
 * Build a box of `nWater` SPC water molecules + `nOil` propane-like oil molecules, placed
 * (mixed) on a lattice with random orientation. Water is held rigid by SHAKE constraints;
 * oil is flexible (harmonic bonds + angle). Species index map: 0=O, 1=H, 2=CH3, 3=CH2.
 */
export function buildOilWaterSystem(
  nWater: number,
  nOil: number,
  box: Box,
  temperatureK: number,
  rng: Rng,
): MixtureSystem {
  const nMol = nWater + nOil;
  const atoms = nMol * 3;
  const species = [WATER_O, WATER_H, OIL_CH3, OIL_CH2];
  const typeIds = new Uint8Array(atoms);
  const moleculeId = new Int32Array(atoms);

  // Shuffle which lattice cells are water vs oil (seeded) ⇒ starts mixed.
  const kinds = new Uint8Array(nMol); // 0 = water, 1 = oil
  for (let m = nWater; m < nMol; m++) kinds[m] = 1;
  for (let m = nMol - 1; m > 0; m--) {
    const s = Math.floor(rng.next() * (m + 1));
    const t = kinds[m];
    kinds[m] = kinds[s];
    kinds[s] = t;
  }

  const state = createState(atoms, typeIds, moleculeId);
  const pos = state.positions;

  // Local geometries.
  const halfW = WATER_ANGLE_THETA0 / 2;
  const wH1 = [WATER_BOND_R0 * Math.sin(halfW), WATER_BOND_R0 * Math.cos(halfW), 0];
  const wH2 = [-WATER_BOND_R0 * Math.sin(halfW), WATER_BOND_R0 * Math.cos(halfW), 0];
  const halfO = OIL_ANGLE_THETA0 / 2;
  const oA = [OIL_BOND_R0 * Math.sin(halfO), OIL_BOND_R0 * Math.cos(halfO), 0]; // CH3
  const oC = [-OIL_BOND_R0 * Math.sin(halfO), OIL_BOND_R0 * Math.cos(halfO), 0]; // CH3

  // Per-axis grid matching the box aspect (uniform spacing in any box shape).
  const [lx, ly, lz] = box.lengths;
  const ideal = Math.cbrt((lx * ly * lz) / nMol);
  let nx = Math.max(1, Math.round(lx / ideal));
  let ny = Math.max(1, Math.round(ly / ideal));
  let nz = Math.max(1, Math.round(lz / ideal));
  while (nx * ny * nz < nMol) {
    const spx = lx / nx;
    const spy = ly / ny;
    const spz = lz / nz;
    if (spx >= spy && spx >= spz) nx++;
    else if (spy >= spz) ny++;
    else nz++;
  }
  const sx = lx / nx;
  const sy = ly / ny;
  const sz = lz / nz;

  // Constraint / bond / angle accumulators.
  const cI: number[] = [];
  const cJ: number[] = [];
  const cD: number[] = [];
  const bI: number[] = [];
  const bJ: number[] = [];
  const bR: number[] = [];
  const bK: number[] = [];
  const aI: number[] = [];
  const aJ: number[] = [];
  const aK: number[] = [];
  const aT: number[] = [];
  const aKt: number[] = [];
  const rbI: number[] = [];
  const rbJ: number[] = [];

  let m = 0;
  for (let ix = 0; ix < nx && m < nMol; ix++) {
    for (let iy = 0; iy < ny && m < nMol; iy++) {
      for (let iz = 0; iz < nz && m < nMol; iz++) {
        const ox = -0.5 * lx + (ix + 0.5) * sx;
        const oy = -0.5 * ly + (iy + 0.5) * sy;
        const oz = -0.5 * lz + (iz + 0.5) * sz;
        const rot = makeRotation(rng);
        const base = 3 * m;
        moleculeId[base] = m;
        moleculeId[base + 1] = m;
        moleculeId[base + 2] = m;

        if (kinds[m] === 0) {
          // Water: O + 2H (rigid).
          typeIds[base] = 0;
          typeIds[base + 1] = 1;
          typeIds[base + 2] = 1;
          const h1 = rot(wH1);
          const h2 = rot(wH2);
          pos[3 * base] = ox;
          pos[3 * base + 1] = oy;
          pos[3 * base + 2] = oz;
          pos[3 * base + 3] = ox + h1[0];
          pos[3 * base + 4] = oy + h1[1];
          pos[3 * base + 5] = oz + h1[2];
          pos[3 * base + 6] = ox + h2[0];
          pos[3 * base + 7] = oy + h2[1];
          pos[3 * base + 8] = oz + h2[2];
          cI.push(base, base, base + 1);
          cJ.push(base + 1, base + 2, base + 2);
          cD.push(WATER_BOND_R0, WATER_BOND_R0, WATER_HH);
          rbI.push(base, base);
          rbJ.push(base + 1, base + 2);
        } else {
          // Oil: CH3–CH2–CH3 (flexible). atom order: CH3(0) CH2(1,vertex) CH3(2).
          typeIds[base] = 2;
          typeIds[base + 1] = 3;
          typeIds[base + 2] = 2;
          const c1 = rot(oA);
          const c2 = rot(oC);
          pos[3 * base] = ox + c1[0];
          pos[3 * base + 1] = oy + c1[1];
          pos[3 * base + 2] = oz + c1[2];
          pos[3 * base + 3] = ox;
          pos[3 * base + 4] = oy;
          pos[3 * base + 5] = oz;
          pos[3 * base + 6] = ox + c2[0];
          pos[3 * base + 7] = oy + c2[1];
          pos[3 * base + 8] = oz + c2[2];
          bI.push(base, base + 1);
          bJ.push(base + 1, base + 2);
          bR.push(OIL_BOND_R0, OIL_BOND_R0);
          bK.push(OIL_BOND_K, OIL_BOND_K);
          aI.push(base);
          aJ.push(base + 1);
          aK.push(base + 2);
          aT.push(OIL_ANGLE_THETA0);
          aKt.push(OIL_ANGLE_K);
          rbI.push(base, base + 1);
          rbJ.push(base + 1, base + 2);
        }
        m++;
      }
    }
  }

  setMaxwellBoltzmannVelocities(state, species, temperatureK, rng);

  return {
    state,
    species,
    bonds: {
      i: Int32Array.from(bI),
      j: Int32Array.from(bJ),
      r0: Float64Array.from(bR),
      k: Float64Array.from(bK),
    },
    angles: {
      i: Int32Array.from(aI),
      j: Int32Array.from(aJ),
      k: Int32Array.from(aK),
      theta0: Float64Array.from(aT),
      kt: Float64Array.from(aKt),
    },
    constraints: {
      i: Int32Array.from(cI),
      j: Int32Array.from(cJ),
      d0: Float64Array.from(cD),
    },
    renderBonds: { i: Int32Array.from(rbI), j: Int32Array.from(rbJ) },
  };
}
