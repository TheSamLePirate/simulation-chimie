import { createBox, volume } from "../../core/box";
import { IonicForce } from "../../core/forces/ionic";
import { LennardJonesCellForce } from "../../core/forces/lennardJonesCell";
import { NoForce } from "../../core/forces/none";
import { WaterForce } from "../../core/forces/water";
import { WcaForce } from "../../core/forces/wca";
import { placeOnLattice, setMaxwellBoltzmannVelocities } from "../../core/init";
import { velocityVerletStep } from "../../core/integrators/velocityVerlet";
import { kineticEnergy, pressure, temperature } from "../../core/observables";
import { Rng } from "../../core/rng";
import { SPECIES_LIBRARY } from "../../core/species";
import { createState } from "../../core/state";
import { berendsenLambda, csvrLambda } from "../../core/thermostats";
import type { Box, ForceModel, ForceResult, SimState, Species } from "../../core/types";
import { BAR_PER_KJ_PER_MOL_NM3, BOLTZMANN_KJ_PER_MOL_K, pressureToBar } from "../../core/units";
import { buildWaterSystem } from "../../core/water";
import type { AccuracyLevel, Observables, SimConfig, SimulationEngine } from "../types";

function resolveSpecies(name: string): Species {
  const key = name.toUpperCase() as keyof typeof SPECIES_LIBRARY;
  return SPECIES_LIBRARY[key] ?? SPECIES_LIBRARY.ARGON;
}

function makeForceModel(level: AccuracyLevel, crossScale: number): ForceModel {
  switch (level) {
    case "L0":
      return NoForce;
    case "L1":
      return new WcaForce();
    case "L2":
      return new LennardJonesCellForce(crossScale);
    case "L3":
      return new IonicForce();
    case "L4":
      // Atomistic water needs topology; it is built in CpuEngine.configure().
      throw new Error("L4 (water) force is built in configure()");
  }
}

