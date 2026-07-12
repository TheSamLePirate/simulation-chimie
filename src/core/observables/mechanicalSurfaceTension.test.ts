import { describe, expect, it } from "vitest";
import { createBoxXYZ } from "../box";
import { Tip4p2005EwaldForce } from "../forces/tip4p2005Ewald";
import { Rng } from "../rng";
import { createState } from "../state";
import { buildTip4p2005System } from "../tip4p2005";
import type { ForceModel, Species } from "../types";
import {
  diagonalVirialByMolecularStrain,
  mechanicalSurfaceTensionSnapshot,
  molecularCenterKineticTensor,
} from "./mechanicalSurfaceTension";
import { estimateTestAreaSurfaceTension, evaluateTestAreaSample } from "./testArea";

const SPECIES: readonly Species[] = [
  { name: "X", mass: 1, sigma: 0, epsilon: 0, charge: 0, color: 0, radius: 0.1 },
];

describe("rigid-molecule mechanical surface tension", () => {
  it("uses molecular COM translation rather than internal rotational kinetic energy", () => {
    const state = createState(3, new Uint8Array(3), Int32Array.from([0, 0, 1]));
    state.velocities.set([1, 2, 0, 3, 0, 0, 0, 1, 4]);
    const tensor = molecularCenterKineticTensor(state, SPECIES);
    expect(tensor.xx).toBeCloseTo(8, 12);
    expect(tensor.yy).toBeCloseTo(3, 12);
    expect(tensor.zz).toBeCloseTo(16, 12);
    expect(tensor.xy).toBeCloseTo(4, 12);
  });

  it("recovers exact box derivatives and the planar gamma identity", () => {
    const box = createBoxXYZ(2, 3, 5, "periodic");
    const state = createState(2, new Uint8Array(2), Int32Array.from([0, 1]));
    const logarithmicEnergy: ForceModel = {
      name: "log box",
      compute: (_state, candidate) => ({
        potentialEnergy:
          2 * Math.log(candidate.lengths[0]) +
          2 * Math.log(candidate.lengths[1]) -
          4 * Math.log(candidate.lengths[2]),
        virial: 0,
      }),
    };
    const virial = diagonalVirialByMolecularStrain(state, box, SPECIES, logarithmicEnergy);
    expect(virial.xx).toBeCloseTo(-2, 9);
    expect(virial.yy).toBeCloseTo(-2, 9);
    expect(virial.zz).toBeCloseTo(4, 9);
    const snapshot = mechanicalSurfaceTensionSnapshot(state, box, SPECIES, logarithmicEnergy);
    expect(snapshot.gamma).toBeCloseTo(3 / (box.lengths[0] * box.lengths[1]), 9);
  });

  it("rejects strains too large for a local derivative", () => {
    const state = createState(1);
    const force: ForceModel = { name: "zero", compute: () => ({ potentialEnergy: 0, virial: 0 }) };
    expect(() =>
      diagonalVirialByMolecularStrain(state, createBoxXYZ(1, 1, 1), SPECIES, force, 0.1),
    ).toThrow(/strain/);
  });

  it("converges to the independent test-area derivative on a TIP4P/2005 golden state", () => {
    const box = createBoxXYZ(2.4, 2.4, 2.4, "periodic");
    const system = buildTip4p2005System(2, box, 0, new Rng(12));
    const positions = system.state.positions;
    const shift = [
      positions[0] + 0.38 - positions[9],
      positions[1] + 0.04 - positions[10],
      positions[2] - 0.02 - positions[11],
    ];
    for (let atom = 3; atom < 6; atom++) {
      for (let component = 0; component < 3; component++) {
        positions[3 * atom + component] += shift[component];
      }
    }
    const force = new Tip4p2005EwaldForce({
      alpha: 3.5,
      pmeGrid: [32, 32, 32],
      slabCorrection: true,
    });
    const mechanical = mechanicalSurfaceTensionSnapshot(
      system.state,
      box,
      system.species,
      force,
      1e-5,
    );
    const relativeAreaStep = 1e-5;
    const sample = evaluateTestAreaSample(
      system.state,
      box,
      system.species,
      force,
      relativeAreaStep,
    );
    const area = box.lengths[0] * box.lengths[1];
    const testArea = estimateTestAreaSurfaceTension([sample], 300, area * relativeAreaStep, 2);
    expect(
      Math.abs(mechanical.gamma - testArea.gamma) / Math.max(1, Math.abs(testArea.gamma)),
    ).toBeLessThan(2e-3);
  });
});
