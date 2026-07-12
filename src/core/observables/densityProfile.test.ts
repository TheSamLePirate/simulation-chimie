import { describe, expect, it } from "vitest";
import { createBoxXYZ } from "../box";
import { ARGON } from "../species";
import { createState } from "../state";
import { KG_PER_M3_PER_U_PER_NM3, massDensityProfileZ } from "./densityProfile";

describe("mass-density slab profile", () => {
  it("bins atomic mass along z and preserves the integrated mass", () => {
    const box = createBoxXYZ(2, 2, 4, "periodic");
    const state = createState(4);
    state.positions.set([0, 0, -1.5, 0, 0, -0.5, 0, 0, 0.5, 0, 0, 1.5]);
    const profile = massDensityProfileZ(state, box, [ARGON], 4);
    expect(profile.z).toEqual([-1.5, -0.5, 0.5, 1.5]);
    expect(profile.binWidth).toBe(1);
    const binVolume = 4;
    const expected = (ARGON.mass / binVolume) * KG_PER_M3_PER_U_PER_NM3;
    for (const density of profile.density) expect(density).toBeCloseTo(expected, 12);
    const recoveredMass =
      profile.density.reduce((sum, density) => sum + density * binVolume, 0) /
      KG_PER_M3_PER_U_PER_NM3;
    expect(recoveredMass).toBeCloseTo(4 * ARGON.mass, 12);
  });

  it("wraps coordinates and validates the bin count", () => {
    const box = createBoxXYZ(1, 1, 2, "periodic");
    const state = createState(1);
    state.positions[2] = 1.25;
    const profile = massDensityProfileZ(state, box, [ARGON], 2);
    expect(profile.density[0]).toBeGreaterThan(0);
    expect(profile.density[1]).toBe(0);
    expect(() => massDensityProfileZ(state, box, [ARGON], 0)).toThrow(RangeError);
  });
});
