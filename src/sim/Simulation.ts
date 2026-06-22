import { CpuEngine } from "../engine/cpu/CpuEngine";
import type { Observables, SimConfig } from "../engine/types";

/** Config keys that require a full engine rebuild (topology / initial conditions change). */
const STRUCTURAL_KEYS: ReadonlyArray<keyof SimConfig> = [
  "particleCount",
  "boxLength",
  "boundary",
  "seed",
  "speciesName",
];

/**
 * Playback controller around a {@link CpuEngine}. Lives outside React so the hot
 * loop never touches the component tree; the UI talks to it through the store, and
 * the renderer reads particle positions from it each frame.
 */
export class Simulation {
  private engine: CpuEngine;
  playing = false;
  /** Integration steps advanced per rendered frame. */
  substeps = 5;

  private structuralListeners = new Set<() => void>();

  constructor(config: SimConfig) {
    this.engine = new CpuEngine(config);
  }

  get config(): SimConfig {
    return this.engine.config;
  }
  get state() {
    return this.engine.state;
  }
  get box() {
    return this.engine.box;
  }
  get species() {
    return this.engine.species;
  }

  observables(): Observables {
    return this.engine.observables();
  }

  /** Apply a config patch, choosing the cheapest valid path (live tweak vs rebuild). */
  patch(patch: Partial<SimConfig>): void {
    const structural = STRUCTURAL_KEYS.some(
      (key) => patch[key] !== undefined && patch[key] !== this.engine.config[key],
    );

    if (structural) {
      this.engine.reset(patch);
      this.emitStructural();
      return;
    }

    if (patch.level !== undefined) this.engine.setLevel(patch.level);
    if (patch.timestep !== undefined) this.engine.setTimestep(patch.timestep);
    if (patch.temperature !== undefined) this.engine.rescaleToTemperature(patch.temperature);
  }

  /** Re-initialise from the current config (same seed ⇒ identical run). */
  reset(): void {
    this.engine.reset();
    this.emitStructural();
  }

  /** Advance exactly one frame's worth of steps, regardless of play state. */
  stepFrame(steps = this.substeps): void {
    this.engine.step(steps);
  }

  /** Called every render frame; advances only while playing. */
  advance(): void {
    if (this.playing) this.engine.step(this.substeps);
  }

  /** Subscribe to rebuilds (particle count / box changes). Returns an unsubscribe fn. */
  onStructuralChange(listener: () => void): () => void {
    this.structuralListeners.add(listener);
    return () => this.structuralListeners.delete(listener);
  }

  private emitStructural(): void {
    for (const listener of this.structuralListeners) listener();
  }
}
