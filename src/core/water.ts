import { setMaxwellBoltzmannVelocities } from "./init";
import type { Rng } from "./rng";
import { WATER_H, WATER_O } from "./species";
import { createState } from "./state";
import type { Box, SimState, Species } from "./types";

// SPC/Fw flexible water force-field parameters.
export const WATER_BOND_R0 = 0.1012; // nm
export const WATER_BOND_K = 443153; // kJ·mol⁻¹·nm⁻²
export const WATER_ANGLE_THETA0 = (113.24 * Math.PI) / 180; // rad
export const WATER_ANGLE_K = 317.5656; // kJ·mol⁻¹·rad⁻²

/** Bonded topology for a set of water molecules (2 O-H bonds + 1 H-O-H angle each). */
export interface WaterTopology {
  readonly bondI: Int32Array;
  readonly bondJ: Int32Array;
  readonly angleI: Int32Array;
  readonly angleJ: Int32Array; // central atom (O)
  readonly angleK: Int32Array;
}

export interface WaterSystem {
  readonly state: SimState;
  readonly species: readonly Species[];
  readonly topology: WaterTopology;
}

/** Build a box of `molecules` SPC/Fw water molecules on a lattice with random orientation. */
export function buildWaterSystem(
  molecules: number,
  box: Box,
  temperatureK: number,
  rng: Rng,
): WaterSystem {
  const atoms = molecules * 3;
  const typeIds = new Uint8Array(atoms);
  const moleculeId = new Int32Array(atoms);
  for (let m = 0; m < molecules; m++) {
    typeIds[3 * m] = 0; // O
    typeIds[3 * m + 1] = 1; // H
    typeIds[3 * m + 2] = 1; // H
    moleculeId[3 * m] = m;
    moleculeId[3 * m + 1] = m;
    moleculeId[3 * m + 2] = m;
  }
  const state = createState(atoms, typeIds, moleculeId);
  const species = [WATER_O, WATER_H];

  const perSide = Math.max(1, Math.ceil(Math.cbrt(molecules)));
  const [lx, ly, lz] = box.lengths;
  const sx = lx / perSide;
  const sy = ly / perSide;
  const sz = lz / perSide;

  const half = WATER_ANGLE_THETA0 / 2;
  const r0 = WATER_BOND_R0;
  // Local H positions (O at origin), symmetric about +y.
  const h1 = [r0 * Math.sin(half), r0 * Math.cos(half), 0];
  const h2 = [-r0 * Math.sin(half), r0 * Math.cos(half), 0];

  const pos = state.positions;
  let m = 0;
  for (let ix = 0; ix < perSide && m < molecules; ix++) {
    for (let iy = 0; iy < perSide && m < molecules; iy++) {
      for (let iz = 0; iz < perSide && m < molecules; iz++) {
        const ox = -0.5 * lx + (ix + 0.5) * sx;
        const oy = -0.5 * ly + (iy + 0.5) * sy;
        const oz = -0.5 * lz + (iz + 0.5) * sz;

        // Random rigid rotation (preserves bond lengths / angle): yaw then pitch.
        const a = rng.range(0, 2 * Math.PI);
        const b = rng.range(0, 2 * Math.PI);
        const rot = (v: number[]): [number, number, number] => {
          // Rz(a)
          const x1 = v[0] * Math.cos(a) - v[1] * Math.sin(a);
          const y1 = v[0] * Math.sin(a) + v[1] * Math.cos(a);
          const z1 = v[2];
          // Rx(b)
          const x2 = x1;
          const y2 = y1 * Math.cos(b) - z1 * Math.sin(b);
          const z2 = y1 * Math.sin(b) + z1 * Math.cos(b);
          return [x2, y2, z2];
        };

        const rh1 = rot(h1);
        const rh2 = rot(h2);
        pos[9 * m] = ox;
        pos[9 * m + 1] = oy;
        pos[9 * m + 2] = oz;
        pos[9 * m + 3] = ox + rh1[0];
        pos[9 * m + 4] = oy + rh1[1];
        pos[9 * m + 5] = oz + rh1[2];
        pos[9 * m + 6] = ox + rh2[0];
        pos[9 * m + 7] = oy + rh2[1];
        pos[9 * m + 8] = oz + rh2[2];
        m++;
      }
    }
  }

  setMaxwellBoltzmannVelocities(state, species, temperatureK, rng);

  const bondI = new Int32Array(2 * molecules);
  const bondJ = new Int32Array(2 * molecules);
  const angleI = new Int32Array(molecules);
  const angleJ = new Int32Array(molecules);
  const angleK = new Int32Array(molecules);
  for (let k = 0; k < molecules; k++) {
    bondI[2 * k] = 3 * k;
    bondJ[2 * k] = 3 * k + 1;
    bondI[2 * k + 1] = 3 * k;
    bondJ[2 * k + 1] = 3 * k + 2;
    angleI[k] = 3 * k + 1;
    angleJ[k] = 3 * k;
    angleK[k] = 3 * k + 2;
  }

  return { state, species, topology: { bondI, bondJ, angleI, angleJ, angleK } };
}
