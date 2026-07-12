import { describe, expect, it } from "vitest";
import { setMaxwellBoltzmannVelocities } from "../init";
import { Rng } from "../rng";
import { SPECIES_LIBRARY } from "../species";
import { createState } from "../state";
import { BOLTZMANN_KJ_PER_MOL_K } from "../units";
import { speedDistribution } from "./speedDistribution";

describe("speedDistribution", () => {
  it("matches the Maxwell-Boltzmann density for MB-sampled velocities (argon, 120 K)", () => {
    const species = [SPECIES_LIBRARY.ARGON];
    const state = createState(8000);
    setMaxwellBoltzmannVelocities(state, species, 120, new Rng(7));

    const { v, density, theory, meanSpeed } = speedDistribution(state, species, 120, { bins: 40 });

    // Both are probability densities: they integrate to ~1.
    const dv = v[1] - v[0];
    const integral = density.reduce((s, f) => s + f * dv, 0);
    expect(integral).toBeCloseTo(1, 2);

    // Histogram tracks the analytic curve where the density is significant.
    for (let b = 0; b < v.length; b++) {
      if (theory[b] > 0.5) expect(Math.abs(density[b] - theory[b])).toBeLessThan(0.35);
    }

    // Mean speed ⟨|v|⟩ = √(8kT/πm).
    const m = SPECIES_LIBRARY.ARGON.mass;
    const expected = Math.sqrt((8 * BOLTZMANN_KJ_PER_MOL_K * 120) / (Math.PI * m));
    expect(meanSpeed).toBeCloseTo(expected, 2);
  });

  it("weights the theory curve by species fractions in a mixture", () => {
    const light = { ...SPECIES_LIBRARY.ARGON, name: "Léger", mass: 4 };
    const heavy = { ...SPECIES_LIBRARY.ARGON, name: "Lourd", mass: 100 };
    const typeIds = new Uint8Array(4000);
    for (let i = 0; i < typeIds.length; i++) typeIds[i] = i % 2;
    const state = createState(typeIds.length, typeIds);
    setMaxwellBoltzmannVelocities(state, [light, heavy], 300, new Rng(11));

    const { v, density, theory } = speedDistribution(state, [light, heavy], 300, { bins: 40 });
    const dv = v[1] - v[0];
    const integralTheory = theory.reduce((s, f) => s + f * dv, 0);
    // The mixture-weighted MB density integrates to ~1 over the plotted range.
    expect(integralTheory).toBeGreaterThan(0.95);
    // And the observed bimodal-ish histogram stays close to it.
    for (let b = 0; b < v.length; b++) {
      if (theory[b] > 0.5) expect(Math.abs(density[b] - theory[b])).toBeLessThan(0.4);
    }
  });

  it("handles an empty state", () => {
    const state = createState(0);
    const d = speedDistribution(state, [SPECIES_LIBRARY.ARGON], 100);
    expect(d.meanSpeed).toBe(0);
    expect(d.density.every((f) => f === 0)).toBe(true);
  });
});
