import type { SimState } from "./types";

/** Allocate a zeroed SoA simulation state for `count` particles (all species 0 by default). */
export function createState(count: number, typeIds?: Uint8Array): SimState {
  if (count < 0 || !Number.isInteger(count)) {
    throw new Error(`createState: count must be a non-negative integer, got ${count}`);
  }
  const ids = typeIds ?? new Uint8Array(count);
  if (ids.length !== count) {
    throw new Error(`createState: typeIds length ${ids.length} != count ${count}`);
  }
  return {
    count,
    positions: new Float64Array(count * 3),
    velocities: new Float64Array(count * 3),
    forces: new Float64Array(count * 3),
    typeIds: ids,
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
  };
}
