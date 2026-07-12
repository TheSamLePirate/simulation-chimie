import { cloneState } from "../state";
import type { Box, ForceModel, SimState, Species } from "../types";
import { BOLTZMANN_KJ_PER_MOL_K } from "../units";
import { type BlockStatistics, blockAverage } from "./tensor";

export interface AreaPerturbation {
  readonly state: SimState;
  readonly box: Box;
  /** Perturbed area minus reference area, nm². */
  readonly areaChange: number;
}

export interface MolecularDeformation {
  readonly state: SimState;
  readonly box: Box;
}

/** Scale molecular centres independently along x/y/z while preserving internal geometry. */
export function deformMolecularCenters(
  state: SimState,
  box: Box,
  species: readonly Species[],
  scale: readonly [number, number, number],
): MolecularDeformation {
  if (scale.some((value) => !(value > 0) || !Number.isFinite(value))) {
    throw new RangeError("molecular deformation scales must be finite and positive");
  }
  const nextBox: Box = {
    boundary: box.boundary,
    lengths: [box.lengths[0] * scale[0], box.lengths[1] * scale[1], box.lengths[2] * scale[2]],
  };
  const next = cloneState(state);
  const molecules = new Map<number, number[]>();
  for (let atom = 0; atom < state.count; atom++) {
    const id = state.moleculeId[atom];
    const group = molecules.get(id);
    if (group) group.push(atom);
    else molecules.set(id, [atom]);
  }

  const periodic = box.boundary === "periodic";
  for (const atoms of molecules.values()) {
    const reference = atoms[0];
    const unwrapped = new Float64Array(3 * atoms.length);
    let totalMass = 0;
    const centre = [0, 0, 0];
    for (let local = 0; local < atoms.length; local++) {
      const atom = atoms[local];
      const mass = species[state.typeIds[atom]].mass;
      totalMass += mass;
      for (let component = 0; component < 3; component++) {
        let delta =
          state.positions[3 * atom + component] - state.positions[3 * reference + component];
        if (periodic) {
          const length = box.lengths[component];
          delta -= length * Math.round(delta / length);
        }
        const coordinate = state.positions[3 * reference + component] + delta;
        unwrapped[3 * local + component] = coordinate;
        centre[component] += mass * coordinate;
      }
    }
    if (!(totalMass > 0)) throw new RangeError("molecular mass must be greater than zero");
    for (let component = 0; component < 3; component++) centre[component] /= totalMass;
    const scaledCentre = [scale[0] * centre[0], scale[1] * centre[1], scale[2] * centre[2]];
    for (let local = 0; local < atoms.length; local++) {
      const atom = atoms[local];
      for (let component = 0; component < 3; component++) {
        next.positions[3 * atom + component] =
          scaledCentre[component] + unwrapped[3 * local + component] - centre[component];
      }
    }
  }
  return { state: next, box: nextBox };
}

/**
 * Change the interfacial area at constant volume without stretching rigid molecules.
 * Molecular centres of mass follow (x,y,z) → (s x,s y,z/s²); internal coordinates
 * are reconstructed from minimum-image displacements around the first atom.
 */
export function deformMolecularCentersAtConstantVolume(
  state: SimState,
  box: Box,
  species: readonly Species[],
  areaFactor: number,
): AreaPerturbation {
  if (!(areaFactor > 0) || !Number.isFinite(areaFactor)) {
    throw new RangeError("areaFactor must be finite and greater than zero");
  }
  const [lx, ly] = box.lengths;
  const transverseScale = Math.sqrt(areaFactor);
  const normalScale = 1 / areaFactor;
  const deformation = deformMolecularCenters(state, box, species, [
    transverseScale,
    transverseScale,
    normalScale,
  ]);
  return {
    ...deformation,
    areaChange: lx * ly * (areaFactor - 1),
  };
}

export interface TestAreaSample {
  readonly deltaUPlus: number;
  readonly deltaUMinus: number;
}

