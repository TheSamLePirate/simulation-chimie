import type { BoundaryKind, Box, Vec3 } from "./types";

/** Build a cubic cell of side `length` (nm), centred on the origin, spanning [−L/2, L/2). */
export function createBox(length: number, boundary: BoundaryKind = "periodic"): Box {
  const lengths: Vec3 = [length, length, length];
  return { lengths, boundary };
}

/** Build a (possibly non-cubic) cell with explicit per-axis lengths (nm). */
export function createBoxXYZ(
  lx: number,
  ly: number,
  lz: number,
  boundary: BoundaryKind = "periodic",
): Box {
  return { lengths: [lx, ly, lz], boundary };
}

export function volume(box: Box): number {
  return box.lengths[0] * box.lengths[1] * box.lengths[2];
}

/**
 * Minimum-image displacement along one axis: maps `dx` into [−L/2, L/2).
 * Only meaningful for periodic boundaries.
 */
export function minimumImage(dx: number, length: number): number {
  return dx - length * Math.round(dx / length);
}

/** Wrap a single coordinate back into the centred cell [−L/2, L/2). */
export function wrapCoordinate(x: number, length: number): number {
  return x - length * Math.round(x / length);
}
