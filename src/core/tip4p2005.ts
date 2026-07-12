import type { DistanceConstraints } from "./constraints";
import { setMaxwellBoltzmannVelocities } from "./init";
import type { Rng } from "./rng";
import { createState } from "./state";
import type { Box, SimState, Species } from "./types";

/**
 * TIP4P/2005 parameters from Abascal & Vega, JCP 123, 234505 (2005),
 * DOI 10.1063/1.2121687. The massless negative M site is evaluated virtually.
 */
export const TIP4P_2005 = {
  rOH: 0.09572,
  angleHOH: (104.52 * Math.PI) / 180,
  rOM: 0.01546,
  sigmaO: 0.31589,
  epsilonO: 0.7749,
  chargeH: 0.5564,
  chargeM: -1.1128,
} as const;

export const TIP4P_2005_O: Species = {
  name: "O (TIP4P/2005)",
  mass: 15.9994,
  sigma: TIP4P_2005.sigmaO,
  epsilon: TIP4P_2005.epsilonO,
  charge: 0,
  color: 0xff4d4d,
  radius: 0.135,
};

export const TIP4P_2005_H: Species = {
  name: "H (TIP4P/2005)",
  mass: 1.008,
  sigma: 0,
  epsilon: 0,
  charge: TIP4P_2005.chargeH,
  color: 0xeaeaea,
  radius: 0.06,
};

export const TIP4P_2005_SPECIES: readonly Species[] = [TIP4P_2005_O, TIP4P_2005_H];

/** H–H distance implied by the rigid geometry. */
export const TIP4P_2005_HH = 2 * TIP4P_2005.rOH * Math.sin(TIP4P_2005.angleHOH / 2);

/**
 * M lies on the O→(H midpoint) axis. With rigid geometry it is the affine combination
 * M = (1−γ)O + γ/2 H₁ + γ/2 H₂, making force redistribution exact and torque-preserving.
 */
export const TIP4P_2005_VIRTUAL_GAMMA =
  TIP4P_2005.rOM / (TIP4P_2005.rOH * Math.cos(TIP4P_2005.angleHOH / 2));

export interface Tip4p2005System {
  readonly state: SimState;
  readonly species: readonly Species[];
  readonly constraints: DistanceConstraints;
  readonly renderBonds: { readonly i: Int32Array; readonly j: Int32Array };
}

export interface Tip4p2005SlabSystem extends Tip4p2005System {
  readonly liquidThickness: number;
  readonly targetDensityKgPerM3: number;
}

type MutableVec3 = [number, number, number];

/** Uniform random SO(3) rotation from a seeded unit quaternion. */
function randomRotation(rng: Rng): (v: readonly number[]) => MutableVec3 {
  const u1 = rng.next();
  const u2 = rng.next();
  const u3 = rng.next();
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  const qx = a * Math.sin(2 * Math.PI * u2);
  const qy = a * Math.cos(2 * Math.PI * u2);
  const qz = b * Math.sin(2 * Math.PI * u3);
  const qw = b * Math.cos(2 * Math.PI * u3);
  return (v) => {
    // v' = v + 2 qw(q×v) + 2 q×(q×v).
    const tx = 2 * (qy * v[2] - qz * v[1]);
    const ty = 2 * (qz * v[0] - qx * v[2]);
    const tz = 2 * (qx * v[1] - qy * v[0]);
    return [
      v[0] + qw * tx + (qy * tz - qz * ty),
      v[1] + qw * ty + (qz * tx - qx * tz),
      v[2] + qw * tz + (qx * ty - qy * tx),
    ];
  };
}