/** Assign particle species: type 1 to a `fraction` of particles (seeded), else type 0. */
function buildTypeIds(count: number, fraction: number, seed: number): Uint8Array {
  const ids = new Uint8Array(count);
  if (fraction > 0) {
    const rng = new Rng(seed ^ 0x5bd1e995);
    for (let i = 0; i < count; i++) ids[i] = rng.next() < fraction ? 1 : 0;
  }
  return ids;
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
  private thermostatRng = new Rng(1);

  constructor(config: SimConfig) {
    this.config = config;
    // Definite-assignment via configure(); fields are set there.
    this.box = createBox(config.boxLength, config.boundary);
    this.species = [];
    this.state = createState(0);
    this.force = NoForce;
    this.configure();
  }

  /** (Re)build box, species, state and force model from the current config. */
  private configure(): void {
    const c = this.config;
    this.box = createBox(c.boxLength, c.boundary);

    // L4 — atomistic water: build the molecular system (O+2H per molecule) + topology.
    if (c.level === "L4") {
      const rng = new Rng(c.seed);
      const sys = buildWaterSystem(c.particleCount, this.box, c.temperature, rng);
      this.state = sys.state;
      this.species = sys.species;
      this.force = new WaterForce(sys.topology);
      this.thermostatRng = new Rng(c.seed ^ 0x2c1b3c6d);
      this.last = this.force.compute(this.state, this.box, this.species);
      this.stepCount = 0;
      this.elapsed = 0;
      return;
    }

    this.species = c.secondSpeciesName
      ? [resolveSpecies(c.speciesName), resolveSpecies(c.secondSpeciesName)]
      : [resolveSpecies(c.speciesName)];
    const fraction = c.secondSpeciesName ? c.fractionSecond : 0;
    this.state = createState(c.particleCount, buildTypeIds(c.particleCount, fraction, c.seed));
    this.force = makeForceModel(c.level, c.crossScale);
    this.initialise();
  }

  private initialise(): void {
    const rng = new Rng(this.config.seed);
    placeOnLattice(this.state, this.box, { jitter: 0.05, rng });
    setMaxwellBoltzmannVelocities(this.state, this.species, this.config.temperature, rng);
    this.thermostatRng = new Rng(this.config.seed ^ 0x2c1b3c6d);
    this.last = this.force.compute(this.state, this.box, this.species);
    this.stepCount = 0;
    this.elapsed = 0;
  }

  step(steps: number): void {
    const dt = this.config.timestep;
    for (let i = 0; i < steps; i++) {
      this.last = velocityVerletStep(this.state, this.box, this.species, this.force, dt);
      this.applyThermostat(dt);
      this.applyBarostat(dt);
      this.elapsed += dt;
      this.stepCount += 1;
    }
  }

  /** Berendsen barostat (NPT): rescale the cell + positions toward the target pressure. */
  private applyBarostat(dt: number): void {
    if (this.config.barostat === "none") return;
    const ke = kineticEnergy(this.state, this.species);
    const pInternal = pressure(ke, this.last.virial, volume(this.box));
    const pTarget = this.config.pressureTarget / BAR_PER_KJ_PER_MOL_NM3;

    const tauP = 1.0; // ps
    const beta = 0.0005; // soft isothermal compressibility (nm³·mol·kJ⁻¹)
    let mu = Math.cbrt(1 + (dt / tauP) * beta * (pInternal - pTarget));
    mu = Math.min(1.0005, Math.max(0.9995, mu)); // gentle per-step clamp

    const newL = this.box.lengths[0] * mu;
    this.box = createBox(newL, this.config.boundary);
    this.config = { ...this.config, boxLength: newL };
    const p = this.state.positions;
    for (let k = 0; k < p.length; k++) p[k] *= mu;
  }

  /** Couple to the heat bath (NVT) by rescaling velocities. No-op for NVE. */
  private applyThermostat(dt: number): void {
    const kind = this.config.thermostat;
    if (kind === "none") return;
    const dof = 3 * this.state.count - 3;
    if (dof < 1) return;

    const ke = kineticEnergy(this.state, this.species);
    let lambda: number;
    if (kind === "berendsen") {
      const currentT = (2 * ke) / (dof * BOLTZMANN_KJ_PER_MOL_K);
      lambda = berendsenLambda(currentT, this.config.temperature, dt, this.config.thermostatTau);
    } else {
      const targetKE = 0.5 * dof * BOLTZMANN_KJ_PER_MOL_K * this.config.temperature;
      lambda = csvrLambda(ke, targetKE, dof, dt, this.config.thermostatTau, this.thermostatRng);
    }

    const v = this.state.velocities;
    for (let k = 0; k < v.length; k++) v[k] *= lambda;
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
    // L4 (water) changes topology/atom count ⇒ full rebuild rather than a force swap.
    if (level === "L4") {
      this.configure();
      return;
    }
    this.force = makeForceModel(level, this.config.crossScale);
    this.last = this.force.compute(this.state, this.box, this.species);
  }

  /** Update the integration timestep (ps) without disturbing the trajectory. */
  setTimestep(timestep: number): void {
    this.config = { ...this.config, timestep };
  }

  /**
   * Set the target temperature. With NVE (no thermostat) this is an instantaneous
   * velocity rescale; with a thermostat it just updates the bath target.
   */
  rescaleToTemperature(targetK: number): void {
    this.config = { ...this.config, temperature: targetK };
    if (this.config.thermostat !== "none") return;
    const current = temperature(this.state, this.species, true);
    if (current > 0 && targetK > 0) {
      const factor = Math.sqrt(targetK / current);
      const v = this.state.velocities;
      for (let i = 0; i < v.length; i++) v[i] *= factor;
    }
  }

  /** Switch thermostat / coupling time in place. */
  setThermostat(thermostat: SimConfig["thermostat"], tau: number): void {
    this.config = { ...this.config, thermostat, thermostatTau: tau };
  }

  /** Switch barostat / target pressure (bar) in place. */
  setBarostat(barostat: SimConfig["barostat"], pressureTarget: number): void {
    this.config = { ...this.config, barostat, pressureTarget };
  }

  /** Overwrite the live state from a snapshot (sizes must match the config). */
  loadState(
    positions: ArrayLike<number>,
    velocities: ArrayLike<number>,
    typeIds: ArrayLike<number>,
    step: number,
    time: number,
  ): void {
    this.state.positions.set(positions);
    this.state.velocities.set(velocities);
    this.state.typeIds.set(typeIds);
    this.stepCount = step;
    this.elapsed = time;
    this.last = this.force.compute(this.state, this.box, this.species);
  }

  reset(patch: Partial<SimConfig> = {}): void {
    this.config = { ...this.config, ...patch };
    this.configure();
  }
}