/** Evaluate U(A+δA)−U(A) and U(A−δA)−U(A) for one unperturbed snapshot. */
export function evaluateTestAreaSample(
  state: SimState,
  box: Box,
  species: readonly Species[],
  forceModel: ForceModel,
  relativeAreaStep: number,
): TestAreaSample {
  if (!(relativeAreaStep > 0 && relativeAreaStep < 1)) {
    throw new RangeError("relativeAreaStep must lie strictly between zero and one");
  }
  const reference = cloneState(state);
  const plus = deformMolecularCentersAtConstantVolume(state, box, species, 1 + relativeAreaStep);
  const minus = deformMolecularCentersAtConstantVolume(state, box, species, 1 - relativeAreaStep);
  const u0 = forceModel.compute(reference, box, species).potentialEnergy;
  const uPlus = forceModel.compute(plus.state, plus.box, species).potentialEnergy;
  const uMinus = forceModel.compute(minus.state, minus.box, species).potentialEnergy;
  return { deltaUPlus: uPlus - u0, deltaUMinus: uMinus - u0 };
}

export interface TestAreaEstimate {
  readonly gamma: number;
  readonly deltaFPlus: number;
  readonly deltaFMinus: number;
  readonly samples: number;
}

function logMeanBoltzmann(deltas: readonly number[], beta: number): number {
  let maximum = -Infinity;
  for (const delta of deltas) maximum = Math.max(maximum, -beta * delta);
  let scaled = 0;
  for (const delta of deltas) scaled += Math.exp(-beta * delta - maximum);
  return maximum + Math.log(scaled / deltas.length);
}

/**
 * Central test-area free-energy estimate. `deltaArea` is |δA| in nm² and `interfaces`
 * is two for a periodic liquid slab. Result γ is in kJ·mol⁻¹·nm⁻².
 */
export function estimateTestAreaSurfaceTension(
  samples: readonly TestAreaSample[],
  temperatureK: number,
  deltaArea: number,
  interfaces = 2,
): TestAreaEstimate {
  if (samples.length === 0) throw new RangeError("at least one test-area sample is required");
  if (!(temperatureK > 0) || !(deltaArea > 0) || !Number.isInteger(interfaces) || interfaces < 1) {
    throw new RangeError("temperature, deltaArea and interfaces must be positive");
  }
  const thermalEnergy = BOLTZMANN_KJ_PER_MOL_K * temperatureK;
  const beta = 1 / thermalEnergy;
  const plus = samples.map((sample) => sample.deltaUPlus);
  const minus = samples.map((sample) => sample.deltaUMinus);
  const deltaFPlus = -thermalEnergy * logMeanBoltzmann(plus, beta);
  const deltaFMinus = -thermalEnergy * logMeanBoltzmann(minus, beta);
  return {
    gamma: (deltaFPlus - deltaFMinus) / (2 * deltaArea * interfaces),
    deltaFPlus,
    deltaFMinus,
    samples: samples.length,
  };
}

export interface BlockedTestAreaEstimate extends TestAreaEstimate {
  /** Uncertainty from equal-length, approximately independent blocks of snapshots. */
  readonly blockStatistics: BlockStatistics;
}

/**
 * Estimate γ on each complete block, then report the standard error across block estimates.
 * The full-sample free-energy estimate remains the reported central value.
 */
export function blockTestAreaSurfaceTension(
  samples: readonly TestAreaSample[],
  temperatureK: number,
  deltaArea: number,
  blockSize: number,
  interfaces = 2,
): BlockedTestAreaEstimate {
  if (!Number.isInteger(blockSize) || blockSize < 1) {
    throw new RangeError("blockSize must be a positive integer");
  }
  const completeBlocks = Math.floor(samples.length / blockSize);
  if (completeBlocks === 0) throw new RangeError("at least one complete block is required");
  const blockGamma = new Array<number>(completeBlocks);
  for (let block = 0; block < completeBlocks; block++) {
    const start = block * blockSize;
    blockGamma[block] = estimateTestAreaSurfaceTension(
      samples.slice(start, start + blockSize),
      temperatureK,
      deltaArea,
      interfaces,
    ).gamma;
  }
  return {
    ...estimateTestAreaSurfaceTension(
      samples.slice(0, completeBlocks * blockSize),
      temperatureK,
      deltaArea,
      interfaces,
    ),
    blockStatistics: blockAverage(blockGamma, 1),
  };
}
