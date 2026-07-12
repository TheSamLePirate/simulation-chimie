import type { Box, ForceModel, SimState, Species } from "../types";
import { planarSurfaceTension, pressureTensor, type SymmetricTensor3 } from "./tensor";
import { deformMolecularCenters } from "./testArea";

/** Translational kinetic tensor of rigid molecular centres of mass. */
export function molecularCenterKineticTensor(
  state: SimState,
  species: readonly Species[],
): SymmetricTensor3 {
  const molecules = new Map<number, number[]>();
  for (let atom = 0; atom < state.count; atom++) {
    const id = state.moleculeId[atom];
    const group = molecules.get(id);
    if (group) group.push(atom);
    else molecules.set(id, [atom]);
  }
  let xx = 0;
  let yy = 0;
  let zz = 0;
  let xy = 0;
  let xz = 0;
  let yz = 0;
  for (const atoms of molecules.values()) {
    let mass = 0;
    const momentum = [0, 0, 0];
    for (const atom of atoms) {
      const atomMass = species[state.typeIds[atom]].mass;
      mass += atomMass;
      for (let component = 0; component < 3; component++) {
        momentum[component] += atomMass * state.velocities[3 * atom + component];
      }
    }
    const vx = momentum[0] / mass;
    const vy = momentum[1] / mass;
    const vz = momentum[2] / mass;
    xx += mass * vx * vx;
    yy += mass * vy * vy;
    zz += mass * vz * vz;
    xy += mass * vx * vy;
    xz += mass * vx * vz;
    yz += mass * vy * vz;
  }
  return { xx, yy, zz, xy, xz, yz };
}

/** Robust diagonal configurational virial Wαα = −∂U/∂εα from central log-strains. */
export function diagonalVirialByMolecularStrain(
  state: SimState,
  box: Box,
  species: readonly Species[],
  forceModel: ForceModel,
  strain = 2e-5,
): SymmetricTensor3 {
  if (!(strain > 0 && strain < 0.01)) throw new RangeError("strain must lie in (0, 0.01)");
  const diagonal = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    const plusScale: [number, number, number] = [1, 1, 1];
    const minusScale: [number, number, number] = [1, 1, 1];
    plusScale[axis] = Math.exp(strain);
    minusScale[axis] = Math.exp(-strain);
    const plus = deformMolecularCenters(state, box, species, plusScale);
    const minus = deformMolecularCenters(state, box, species, minusScale);
    const energyPlus = forceModel.compute(plus.state, plus.box, species).potentialEnergy;
    const energyMinus = forceModel.compute(minus.state, minus.box, species).potentialEnergy;
    diagonal[axis] = -(energyPlus - energyMinus) / (2 * strain);
  }
  return { xx: diagonal[0], yy: diagonal[1], zz: diagonal[2], xy: 0, xz: 0, yz: 0 };
}

export interface MechanicalSurfaceTensionSnapshot {
  readonly kinetic: SymmetricTensor3;
  readonly virial: SymmetricTensor3;
  readonly pressure: SymmetricTensor3;
  /** kJ·mol⁻¹·nm⁻². */
  readonly gamma: number;
}

export function mechanicalSurfaceTensionSnapshot(
  state: SimState,
  box: Box,
  species: readonly Species[],
  forceModel: ForceModel,
  strain = 2e-5,
): MechanicalSurfaceTensionSnapshot {
  const kinetic = molecularCenterKineticTensor(state, species);
  const virial = diagonalVirialByMolecularStrain(state, box, species, forceModel, strain);
  const volume = box.lengths[0] * box.lengths[1] * box.lengths[2];
  const pressure = pressureTensor(kinetic, virial, volume);
  return {
    kinetic,
    virial,
    pressure,
    gamma: planarSurfaceTension(pressure, box.lengths[2], 2),
  };
}
