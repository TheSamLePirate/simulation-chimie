import type { Box, ForceModel, ForceResult, SimState, Species } from "../types";

const CUTOFF_FACTOR = 2.5;

/**
 * L2 Lennard-Jones with **linked-cell (cell-list) O(N) neighbour search** — the
 * performance path for large particle counts. Physics is identical to the O(N²)
 * {@link LennardJonesForce} (shifted-force at 2.5σ, Lorentz-Berthelot mixing); only
 * the neighbour enumeration changes. Falls back to the brute O(N²) loop when the cell
 * grid would have fewer than 3 cells per axis (small box / large cutoff).
 */
export class LennardJonesCellForce implements ForceModel {
  readonly name = "Lennard-Jones (cell-list O(N))";

  constructor(private readonly crossScale = 1) {}

  compute(state: SimState, box: Box, species: readonly Species[]): ForceResult {
    const { count, positions, forces, typeIds } = state;
    forces.fill(0);
    if (count < 2) return { potentialEnergy: 0, virial: 0 };

    const [lx, ly, lz] = box.lengths;
    const periodic = box.boundary === "periodic";

    let maxSigma = 0;
    for (const s of species) maxSigma = Math.max(maxSigma, s.sigma);
    const rcMax = CUTOFF_FACTOR * maxSigma;

    const ncx = Math.floor(lx / rcMax);
    const ncy = Math.floor(ly / rcMax);
    const ncz = Math.floor(lz / rcMax);
    if (ncx < 3 || ncy < 3 || ncz < 3) {
      return this.computeBrute(state, box, species);
    }

    // Build the linked-cell lists.
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
      const cx = clamp(Math.floor((positions[3 * i] + lx / 2) / csx), ncx);
      const cy = clamp(Math.floor((positions[3 * i + 1] + ly / 2) / csy), ncy);
      const cz = clamp(Math.floor((positions[3 * i + 2] + lz / 2) / csz), ncz);
      cellX[i] = cx;
      cellY[i] = cy;
      cellZ[i] = cz;
      const c = cx + ncx * (cy + ncy * cz);
      next[i] = head[c];
      head[c] = i;
    }

    let potentialEnergy = 0;
    let virial = 0;