/** Build rigid TIP4P/2005 molecules on a lattice. Only the three massive atoms enter SimState. */
export function buildTip4p2005System(
  molecules: number,
  box: Box,
  temperatureK: number,
  rng: Rng,
): Tip4p2005System {
  if (!Number.isInteger(molecules) || molecules < 1) {
    throw new RangeError("molecules must be a positive integer");
  }
  const count = molecules * 3;
  const typeIds = new Uint8Array(count);
  const moleculeId = new Int32Array(count);
  for (let m = 0; m < molecules; m++) {
    typeIds[3 * m] = 0;
    typeIds[3 * m + 1] = 1;
    typeIds[3 * m + 2] = 1;
    moleculeId[3 * m] = m;
    moleculeId[3 * m + 1] = m;
    moleculeId[3 * m + 2] = m;
  }
  const state = createState(count, typeIds, moleculeId);

  const perSide = Math.ceil(Math.cbrt(molecules));
  const [lx, ly, lz] = box.lengths;
  const sx = lx / perSide;
  const sy = ly / perSide;
  const sz = lz / perSide;
  const half = TIP4P_2005.angleHOH / 2;
  const h1 = [TIP4P_2005.rOH * Math.sin(half), TIP4P_2005.rOH * Math.cos(half), 0];
  const h2 = [-h1[0], h1[1], 0];

  let m = 0;
  for (let ix = 0; ix < perSide && m < molecules; ix++) {
    for (let iy = 0; iy < perSide && m < molecules; iy++) {
      for (let iz = 0; iz < perSide && m < molecules; iz++) {
        const ox = -lx / 2 + (ix + 0.5) * sx;
        const oy = -ly / 2 + (iy + 0.5) * sy;
        const oz = -lz / 2 + (iz + 0.5) * sz;
        const rotate = randomRotation(rng);
        const rh1 = rotate(h1);
        const rh2 = rotate(h2);
        const o = 3 * m;
        state.positions[3 * o] = ox;
        state.positions[3 * o + 1] = oy;
        state.positions[3 * o + 2] = oz;
        state.positions[3 * (o + 1)] = ox + rh1[0];
        state.positions[3 * (o + 1) + 1] = oy + rh1[1];
        state.positions[3 * (o + 1) + 2] = oz + rh1[2];
        state.positions[3 * (o + 2)] = ox + rh2[0];
        state.positions[3 * (o + 2) + 1] = oy + rh2[1];
        state.positions[3 * (o + 2) + 2] = oz + rh2[2];
        m++;
      }
    }
  }
  setMaxwellBoltzmannVelocities(state, TIP4P_2005_SPECIES, temperatureK, rng);

  const ci = new Int32Array(3 * molecules);
  const cj = new Int32Array(3 * molecules);
  const d0 = new Float64Array(3 * molecules);
  const bi = new Int32Array(2 * molecules);
  const bj = new Int32Array(2 * molecules);
  for (let k = 0; k < molecules; k++) {
    const o = 3 * k;
    ci[3 * k] = o;
    cj[3 * k] = o + 1;
    d0[3 * k] = TIP4P_2005.rOH;
    ci[3 * k + 1] = o;
    cj[3 * k + 1] = o + 2;
    d0[3 * k + 1] = TIP4P_2005.rOH;
    ci[3 * k + 2] = o + 1;
    cj[3 * k + 2] = o + 2;
    d0[3 * k + 2] = TIP4P_2005_HH;
    bi[2 * k] = o;
    bj[2 * k] = o + 1;
    bi[2 * k + 1] = o;
    bj[2 * k + 1] = o + 2;
  }
  return {
    state,
    species: TIP4P_2005_SPECIES,
    constraints: { i: ci, j: cj, d0 },
    renderBonds: { i: bi, j: bj },
  };
}

/**
 * Build a centred liquid slab at an exact target mass density on a BCC oxygen lattice.
 * The vacuum lies along z. An even molecule count is required because each unit cell
 * contributes two oxygen sites.
 */
