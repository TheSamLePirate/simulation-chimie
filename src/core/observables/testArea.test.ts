import { describe, expect, it } from "vitest";
import { createBoxXYZ, volume } from "../box";
import { Tip4p2005EwaldForce } from "../forces/tip4p2005Ewald";
import { Rng } from "../rng";
import { buildTip4p2005System, TIP4P_2005, TIP4P_2005_SPECIES } from "../tip4p2005";
import type { ForceModel } from "../types";
import {
  blockTestAreaSurfaceTension,
  deformMolecularCentersAtConstantVolume,
  estimateTestAreaSurfaceTension,
  evaluateTestAreaSample,
} from "./testArea";

function distance(positions: Float64Array, i: number, j: number) {
  return Math.hypot(
    positions[3 * i] - positions[3 * j],
    positions[3 * i + 1] - positions[3 * j + 1],
    positions[3 * i + 2] - positions[3 * j + 2],
  );
}

describe("test-area surface tension", () => {
  it("changes molecular centres while preserving volume and rigid geometry", () => {
    const box = createBoxXYZ(2, 3, 5, "periodic");
    const system = buildTip4p2005System(2, box, 0, new Rng(17));
    const before = distance(system.state.positions, 0, 1);
    const perturbed = deformMolecularCentersAtConstantVolume(
      system.state,
      box,
      system.species,
      1.04,
    );
    expect(volume(perturbed.box)).toBeCloseTo(volume(box), 12);
    expect(perturbed.box.lengths[0] * perturbed.box.lengths[1]).toBeCloseTo(6 * 1.04, 12);
    expect(perturbed.areaChange).toBeCloseTo(0.24, 12);
    expect(distance(perturbed.state.positions, 0, 1)).toBeCloseTo(before, 12);
    expect(system.state.positions).not.toEqual(perturbed.state.positions);
  });

  it("reconstructs a molecule straddling a periodic face without stretching it", () => {
    const box = createBoxXYZ(2, 2, 3, "periodic");
    const system = buildTip4p2005System(1, box, 0, new Rng(2));
    system.state.positions[3] += box.lengths[0];
    const perturbed = deformMolecularCentersAtConstantVolume(
      system.state,
      box,
      system.species,
      0.97,
    );
    expect(distance(perturbed.state.positions, 0, 1)).toBeCloseTo(TIP4P_2005.rOH, 12);
  });

  it("recovers an exact linear free-energy derivative including two interfaces", () => {
    const deltaArea = 0.02;
    const slope = 7.5;
    const samples = Array.from({ length: 20 }, () => ({
      deltaUPlus: slope * deltaArea,
      deltaUMinus: -slope * deltaArea,
    }));
    const estimate = estimateTestAreaSurfaceTension(samples, 300, deltaArea, 2);
    expect(estimate.gamma).toBeCloseTo(slope / 2, 12);
    expect(estimate.deltaFPlus).toBeCloseTo(slope * deltaArea, 12);
    expect(estimate.deltaFMinus).toBeCloseTo(-slope * deltaArea, 12);
  });

  it("uses a stable log-mean-exp for very large energy differences", () => {
    const estimate = estimateTestAreaSurfaceTension(
      [
        { deltaUPlus: 10_000, deltaUMinus: -10_000 },
        { deltaUPlus: 10_001, deltaUMinus: -9_999 },
      ],
      300,
      0.1,
    );
    expect(Number.isFinite(estimate.gamma)).toBe(true);
    expect(Number.isFinite(estimate.deltaFPlus)).toBe(true);
  });

  it("estimates uncertainty from complete blocks and discards the incomplete tail", () => {
    const samples = [1, 1, 3, 3, 99].map((slope) => ({
      deltaUPlus: slope * 0.1,
      deltaUMinus: -slope * 0.1,
    }));
    const estimate = blockTestAreaSurfaceTension(samples, 300, 0.1, 2, 2);
    expect(estimate.samples).toBe(4);
    expect(estimate.blockStatistics.blockMeans[0]).toBeCloseTo(0.5, 12);
    expect(estimate.blockStatistics.blockMeans[1]).toBeCloseTo(1.5, 12);
    expect(estimate.blockStatistics.standardError).toBeCloseTo(0.5, 12);
  });

  it("evaluates symmetric perturbations without mutating the source snapshot", () => {
    const box = createBoxXYZ(2, 2, 4, "periodic");
    const system = buildTip4p2005System(1, box, 0, new Rng(3));
    const original = system.state.positions.slice();
    const areaEnergy: ForceModel = {
      name: "area",
      compute: (_state, candidateBox) => ({
        potentialEnergy: candidateBox.lengths[0] * candidateBox.lengths[1],
        virial: 0,
      }),
    };
    const sample = evaluateTestAreaSample(system.state, box, TIP4P_2005_SPECIES, areaEnergy, 0.01);
    expect(sample.deltaUPlus).toBeCloseTo(0.04, 12);
    expect(sample.deltaUMinus).toBeCloseTo(-0.04, 12);
    expect(system.state.positions).toEqual(original);
  });

  it("produces finite symmetric perturbations with the periodic TIP4P/2005 oracle", () => {
    const box = createBoxXYZ(2.4, 2.4, 4.8, "periodic");
    const system = buildTip4p2005System(2, box, 0, new Rng(8));
    const force = new Tip4p2005EwaldForce({
      alpha: 3.5,
      kMax: [8, 8, 16],
      realImages: [1, 1, 1],
      slabCorrection: true,
    });
    const sample = evaluateTestAreaSample(system.state, box, system.species, force, 1e-4);
    expect(Number.isFinite(sample.deltaUPlus)).toBe(true);
    expect(Number.isFinite(sample.deltaUMinus)).toBe(true);
    const firstOrder = Math.max(1e-12, Math.abs(sample.deltaUPlus - sample.deltaUMinus));
    expect(Math.abs(sample.deltaUPlus + sample.deltaUMinus) / firstOrder).toBeLessThan(2e-3);
  });
});
