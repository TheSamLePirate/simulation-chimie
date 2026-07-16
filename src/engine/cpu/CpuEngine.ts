import { applyBoundary } from "../../core/boundary";
import { createBox, volume } from "../../core/box";
import { type DistanceConstraints, rattle, shake } from "../../core/constraints";
import {
  type SurfaceTensionAnalysis,
  SurfaceTensionExperiment,
} from "../../core/experiments/surfaceTension";
import { IonicForce } from "../../core/forces/ionic";
import { LennardJonesCellForce } from "../../core/forces/lennardJonesCell";
import { MolecularForce } from "../../core/forces/molecular";
import { NoForce } from "../../core/forces/none";
import { WaterForce } from "../../core/forces/water";
import { WcaForce } from "../../core/forces/wca";
import { velocityVerletStep } from "../../core/integrators/velocityVerlet";
import { kineticEnergy, pressure, temperature } from "../../core/observables";
import { Rng } from "../../core/rng";
import { createState } from "../../core/state";
import { berendsenLambda, csvrLambda, langevinFactors } from "../../core/thermostats";
import type { Box, ForceModel, ForceResult, SimState, Species } from "../../core/types";
import { BAR_PER_KJ_PER_MOL_NM3, BOLTZMANN_KJ_PER_MOL_K, pressureToBar } from "../../core/units";
import {
  type BuiltSystem,
  buildSystem,
  type ForceSpec,
  isMonatomicLevel,
  L11_DENSITY,
  l11BoxHeight,
  monatomicForceSpec,
} from "../buildSystem";
import type { AccuracyLevel, Observables, SimConfig, SimulationEngine } from "../types";

/**
 * Build the CPU force model a canonical system declares. One exhaustive switch, no fall-through.
 * `built` supplies the topology the molecular models need; monatomic specs are self-contained.
 */
