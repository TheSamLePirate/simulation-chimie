import type { Box, SimState } from "./types";

/** Fixed-distance constraints (i–j held at d0), e.g. rigid water bonds + H–H. */
export interface DistanceConstraints {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly d0: Float64Array;
}

function mi(d: number, l: number, periodic: boolean): number {
  return periodic ? d - l * Math.round(d / l) : d;
}

/**
 * SHAKE — iteratively project positions onto the distance constraints, using the
 * reference (pre-move) bond directions, and fold the position corrections back into the
 * velocities (Δr/Δt). Together with {@link rattle} this realises rigid-body MD
 * (equivalent in effect to SETTLE for 3-site water).
 */
export function shake(
  state: SimState,
  c: DistanceConstraints,
  ref: Float64Array,
  invMass: Float64Array,
  box: Box,
  dt: number,
  maxIter = 100,
  tol = 1e-10,
): void {
  const { positions, velocities } = state;
  const [lx, ly, lz] = box.lengths;
  const periodic = box.boundary === "periodic";

  for (let iter = 0; iter < maxIter; iter++) {
    let done = true;
    for (let k = 0; k < c.i.length; k++) {
      const i = c.i[k];
      const j = c.j[k];
      const d0 = c.d0[k];
      const sx = mi(positions[3 * i] - positions[3 * j], lx, periodic);
      const sy = mi(positions[3 * i + 1] - positions[3 * j + 1], ly, periodic);
      const sz = mi(positions[3 * i + 2] - positions[3 * j + 2], lz, periodic);
      const s2 = sx * sx + sy * sy + sz * sz;
      const diff = d0 * d0 - s2;
      if (Math.abs(diff) <= tol) continue;
      done = false;

      const rx = mi(ref[3 * i] - ref[3 * j], lx, periodic);
      const ry = mi(ref[3 * i + 1] - ref[3 * j + 1], ly, periodic);
      const rz = mi(ref[3 * i + 2] - ref[3 * j + 2], lz, periodic);
      const rs = rx * sx + ry * sy + rz * sz;
      const invI = invMass[i];
      const invJ = invMass[j];
      const g = diff / (2 * (invI + invJ) * rs);

      positions[3 * i] += invI * g * rx;
      positions[3 * i + 1] += invI * g * ry;
      positions[3 * i + 2] += invI * g * rz;
      positions[3 * j] -= invJ * g * rx;
      positions[3 * j + 1] -= invJ * g * ry;
      positions[3 * j + 2] -= invJ * g * rz;

      const gdt = g / dt;
      velocities[3 * i] += invI * gdt * rx;
      velocities[3 * i + 1] += invI * gdt * ry;
      velocities[3 * i + 2] += invI * gdt * rz;
      velocities[3 * j] -= invJ * gdt * rx;
      velocities[3 * j + 1] -= invJ * gdt * ry;
      velocities[3 * j + 2] -= invJ * gdt * rz;
    }
    if (done) break;
  }
}

/** RATTLE — remove the velocity component along each constraint (rigid-body velocities). */
export function rattle(
  state: SimState,
  c: DistanceConstraints,
  invMass: Float64Array,
  box: Box,
  maxIter = 100,
  tol = 1e-10,
): void {
  const { positions, velocities } = state;
  const [lx, ly, lz] = box.lengths;
  const periodic = box.boundary === "periodic";

  for (let iter = 0; iter < maxIter; iter++) {
    let done = true;
    for (let k = 0; k < c.i.length; k++) {
      const i = c.i[k];
      const j = c.j[k];
      const rx = mi(positions[3 * i] - positions[3 * j], lx, periodic);
      const ry = mi(positions[3 * i + 1] - positions[3 * j + 1], ly, periodic);
      const rz = mi(positions[3 * i + 2] - positions[3 * j + 2], lz, periodic);
      const vx = velocities[3 * i] - velocities[3 * j];
      const vy = velocities[3 * i + 1] - velocities[3 * j + 1];
      const vz = velocities[3 * i + 2] - velocities[3 * j + 2];
      const rv = rx * vx + ry * vy + rz * vz;
      const r2 = rx * rx + ry * ry + rz * rz;
      if (Math.abs(rv) <= tol) continue;
      done = false;

      const invI = invMass[i];
      const invJ = invMass[j];
      const kf = -rv / ((invI + invJ) * r2);
      velocities[3 * i] += invI * kf * rx;
      velocities[3 * i + 1] += invI * kf * ry;
      velocities[3 * i + 2] += invI * kf * rz;
      velocities[3 * j] -= invJ * kf * rx;
      velocities[3 * j + 1] -= invJ * kf * ry;
      velocities[3 * j + 2] -= invJ * kf * rz;
    }
    if (done) break;
  }
}
