import { applyBoundary } from "../boundary";
import { createBoxXYZ } from "../box";
import { rattle, shake } from "../constraints";
import { Tip4p2005EwaldForce } from "../forces/tip4p2005Ewald";
import { kineticEnergy } from "../observables";
import { type DensityProfile, massDensityProfileZ } from "../observables/densityProfile";
import { surfaceTensionToMilliNewtonPerMeter } from "../observables/tensor";
import {
  type BlockedTestAreaEstimate,
  blockTestAreaSurfaceTension,
  evaluateTestAreaSample,
  type TestAreaSample,
} from "../observables/testArea";
import { Rng } from "../rng";
import { csvrLambda } from "../thermostats";
import { buildTip4p2005Slab } from "../tip4p2005";
import type { Box, ForceResult, SimState, Species } from "../types";
import { BOLTZMANN_KJ_PER_MOL_K } from "../units";

export interface SurfaceTensionExperimentConfig {
  readonly molecules: number;
  readonly box: readonly [number, number, number];
  readonly temperatureK: number;
  readonly targetDensityKgPerM3: number;
  readonly seed: number;
  readonly timestepPs: number;
  readonly thermostatTauPs: number;
  readonly alphaNmInverse: number;
  readonly pmeGrid: readonly [number, number, number];
  readonly densityBins: number;
}

export const REFERENCE_SURFACE_TENSION_CONFIG: SurfaceTensionExperimentConfig = {
  molecules: 1024,
  box: [3.2, 3.2, 10],
  temperatureK: 300,
  targetDensityKgPerM3: 997,
  seed: 20250713,
  timestepPs: 0.002,
  thermostatTauPs: 1,
  alphaNmInverse: 3.5,
  pmeGrid: [64, 64, 256],
  densityBins: 100,
};

export interface SurfaceTensionInstantaneous {
  readonly step: number;
  readonly timePs: number;
  readonly temperatureK: number;
  readonly kineticEnergy: number;
  readonly potentialEnergy: number;
  readonly totalEnergy: number;
}

export interface SurfaceTensionAnalysis {
  readonly densityProfile: DensityProfile;
  readonly liquidThickness: number;
  readonly sampleCount: number;
  readonly gammaMilliNewtonPerMeter: number | null;
  readonly standardErrorMilliNewtonPerMeter: number | null;
}

/** Deterministic CPU oracle runner for short L11 validations and golden-state generation. */
export class SurfaceTensionExperiment {
  readonly config: SurfaceTensionExperimentConfig;
  readonly box: Box;
  readonly state: SimState;
  readonly species: readonly Species[];
  readonly renderBonds: { readonly i: Int32Array; readonly j: Int32Array };
  readonly liquidThickness: number;
  readonly testAreaSamples: TestAreaSample[] = [];

  private readonly force: Tip4p2005EwaldForce;
  private readonly constraints;
  private readonly inverseMass: Float64Array;
  private readonly referencePositions: Float64Array;
  private readonly thermostatRng: Rng;
  private last: ForceResult;
  private stepCount = 0;
  private elapsedPs = 0;
  private targetTemperatureK: number;
  private timestepPs: number;

  constructor(config: SurfaceTensionExperimentConfig = REFERENCE_SURFACE_TENSION_CONFIG) {
    this.config = config;
    this.box = createBoxXYZ(...config.box, "periodic");
    const system = buildTip4p2005Slab(
      config.molecules,
      this.box,
      config.temperatureK,
      new Rng(config.seed),
      config.targetDensityKgPerM3,
    );
    this.state = system.state;
    this.species = system.species;
    this.constraints = system.constraints;
    this.renderBonds = system.renderBonds;
    this.liquidThickness = system.liquidThickness;
    this.targetTemperatureK = config.temperatureK;
    this.timestepPs = config.timestepPs;
    this.inverseMass = new Float64Array(this.state.count);
    for (let atom = 0; atom < this.state.count; atom++) {
      this.inverseMass[atom] = 1 / this.species[this.state.typeIds[atom]].mass;
    }
    this.referencePositions = new Float64Array(this.state.positions.length);
    this.thermostatRng = new Rng(config.seed ^ 0x6a09e667);
    // Project random atomic velocities onto the rigid tangent space, then restore the
    // requested temperature using the correct 6N−3 rigid-water degrees of freedom.
    rattle(this.state, this.constraints, this.inverseMass, this.box);
    this.rescaleToTargetTemperature();
    this.force = new Tip4p2005EwaldForce({
      alpha: config.alphaNmInverse,
      pmeGrid: config.pmeGrid,
      slabCorrection: true,
      dispersionTailBins: config.densityBins,
    });
    this.last = this.force.compute(this.state, this.box, this.species);
  }

  private degreesOfFreedom(): number {
    return 6 * this.config.molecules - 3;
  }

  private rescaleToTargetTemperature(): void {
    const kinetic = kineticEnergy(this.state, this.species);
    const target = 0.5 * this.degreesOfFreedom() * BOLTZMANN_KJ_PER_MOL_K * this.targetTemperatureK;
    if (kinetic <= 0) return;
    const scale = Math.sqrt(target / kinetic);
    for (let i = 0; i < this.state.velocities.length; i++) this.state.velocities[i] *= scale;
  }