    for (let i = 0; i < count; i++) {
      const ix = positions[3 * i];
      const iy = positions[3 * i + 1];
      const iz = positions[3 * i + 2];
      const si = species[typeIds[i]];
      const cx = cellX[i];
      const cy = cellY[i];
      const cz = cellZ[i];

      for (let dz = -1; dz <= 1; dz++) {
        const nz = wrapCell(cz + dz, ncz, periodic);
        if (nz < 0) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = wrapCell(cy + dy, ncy, periodic);
          if (ny < 0) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = wrapCell(cx + dx, ncx, periodic);
            if (nx < 0) continue;
            const ncellIndex = nx + ncx * (ny + ncy * nz);

            for (let j = head[ncellIndex]; j !== -1; j = next[j]) {
              if (j <= i) continue;

              let ddx = ix - positions[3 * j];
              let ddy = iy - positions[3 * j + 1];
              let ddz = iz - positions[3 * j + 2];
              if (periodic) {
                ddx -= lx * Math.round(ddx / lx);
                ddy -= ly * Math.round(ddy / ly);
                ddz -= lz * Math.round(ddz / lz);
              }
              const r2 = ddx * ddx + ddy * ddy + ddz * ddz;

              const sj = species[typeIds[j]];
              const sigma = 0.5 * (si.sigma + sj.sigma);
              const mix = typeIds[i] === typeIds[j] ? 1 : this.crossScale;
              const epsilon = Math.sqrt(si.epsilon * sj.epsilon) * mix;
              const rc = CUTOFF_FACTOR * sigma;
              if (r2 >= rc * rc || r2 < 1e-12) continue;

              const r = Math.sqrt(r2);
              const sigma2 = sigma * sigma;
              const inv2 = sigma2 / r2;
              const inv6 = inv2 * inv2 * inv2;
              const inv12 = inv6 * inv6;
              const c2 = sigma2 / (rc * rc);
              const c6 = c2 * c2 * c2;
              const c12 = c6 * c6;
              const fAtRc = (24 * epsilon * (2 * c12 - c6)) / rc;
              const vAtRc = 4 * epsilon * (c12 - c6);
              const fRadial = (24 * epsilon * (2 * inv12 - inv6)) / r;
              const fOverR = (fRadial - fAtRc) / r;

              potentialEnergy += 4 * epsilon * (inv12 - inv6) - vAtRc + (r - rc) * fAtRc;
              forces[3 * i] += fOverR * ddx;
              forces[3 * i + 1] += fOverR * ddy;
              forces[3 * i + 2] += fOverR * ddz;
              forces[3 * j] -= fOverR * ddx;
              forces[3 * j + 1] -= fOverR * ddy;
              forces[3 * j + 2] -= fOverR * ddz;
              virial += fOverR * r2;
            }
          }
        }
      }
    }

    return { potentialEnergy, virial };
  }

  /** Brute O(N²) fallback (identical physics) for boxes too small to grid. */
  private computeBrute(state: SimState, box: Box, species: readonly Species[]): ForceResult {
    const { count, positions, forces, typeIds } = state;
    const [lx, ly, lz] = box.lengths;
    const periodic = box.boundary === "periodic";
    let potentialEnergy = 0;
    let virial = 0;

    for (let i = 0; i < count; i++) {
      const si = species[typeIds[i]];
      for (let j = i + 1; j < count; j++) {
        let ddx = positions[3 * i] - positions[3 * j];
        let ddy = positions[3 * i + 1] - positions[3 * j + 1];
        let ddz = positions[3 * i + 2] - positions[3 * j + 2];
        if (periodic) {
          ddx -= lx * Math.round(ddx / lx);
          ddy -= ly * Math.round(ddy / ly);
          ddz -= lz * Math.round(ddz / lz);
        }
        const r2 = ddx * ddx + ddy * ddy + ddz * ddz;
        const sj = species[typeIds[j]];
        const sigma = 0.5 * (si.sigma + sj.sigma);
        const mix = typeIds[i] === typeIds[j] ? 1 : this.crossScale;
        const epsilon = Math.sqrt(si.epsilon * sj.epsilon) * mix;
        const rc = CUTOFF_FACTOR * sigma;
        if (r2 >= rc * rc || r2 < 1e-12) continue;

        const r = Math.sqrt(r2);
        const sigma2 = sigma * sigma;
        const inv2 = sigma2 / r2;
        const inv6 = inv2 * inv2 * inv2;
        const inv12 = inv6 * inv6;
        const c2 = sigma2 / (rc * rc);
        const c6 = c2 * c2 * c2;
        const c12 = c6 * c6;
        const fAtRc = (24 * epsilon * (2 * c12 - c6)) / rc;
        const vAtRc = 4 * epsilon * (c12 - c6);
        const fRadial = (24 * epsilon * (2 * inv12 - inv6)) / r;
        const fOverR = (fRadial - fAtRc) / r;

        potentialEnergy += 4 * epsilon * (inv12 - inv6) - vAtRc + (r - rc) * fAtRc;
        forces[3 * i] += fOverR * ddx;
        forces[3 * i + 1] += fOverR * ddy;
        forces[3 * i + 2] += fOverR * ddz;
        forces[3 * j] -= fOverR * ddx;
        forces[3 * j + 1] -= fOverR * ddy;
        forces[3 * j + 2] -= fOverR * ddz;
        virial += fOverR * r2;
      }
    }
    return { potentialEnergy, virial };
  }
}

function clamp(c: number, n: number): number {
  return c < 0 ? 0 : c >= n ? n - 1 : c;
}

/** Wrap a cell index for periodic boundaries; returns -1 to skip for reflective. */
function wrapCell(c: number, n: number, periodic: boolean): number {
  if (c >= 0 && c < n) return c;
  if (!periodic) return -1;
  return ((c % n) + n) % n;
}
