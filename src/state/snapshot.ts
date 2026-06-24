import { CpuEngine } from "../engine/cpu/CpuEngine";
import type { SimConfig } from "../engine/types";
import type { Snapshot } from "./schema";

/** Capture a full, restorable snapshot of a CPU engine (config + serialised state). */
export function captureSnapshot(engine: CpuEngine): Snapshot {
  const o = engine.observables();
  return {
    version: 1,
    config: engine.config,
    step: o.step,
    time: o.time,
    positions: Array.from(engine.state.positions),
    velocities: Array.from(engine.state.velocities),
    typeIds: Array.from(engine.state.typeIds),
  };
}

/** Rebuild a CPU engine from a snapshot and restore its exact state. */
export function restoreSnapshot(snapshot: Snapshot): CpuEngine {
  const engine = new CpuEngine(snapshot.config as SimConfig);
  engine.loadState(
    snapshot.positions,
    snapshot.velocities,
    snapshot.typeIds,
    snapshot.step,
    snapshot.time,
  );
  return engine;
}