  step(steps = 1): void {
    if (!Number.isInteger(steps) || steps < 0) throw new RangeError("steps must be non-negative");
    for (let iteration = 0; iteration < steps; iteration++) {
      const dt = this.timestepPs;
      const halfDt = 0.5 * dt;
      const { positions, velocities, forces, count } = this.state;
      this.referencePositions.set(positions);
      for (let atom = 0; atom < count; atom++) {
        const inverseMass = this.inverseMass[atom];
        velocities[3 * atom] += halfDt * forces[3 * atom] * inverseMass;
        velocities[3 * atom + 1] += halfDt * forces[3 * atom + 1] * inverseMass;
        velocities[3 * atom + 2] += halfDt * forces[3 * atom + 2] * inverseMass;
        positions[3 * atom] += dt * velocities[3 * atom];
        positions[3 * atom + 1] += dt * velocities[3 * atom + 1];
        positions[3 * atom + 2] += dt * velocities[3 * atom + 2];
      }
      applyBoundary(this.state, this.box, this.species);
      shake(this.state, this.constraints, this.referencePositions, this.inverseMass, this.box, dt);
      this.last = this.force.compute(this.state, this.box, this.species);
      for (let atom = 0; atom < count; atom++) {
        const inverseMass = this.inverseMass[atom];
        velocities[3 * atom] += halfDt * forces[3 * atom] * inverseMass;
        velocities[3 * atom + 1] += halfDt * forces[3 * atom + 1] * inverseMass;
        velocities[3 * atom + 2] += halfDt * forces[3 * atom + 2] * inverseMass;
      }
      rattle(this.state, this.constraints, this.inverseMass, this.box);
      const currentKinetic = kineticEnergy(this.state, this.species);
      const dof = this.degreesOfFreedom();
      const targetKinetic = 0.5 * dof * BOLTZMANN_KJ_PER_MOL_K * this.targetTemperatureK;
      // The ordered packing releases substantial potential energy while melting. During the
      // first picosecond CSVR redraws the kinetic energy every step; coupling is then relaxed
      // smoothly to the weak production value. No samples are taken in this equilibration stage.
      let thermostatTau = this.config.thermostatTauPs;
      if (this.elapsedPs < 1) thermostatTau = dt;
      else if (this.elapsedPs < 20) thermostatTau = Math.min(thermostatTau, 0.05);
      else if (this.elapsedPs < 50) {
        const blend = (this.elapsedPs - 20) / 30;
        thermostatTau = 0.05 + blend * (thermostatTau - 0.05);
      }
      const lambda = csvrLambda(
        currentKinetic,
        targetKinetic,
        dof,
        dt,
        thermostatTau,
        this.thermostatRng,
      );
      for (let i = 0; i < velocities.length; i++) velocities[i] *= lambda;
      this.stepCount++;
      this.elapsedPs += dt;
    }
  }

  instantaneous(): SurfaceTensionInstantaneous {
    const kinetic = kineticEnergy(this.state, this.species);
    return {
      step: this.stepCount,
      timePs: this.elapsedPs,
      temperatureK: (2 * kinetic) / (this.degreesOfFreedom() * BOLTZMANN_KJ_PER_MOL_K),
      kineticEnergy: kinetic,
      potentialEnergy: this.last.potentialEnergy,
      totalEnergy: kinetic + this.last.potentialEnergy,
    };
  }

  densityProfile(): DensityProfile {
    return massDensityProfileZ(this.state, this.box, this.species, this.config.densityBins);
  }

  collectTestAreaSample(relativeAreaStep = 5e-4): TestAreaSample {
    const sample = evaluateTestAreaSample(
      this.state,
      this.box,
      this.species,
      this.force,
      relativeAreaStep,
    );
    this.testAreaSamples.push(sample);
    return sample;
  }

  testAreaEstimate(relativeAreaStep: number, blockSize: number): BlockedTestAreaEstimate {
    const deltaArea = this.box.lengths[0] * this.box.lengths[1] * relativeAreaStep;
    return blockTestAreaSurfaceTension(
      this.testAreaSamples,
      this.targetTemperatureK,
      deltaArea,
      blockSize,
      2,
    );
  }

  analysis(relativeAreaStep = 5e-4): SurfaceTensionAnalysis {
    let gammaMilliNewtonPerMeter: number | null = null;
    let standardErrorMilliNewtonPerMeter: number | null = null;
    if (this.testAreaSamples.length >= 2) {
      const estimate = this.testAreaEstimate(relativeAreaStep, 1);
      gammaMilliNewtonPerMeter = surfaceTensionToMilliNewtonPerMeter(estimate.gamma);
      standardErrorMilliNewtonPerMeter = surfaceTensionToMilliNewtonPerMeter(
        estimate.blockStatistics.standardError,
      );
    }
    return {
      densityProfile: this.densityProfile(),
      liquidThickness: this.liquidThickness,
      sampleCount: this.testAreaSamples.length,
      gammaMilliNewtonPerMeter,
      standardErrorMilliNewtonPerMeter,
    };
  }

  setTargetTemperature(temperatureK: number): void {
    if (!(temperatureK > 0)) throw new RangeError("target temperature must be positive");
    this.targetTemperatureK = temperatureK;
  }

  setTimestep(timestepPs: number): void {
    if (!(timestepPs > 0)) throw new RangeError("timestep must be positive");
    this.timestepPs = timestepPs;
  }

  restoreState(
    positions: ArrayLike<number>,
    velocities: ArrayLike<number>,
    step: number,
    timePs: number,
  ) {
    if (
      positions.length !== this.state.positions.length ||
      velocities.length !== this.state.velocities.length
    ) {
      throw new RangeError("restored L11 state has incompatible buffer lengths");
    }
    this.state.positions.set(positions);
    this.state.velocities.set(velocities);
    this.stepCount = step;
    this.elapsedPs = timePs;
    this.last = this.force.compute(this.state, this.box, this.species);
  }
}
