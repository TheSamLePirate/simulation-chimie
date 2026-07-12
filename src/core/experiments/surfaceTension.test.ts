import { describe, expect, it } from "vitest";
import { TIP4P_2005, TIP4P_2005_HH } from "../tip4p2005";
import { SurfaceTensionExperiment, type SurfaceTensionExperimentConfig } from "./surfaceTension";

const SMALL: SurfaceTensionExperimentConfig = {
  molecules: 2,
  box: [2, 2, 5],
  temperatureK: 300,
  targetDensityKgPerM3: 20,
  seed: 44,
  timestepPs: 0.002,
  thermostatTauPs: 1,
  alphaNmInverse: 3.5,
  pmeGrid: [8, 8, 16],
  densityBins: 20,
};

function minimumDistance(
  positions: Float64Array,
  i: number,
  j: number,
  lengths: readonly number[],
) {
  let squared = 0;
  for (let c = 0; c < 3; c++) {
    let delta = positions[3 * i + c] - positions[3 * j + c];
    delta -= lengths[c] * Math.round(delta / lengths[c]);
    squared += delta * delta;
  }
  return Math.sqrt(squared);
}

describe("surface-tension experiment runner", () => {
  it("uses rigid-water degrees of freedom and advances reproducibly", () => {
    const a = new SurfaceTensionExperiment(SMALL);
    const b = new SurfaceTensionExperiment(SMALL);
    expect(a.instantaneous().temperatureK).toBeCloseTo(300, 10);
    a.step(2);
    b.step(2);
    expect(a.instantaneous()).toEqual(b.instantaneous());
    expect(a.state.positions).toEqual(b.state.positions);
    expect(a.instantaneous().step).toBe(2);
    for (let molecule = 0; molecule < SMALL.molecules; molecule++) {
      const o = 3 * molecule;
      expect(minimumDistance(a.state.positions, o, o + 1, a.box.lengths)).toBeCloseTo(
        TIP4P_2005.rOH,
        6,
      );
      expect(minimumDistance(a.state.positions, o + 1, o + 2, a.box.lengths)).toBeCloseTo(
        TIP4P_2005_HH,
        6,
      );
    }
  });

  it("collects density and finite test-area measurements without moving the live state", () => {
    const experiment = new SurfaceTensionExperiment(SMALL);
    const positions = experiment.state.positions.slice();
    const profile = experiment.densityProfile();
    expect(profile.density).toHaveLength(SMALL.densityBins);
    const sample = experiment.collectTestAreaSample(1e-4);
    experiment.collectTestAreaSample(1e-4);
    expect(Number.isFinite(sample.deltaUPlus)).toBe(true);
    expect(Number.isFinite(sample.deltaUMinus)).toBe(true);
    const estimate = experiment.testAreaEstimate(1e-4, 1);
    expect(estimate.samples).toBe(2);
    expect(Number.isFinite(estimate.gamma)).toBe(true);
    expect(estimate.blockStatistics.blocks).toBe(2);
    experiment.collectSurfaceTensionSample(1e-4);
    const combined = experiment.analysis(1e-4);
    expect(Number.isFinite(combined.mechanicalGammaMilliNewtonPerMeter)).toBe(true);
    expect(Number.isFinite(combined.routeDifferenceMilliNewtonPerMeter)).toBe(true);
    expect(experiment.state.positions).toEqual(positions);
  });

  it("rejects invalid step counts", () => {
    const experiment = new SurfaceTensionExperiment(SMALL);
    expect(() => experiment.step(-1)).toThrow(/non-negative/);
  });
});
