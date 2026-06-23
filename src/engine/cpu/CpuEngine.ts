import { createBox, volume } from "../../core/box";
import { LennardJonesForce } from "../../core/forces/lennardJones";
import { NoForce } from "../../core/forces/none";
import { WcaForce } from "../../core/forces/wca";
import { placeOnLattice, setMaxwellBoltzmannVelocities } from "../../core/init";
import { velocityVerletStep } from "../../core/integrators/velocityVerlet";
import { kineticEnergy, pressure, temperature } from "../../core/observables";
import { Rng } from "../../core/rng";
import { SPECIES_LIBRARY } from "../../core/species";
import { createState } from "../../core/state";
import type { Box, ForceModel, ForceResult, SimState, Species } from "../../core/types";
import { pressureToBar } from "../../core/units";
import type { AccuracyLevel, Observables, SimConfig, SimulationEngine } from "../types";

function resolveSpecies(name: string): Species {
  const key = name.toUpperCase() as keyof typeof SPECIES_LIBRARY;
  return SPECIES_LIBRARY[key] ?? SPECIES_LIBRARY.ARGON;
}

function makeForceModel(level: AccuracyLevel): ForceModel {
  switch (level) {
    case "L0":
      return NoForce;
    case "L1":
      return new WcaForce();
    case "L2":
      return new LennardJonesForce();
  }
}

/**
 * CPU reference engine: the deterministic correctness oracle for the whole project.
 * Float64 throughout for clean energy conservation. Intentionally simple (O(N²) forces)
 * — the GPU engine (P2) is the performance path; this one is the source of truth.
 */
export class CpuEngine implements SimulationEngine {
  config: SimConfig;
  state: SimState;
  box: Box;
  species: readonly Species[];

  private force: ForceModel;
  private last: ForceResult = { potentialEnergy: 0, virial: 0 };
  private stepCount = 0;
  private elapsed = 0;

  constructor(config: SimConfig) {
    this.config = config;
    this.box = createBox(config.boxLength, config.boundary);
    this.species = [resolveSpecies(config.speciesName)];
    this.state = createState(config.particleCount);
    this.force = makeForceModel(config.level);
    this.initialise();
  }

  private initialise(): void {
    const rng = new Rng(this.config.seed);
    placeOnLattice(this.state, this.box, { jitter: 0.05, rng });
    setMaxwellBoltzmannVelocities(this.state, this.species, this.config.temperature, rng);
    this.last = this.force.compute(this.state, this.box, this.species);
    this.stepCount = 0;
    this.elapsed = 0;
  }

  step(steps: number): void {
    const dt = this.config.timestep;
    for (let i = 0; i < steps; i++) {
      this.last = velocityVerletStep(this.state, this.box, this.species, this.force, dt);
      this.elapsed += dt;
      this.stepCount += 1;
    }
  }

  observables(): Observables {
    const ke = kineticEnergy(this.state, this.species);
    const pe = this.last.potentialEnergy;
    const pInternal = pressure(ke, this.last.virial, volume(this.box));
    return {
      step: this.stepCount,
      time: this.elapsed,
      kineticEnergy: ke,
      potentialEnergy: pe,
      totalEnergy: ke + pe,
      temperature: temperature(this.state, this.species, true),
      pressure: pressureToBar(pInternal),
    };
  }

  /** Change the accuracy level in place (swap force model, recompute forces). */
  setLevel(level: AccuracyLevel): void {
    this.config = { ...this.config, level };
    this.force = makeForceModel(level);
    this.last = this.force.compute(this.state, this.box, this.species);
  }

  /** Update the integration timestep (ps) without disturbing the trajectory. */
  setTimestep(timestep: number): void {
    this.config = { ...this.config, timestep };
  }

  /** Rescale velocities so the kinetic temperature becomes `targetK` (a manual thermostat kick). */
  rescaleToTemperature(targetK: number): void {
    const current = temperature(this.state, this.species, true);
    if (current > 0 && targetK > 0) {
      const factor = Math.sqrt(targetK / current);
      const v = this.state.velocities;
      for (let i = 0; i < v.length; i++) v[i] *= factor;
    }
    this.config = { ...this.config, temperature: targetK };
  }

  reset(patch: Partial<SimConfig> = {}): void {
    this.config = { ...this.config, ...patch };
    this.box = createBox(this.config.boxLength, this.config.boundary);
    this.species = [resolveSpecies(this.config.speciesName)];
    this.state = createState(this.config.particleCount);
    this.force = makeForceModel(this.config.level);
    this.initialise();
  }
}