function makeForceModel(spec: ForceSpec, built: BuiltSystem | null): ForceModel {
  switch (spec.kind) {
    case "none":
      return NoForce;
    case "wca":
      return new WcaForce();
    case "lennardJones":
      return new LennardJonesCellForce(spec.crossScale);
    case "ionic":
      return new IonicForce();
    case "water":
      return new WaterForce(spec.topology, spec.rigid);
    case "molecular": {
      if (!built) throw new Error("a molecular force model needs its built topology");
      return new MolecularForce(
        built.bonds,
        built.angles,
        spec.ljCutoffFactor,
        spec.coulombCutoff,
        built.dihedrals,
        built.exclusions,
      );
    }
    case "surfaceTension":
      // L11 evaluates its forces inside SurfaceTensionExperiment; configure() routes it there.
      throw new Error("L11 forces are owned by SurfaceTensionExperiment");
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
  /** Bonded atom pairs for molecular rendering (null for monatomic systems). */
  bonds: { i: Int32Array; j: Int32Array } | null = null;

  private force: ForceModel;
  private last: ForceResult = { potentialEnergy: 0, virial: 0 };
  private stepCount = 0;
  private elapsed = 0;
  private thermostatRng = new Rng(1);
  // Rigid-water (L5) constraint state.
  private constraints: DistanceConstraints | null = null;
  private invMass = new Float64Array(0);
  private refPositions = new Float64Array(0);
  private l11: SurfaceTensionExperiment | null = null;

  constructor(config: SimConfig) {
    this.config = config;
    // Definite-assignment via configure(); fields are set there.
    this.box = createBox(config.boxLength, config.boundary);
    this.species = [];
    this.state = createState(0);
    this.force = NoForce;
    this.configure();
  }

  /**
   * (Re)build box, species, state, topology and force model from the current config.
   * The level→system mapping lives in the shared canonical builder, so this engine and the GPU
   * engine start from the identical system by construction rather than by parallel maintenance.
   */
  private configure(): void {
    const c = this.config;
    this.l11 = null;
    this.constraints = null;
    this.stepCount = 0;
    this.elapsed = 0;
    this.thermostatRng = new Rng(c.seed ^ 0x2c1b3c6d);

    // L11 owns its own integrator/force stack; the shared builder still defines its system.
    if (c.level === "L11") {
      const lz = l11BoxHeight(c.particleCount);
      const nextPowerOfTwo = (value: number) => 2 ** Math.ceil(Math.log2(value));
      const gridX = nextPowerOfTwo(Math.max(8, Math.ceil(c.boxLength / 0.07)));
      const gridZ = nextPowerOfTwo(Math.max(16, Math.ceil(lz / 0.07)));
      const experiment = new SurfaceTensionExperiment({
        molecules: c.particleCount,
        box: [c.boxLength, c.boxLength, lz],
        temperatureK: c.temperature,
        targetDensityKgPerM3: L11_DENSITY,
        seed: c.seed,
        timestepPs: c.timestep,
        thermostatTauPs: c.thermostatTau,
        alphaNmInverse: 3.5,
        pmeGrid: [gridX, gridX, gridZ],
        densityBins: 80,
      });
      this.l11 = experiment;
      this.box = experiment.box;
      this.state = experiment.state;
      this.species = experiment.species;
      this.bonds = experiment.renderBonds;
      return;
    }

    const built = buildSystem(c);
    this.box = built.box;
    this.state = built.state;
    this.species = built.species;
    this.bonds = built.renderBonds;
    this.force = makeForceModel(built.forceSpec, built);

    // Rigid systems need the constraint solver's working buffers.
    if (built.constraints.i.length > 0) {
      this.constraints = built.constraints;
      this.refPositions = new Float64Array(this.state.positions.length);
      this.invMass = new Float64Array(this.state.count);
      for (let a = 0; a < this.state.count; a++) {
        this.invMass[a] = 1 / this.species[this.state.typeIds[a]].mass;
      }
    }

    this.last = this.force.compute(this.state, this.box, this.species);
  }

  step(steps: number): void {
    if (this.l11) {
      this.l11.step(steps);
      return;
    }
    const dt = this.config.timestep;
    for (let i = 0; i < steps; i++) {
      this.last = this.constraints
        ? this.stepRigidConstrained(dt)
        : velocityVerletStep(
            this.state,
            this.box,
            this.species,
            this.force,
            dt,
            this.config.gravity,
            this.config.electricField ?? 0,
          );
      this.applyThermostat(dt);
      this.applyBarostat(dt);
      this.elapsed += dt;
      this.stepCount += 1;
    }
  }

  /** Constrained velocity-Verlet (SHAKE positions + RATTLE velocities) for rigid water. */
  private stepRigidConstrained(dt: number): ForceResult {
    const c = this.constraints;
    if (!c) return velocityVerletStep(this.state, this.box, this.species, this.force, dt);
    const { positions, velocities, forces, count, typeIds } = this.state;
    const inv = this.invMass;
    const g = this.config.gravity;
    const eField = this.config.electricField ?? 0;
    const halfDt = 0.5 * dt;

    this.refPositions.set(positions);
    for (let a = 0; a < count; a++) {
      const qE = this.species[typeIds[a]].charge * eField;
      velocities[3 * a] += halfDt * (forces[3 * a] + qE) * inv[a];
      velocities[3 * a + 1] += halfDt * (forces[3 * a + 1] * inv[a] - g);
      velocities[3 * a + 2] += halfDt * forces[3 * a + 2] * inv[a];
      positions[3 * a] += dt * velocities[3 * a];
      positions[3 * a + 1] += dt * velocities[3 * a + 1];
      positions[3 * a + 2] += dt * velocities[3 * a + 2];
    }
    applyBoundary(this.state, this.box, this.species);
    shake(this.state, c, this.refPositions, inv, this.box, dt);

    const result = this.force.compute(this.state, this.box, this.species);
    for (let a = 0; a < count; a++) {
      const qE = this.species[typeIds[a]].charge * eField;
      velocities[3 * a] += halfDt * (forces[3 * a] + qE) * inv[a];
      velocities[3 * a + 1] += halfDt * (forces[3 * a + 1] * inv[a] - g);
      velocities[3 * a + 2] += halfDt * forces[3 * a + 2] * inv[a];
    }
    rattle(this.state, c, inv, this.box);
    return result;
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

    // Langevin: per-atom friction + random kick (Brownian motion). Mass-dependent, so it can't
    // be a single global λ; v ← c₁·v + c₂·η with η ~ N(0,1) per component.
    if (kind === "langevin") {
      const { velocities, typeIds, count } = this.state;
      const target = this.config.temperature;
      const tau = this.config.thermostatTau;
      for (let a = 0; a < count; a++) {
        const { c1, c2 } = langevinFactors(dt, tau, target, this.species[typeIds[a]].mass);
        velocities[3 * a] = c1 * velocities[3 * a] + c2 * this.thermostatRng.gaussian();
        velocities[3 * a + 1] = c1 * velocities[3 * a + 1] + c2 * this.thermostatRng.gaussian();
        velocities[3 * a + 2] = c1 * velocities[3 * a + 2] + c2 * this.thermostatRng.gaussian();
      }
      return;
    }

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
    if (this.l11) {
      const current = this.l11.instantaneous();
      return {
        step: current.step,
        time: current.timePs,
        kineticEnergy: current.kineticEnergy,
        potentialEnergy: current.potentialEnergy,
        totalEnergy: current.totalEnergy,
        temperature: current.temperatureK,
        pressure: Number.NaN,
      };
    }
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
    // Molecular levels change topology/atom count ⇒ full rebuild, not a swap. Monatomic levels
    // share one state, so only the force model changes — sourced from the same spec mapping.
    if (!isMonatomicLevel(level)) {
      this.configure();
      return;
    }
    this.force = makeForceModel(monatomicForceSpec(level, this.config.crossScale), null);
    this.last = this.force.compute(this.state, this.box, this.species);
  }

  /** Update the integration timestep (ps) without disturbing the trajectory. */
  setTimestep(timestep: number): void {
    this.config = { ...this.config, timestep };
    this.l11?.setTimestep(timestep);
  }

  /**
   * Set the target temperature. With NVE (no thermostat) this is an instantaneous
   * velocity rescale; with a thermostat it just updates the bath target.
   */
  rescaleToTemperature(targetK: number): void {
    this.config = { ...this.config, temperature: targetK };
    if (this.l11) {
      this.l11.setTargetTemperature(targetK);
      return;
    }
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

  /** Update gravity (nm·ps⁻², downward) live. */
  setGravity(gravity: number): void {
    this.config = { ...this.config, gravity };
  }

  setElectricField(electricField: number): void {
    this.config = { ...this.config, electricField };
  }

  surfaceTensionAnalysis(): SurfaceTensionAnalysis | null {
    return this.l11?.analysis() ?? null;
  }

  collectSurfaceTensionSample(relativeAreaStep = 5e-4): SurfaceTensionAnalysis | null {
    if (!this.l11) return null;
    this.l11.collectSurfaceTensionSample(relativeAreaStep);
    return this.l11.analysis(relativeAreaStep);
  }

  /** Overwrite the live state from a snapshot (sizes must match the config). */
  loadState(
    positions: ArrayLike<number>,
    velocities: ArrayLike<number>,
    typeIds: ArrayLike<number>,
    step: number,
    time: number,
  ): void {
    if (this.l11) {
      this.state.typeIds.set(typeIds);
      this.l11.restoreState(positions, velocities, step, time);
      return;
    }
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