export function buildTip4p2005Slab(
  molecules: number,
  box: Box,
  temperatureK: number,
  rng: Rng,
  targetDensityKgPerM3 = 997,
): Tip4p2005SlabSystem {
  if (!Number.isInteger(molecules) || molecules < 2 || molecules % 2 !== 0) {
    throw new RangeError("TIP4P/2005 slab requires a positive even molecule count");
  }
  if (!(targetDensityKgPerM3 > 0)) throw new RangeError("target density must be positive");
  const [lx, ly, lz] = box.lengths;
  const molecularMassU = TIP4P_2005_O.mass + 2 * TIP4P_2005_H.mass;
  const kgPerM3PerUNm3 = 1.6605390666;
  const liquidVolume = (molecules * molecularMassU * kgPerM3PerUNm3) / targetDensityKgPerM3;
  const liquidThickness = liquidVolume / (lx * ly);
  if (!(liquidThickness < lz)) {
    throw new RangeError("the target-density slab does not fit inside the simulation box");
  }

  const cells = molecules / 2;
  let best: readonly [number, number, number] | null = null;
  let bestCost = Infinity;
  for (let nx = 1; nx <= cells; nx++) {
    if (cells % nx !== 0) continue;
    const yz = cells / nx;
    for (let ny = 1; ny <= yz; ny++) {
      if (yz % ny !== 0) continue;
      const nz = yz / ny;
      const spacings = [lx / nx, ly / ny, liquidThickness / nz];
      const cost = Math.max(...spacings) / Math.min(...spacings);
      if (cost < bestCost) {
        bestCost = cost;
        best = [nx, ny, nz];
      }
    }
  }
  if (!best) throw new Error("unable to factor slab lattice");

  const system = buildTip4p2005System(molecules, box, temperatureK, rng);
  const [nx, ny, nz] = best;
  let molecule = 0;
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        for (const basis of [0.25, 0.75]) {
          const oxygen = 3 * molecule;
          const oldO = system.state.positions.slice(3 * oxygen, 3 * oxygen + 3);
          const target = [
            -lx / 2 + ((ix + basis) * lx) / nx,
            -ly / 2 + ((iy + basis) * ly) / ny,
            -liquidThickness / 2 + ((iz + basis) * liquidThickness) / nz,
          ];
          for (let atom = oxygen; atom < oxygen + 3; atom++) {
            for (let component = 0; component < 3; component++) {
              system.state.positions[3 * atom + component] += target[component] - oldO[component];
            }
          }
          molecule++;
        }
      }
    }
  }
  return { ...system, liquidThickness, targetDensityKgPerM3 };
}

export function tip4pVirtualPosition(
  oxygen: ArrayLike<number>,
  hydrogen1: ArrayLike<number>,
  hydrogen2: ArrayLike<number>,
): MutableVec3 {
  const g = TIP4P_2005_VIRTUAL_GAMMA;
  const h = 0.5 * g;
  return [
    (1 - g) * oxygen[0] + h * (hydrogen1[0] + hydrogen2[0]),
    (1 - g) * oxygen[1] + h * (hydrogen1[1] + hydrogen2[1]),
    (1 - g) * oxygen[2] + h * (hydrogen1[2] + hydrogen2[2]),
  ];
}

/** Virtual M position using O-relative minimum images, safe when a molecule straddles a PBC face. */
export function tip4pVirtualPositionInBox(
  oxygen: ArrayLike<number>,
  hydrogen1: ArrayLike<number>,
  hydrogen2: ArrayLike<number>,
  box: Box,
): MutableVec3 {
  const periodic = box.boundary === "periodic";
  const minimum = (delta: number, length: number) =>
    periodic ? delta - length * Math.round(delta / length) : delta;
  const d1 = [
    minimum(hydrogen1[0] - oxygen[0], box.lengths[0]),
    minimum(hydrogen1[1] - oxygen[1], box.lengths[1]),
    minimum(hydrogen1[2] - oxygen[2], box.lengths[2]),
  ];
  const d2 = [
    minimum(hydrogen2[0] - oxygen[0], box.lengths[0]),
    minimum(hydrogen2[1] - oxygen[1], box.lengths[1]),
    minimum(hydrogen2[2] - oxygen[2], box.lengths[2]),
  ];
  const h = 0.5 * TIP4P_2005_VIRTUAL_GAMMA;
  return [
    oxygen[0] + h * (d1[0] + d2[0]),
    oxygen[1] + h * (d1[1] + d2[1]),
    oxygen[2] + h * (d1[2] + d2[2]),
  ];
}

/** Exact transpose-Jacobian redistribution of a force applied at the virtual M site. */
export function redistributeTip4pVirtualForce(forceM: ArrayLike<number>): {
  oxygen: MutableVec3;
  hydrogen1: MutableVec3;
  hydrogen2: MutableVec3;
} {
  const g = TIP4P_2005_VIRTUAL_GAMMA;
  const h = 0.5 * g;
  return {
    oxygen: [(1 - g) * forceM[0], (1 - g) * forceM[1], (1 - g) * forceM[2]],
    hydrogen1: [h * forceM[0], h * forceM[1], h * forceM[2]],
    hydrogen2: [h * forceM[0], h * forceM[1], h * forceM[2]],
  };
}
