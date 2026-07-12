import type { Box, SimState } from "./types";

/** Callback for a candidate neighbour pair (i<j) with its minimum-image separation. */
export type PairFn = (i: number, j: number, dx: number, dy: number, dz: number, r2: number) => void;

function clampCell(c: number, n: number): number {
  return c < 0 ? 0 : c >= n ? n - 1 : c;
}

function wrapCell(c: number, n: number, periodic: boolean): number {
  if (c >= 0 && c < n) return c;
  if (!periodic) return -1;
  return ((c % n) + n) % n;
}

/**
 * Linked-cell O(N) neighbour search: invokes `fn` once for every unordered pair (i<j) whose
 * minimum-image distance is below `cutoff`. Falls back to the brute O(N²) loop when the grid
 * would have < 3 cells on any axis (small box / large cutoff). The caller applies its own
 * finer per-interaction cutoffs and exclusions inside `fn`.
 */
export function forEachNeighborPair(state: SimState, box: Box, cutoff: number, fn: PairFn): void {
  forEachPositionNeighborPair(state.count, state.positions, box, cutoff, fn);
}

/** Linked-cell search over a bare xyz buffer, used by virtual charge-site force models. */
export function forEachPositionNeighborPair(
  count: number,
  positions: ArrayLike<number>,
  box: Box,
  cutoff: number,
  fn: PairFn,
): void {
  if (count < 2) return;
  if (!(cutoff > 0)) throw new RangeError("neighbor cutoff must be positive");
  const [lx, ly, lz] = box.lengths;
  const periodic = box.boundary === "periodic";
  const rc2 = cutoff * cutoff;

  const ncx = Math.max(1, Math.floor(lx / cutoff));
  const ncy = Math.max(1, Math.floor(ly / cutoff));
  const ncz = Math.max(1, Math.floor(lz / cutoff));

  const mi = (d: number, l: number) => (periodic ? d - l * Math.round(d / l) : d);

  const ncell = ncx * ncy * ncz;
  const head = new Int32Array(ncell).fill(-1);
  const next = new Int32Array(count).fill(-1);
  const csx = lx / ncx;
  const csy = ly / ncy;
  const csz = lz / ncz;
  const cellX = new Int32Array(count);
  const cellY = new Int32Array(count);
  const cellZ = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const cx = clampCell(Math.floor((positions[3 * i] + lx / 2) / csx), ncx);
    const cy = clampCell(Math.floor((positions[3 * i + 1] + ly / 2) / csy), ncy);
    const cz = clampCell(Math.floor((positions[3 * i + 2] + lz / 2) / csz), ncz);
    cellX[i] = cx;
    cellY[i] = cy;
    cellZ[i] = cz;
    const c = cx + ncx * (cy + ncy * cz);
    next[i] = head[c];
    head[c] = i;
  }

  for (let i = 0; i < count; i++) {
    const ix = positions[3 * i];
    const iy = positions[3 * i + 1];
    const iz = positions[3 * i + 2];
    const cx = cellX[i];
    const cy = cellY[i];
    const cz = cellZ[i];
    // With one or two cells on an axis, periodic offsets alias the same cell. Build a
    // unique local list so every particle pair is still visited exactly once.
    const neighborCells: number[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      const nz = wrapCell(cz + dz, ncz, periodic);
      if (nz < 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = wrapCell(cy + dy, ncy, periodic);
        if (ny < 0) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = wrapCell(cx + dx, ncx, periodic);
          if (nx < 0) continue;
          const nc = nx + ncx * (ny + ncy * nz);
          if (!neighborCells.includes(nc)) neighborCells.push(nc);
        }
      }
    }
    for (const nc of neighborCells) {
      for (let j = head[nc]; j !== -1; j = next[j]) {
        if (j <= i) continue;
        const ddx = mi(ix - positions[3 * j], lx);
        const ddy = mi(iy - positions[3 * j + 1], ly);
        const ddz = mi(iz - positions[3 * j + 2], lz);
        const r2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (r2 < rc2 && r2 > 1e-12) fn(i, j, ddx, ddy, ddz, r2);
      }
    }
  }
}
