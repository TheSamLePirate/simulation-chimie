import type { Vec3 } from "../types";

/** Small pure helpers for 3-vectors held as readonly tuples (used in tests/observables). */

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function lengthSquared(a: Vec3): number {
  return dot(a, a);
}

export function length(a: Vec3): number {
  return Math.sqrt(lengthSquared(a));
}
