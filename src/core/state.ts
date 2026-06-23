import type { SimState } from "./types";

/** Allocate a zeroed SoA simulation state for `count` particles (all species 0 by default). */
export function createState(
  count: number,
  typeIds?: Uint8Array,
  moleculeId?: Int32Array,
): SimState {
  if (count < 0 || !Number.isInteger(count)) {
    throw new Error(`createState: count must be a non-negative integer, got ${count}`);
  }
  const ids = typeIds ?? new Uint8Array(count);
  if (ids.length !== count) {
    throw new Error(`createState: typeIds length ${ids.length} != count ${count}`);
  }
  // Default: each atom is its own molecule ⇒ no non-bonded exclusions.
  const mol = moleculeId ?? Int32Array.from({ length: count }, (_, i) => i);
  if (mol.length !== count) {
    throw new Error(`createState: moleculeId length ${mol.length} != count ${count}`);
  }
  return {
    count,
    positions: new Float64Array(count * 3),
    velocities: new Float64Array(count * 3),
    forces: new Float64Array(count * 3),
    typeIds: ids,
    moleculeId: mol,
  };
}

/** Deep copy of a state (independent typed-array buffers). */
export function cloneState(state: SimState): SimState {
  return {
    count: state.count,
    positions: state.positions.slice(),
    velocities: state.velocities.slice(),
    forces: state.forces.slice(),
    typeIds: state.typeIds.slice(),
    moleculeId: state.moleculeId.slice(),
  };
}
