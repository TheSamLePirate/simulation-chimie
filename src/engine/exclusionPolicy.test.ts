import { describe, expect, it } from "vitest";
import { MolecularForce } from "../core/forces/molecular";
import { isExcluded } from "../core/topology";
import { buildSystem } from "./buildSystem";
import type { SimConfig } from "./types";

const base: SimConfig = {
  seed: 1234,
  particleCount: 64,
  boxLength: 3,
  boundary: "periodic",
  temperature: 300,
  timestep: 0.001,
  level: "L1",
  speciesName: "ARGON",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "none",
  thermostatTau: 0.5,
  barostat: "none",
  pressureTarget: 1,
  gravity: 0,
  engineKind: "cpu",
};

const ALKANE: SimConfig = {
  ...base,
  level: "L9",
  speciesName: "OIL_CH2",
  particleCount: 4,
  boxLength: 3,
  timestep: 0.002,
};

describe("L9 alkane exclusion policy (TraPPE)", () => {
  it("excludes only up to 1-4 within each chain", () => {
    const sys = buildSystem(ALKANE);
    // Chain 0 occupies atoms 0..8 (9 united-atom carbons).
    expect(isExcluded(sys.exclusions, 0, 1)).toBe(true); // 1-2
    expect(isExcluded(sys.exclusions, 0, 2)).toBe(true); // 1-3
    expect(isExcluded(sys.exclusions, 0, 3)).toBe(true); // 1-4
    expect(isExcluded(sys.exclusions, 0, 4)).toBe(false); // 1-5 interacts
    expect(isExcluded(sys.exclusions, 0, 8)).toBe(false); // chain ends interact
    // Atoms of different chains are never excluded.
    expect(isExcluded(sys.exclusions, 0, 9)).toBe(false);
    // A blanket same-molecule rule would be wrong here — that is the P67 defect.
    expect(sys.exclusions.allIntramolecularExcluded).toBe(false);
  });

  it("restores intrachain forces the molecule-wide rule deleted", () => {
    // Measure the change directly: evaluate the SAME state twice, once with the explicit policy
    // and once with the legacy molecule-wide exclusion. Their difference is exactly the 1-5+
    // intrachain nonbonded contribution — the excluded volume that makes a chain fold.
    const sys = buildSystem(ALKANE);
    const explicit = new MolecularForce(
      sys.bonds,
      sys.angles,
      2.5,
      0.9,
      sys.dihedrals,
      sys.exclusions,
    );
    const legacy = new MolecularForce(sys.bonds, sys.angles, 2.5, 0.9, sys.dihedrals);

    const withPolicy = explicit.compute(sys.state, sys.box, sys.species);
    const forcesWith = Float64Array.from(sys.state.forces);
    const withBlanket = legacy.compute(sys.state, sys.box, sys.species);
    const forcesBlanket = Float64Array.from(sys.state.forces);

    let maxDelta = 0;
    for (let k = 0; k < forcesWith.length; k++) {
      maxDelta = Math.max(maxDelta, Math.abs(forcesWith[k] - forcesBlanket[k]));
    }
    // The initial chains are extended all-trans, so 1-5+ pairs are already in LJ range: the
    // policies must disagree on both force and energy.
    expect(maxDelta).toBeGreaterThan(0);
    expect(withPolicy.potentialEnergy).not.toBe(withBlanket.potentialEnergy);
  });
});

describe("levels whose molecules are small are provably unaffected", () => {
  const cases: Array<[string, Partial<SimConfig>]> = [
    [
      "L4 flexible water",
      { level: "L4", speciesName: "WATER_O", particleCount: 8, boxLength: 1.6 },
    ],
    ["L5 rigid water", { level: "L5", speciesName: "WATER_O", particleCount: 8, boxLength: 1.7 }],
    [
      "L6 oil/water",
      {
        level: "L6",
        speciesName: "WATER_O",
        secondSpeciesName: "OIL_CH3",
        fractionSecond: 0.5,
        particleCount: 8,
        boxLength: 2.4,
      },
    ],
    [
      "L8 dissolution",
      {
        level: "L8",
        speciesName: "WATER_O",
        secondSpeciesName: "SODIUM",
        particleCount: 8,
        boxLength: 2,
      },
    ],
    [
      "L10 Morse diatomic",
      { level: "L10", speciesName: "OIL_CH2", particleCount: 6, boxLength: 3 },
    ],
  ];

  for (const [name, patch] of cases) {
    it(`${name}: every intramolecular pair is within 3 bonds`, () => {
      const sys = buildSystem({ ...base, ...patch });
      // Water/propane/diatomics are ≤4 atoms, so molecule-wide exclusion IS the TraPPE answer.
      // This is what keeps their trajectories identical and lets the GPU keep its cheap test.
      expect(sys.exclusions.allIntramolecularExcluded).toBe(true);
    });
  }

  it("keeps a dissociated Morse pair excluded, because topology is not distance-based", () => {
    // L10's diatomic stays one molecule after its Morse bond breaks: the pair is still bonded in
    // the topology (the Morse term simply flattens to Dₑ), so it stays excluded from LJ/Coulomb
    // no matter how far the fragments drift. That is the standard non-reactive MD convention —
    // exclusions come from the bond graph, never from the current separation. Modelling real
    // fragment chemistry would need reactive topology, which this level does not claim.
    const sys = buildSystem({
      ...base,
      level: "L10",
      speciesName: "OIL_CH2",
      particleCount: 6,
      boxLength: 3,
    });
    expect(isExcluded(sys.exclusions, 0, 1)).toBe(true);

    // Pull the fragments far apart: the classification is unchanged.
    sys.state.positions[0] = 0;
    sys.state.positions[3] = 1.4;
    expect(isExcluded(sys.exclusions, 0, 1)).toBe(true);
    // Atoms of *different* molecules always interact.
    expect(isExcluded(sys.exclusions, 0, 2)).toBe(false);
  });

  it("produces bit-identical molecular forces before and after the policy change", () => {
    // Stronger than the flag: for these levels the explicit policy and the legacy molecule-wide
    // rule must agree exactly, so P67 cannot have perturbed L6/L8/L10 physics.
    for (const [name, patch] of cases) {
      const sys = buildSystem({ ...base, ...patch });
      if (sys.forceSpec.kind !== "molecular") continue; // water levels use WaterForce
      const explicit = new MolecularForce(
        sys.bonds,
        sys.angles,
        2.5,
        0.9,
        sys.dihedrals,
        sys.exclusions,
      );
      const legacy = new MolecularForce(sys.bonds, sys.angles, 2.5, 0.9, sys.dihedrals);

      const a = explicit.compute(sys.state, sys.box, sys.species);
      const forcesExplicit = Float64Array.from(sys.state.forces);
      const b = legacy.compute(sys.state, sys.box, sys.species);

      expect(a.potentialEnergy, name).toBe(b.potentialEnergy);
      expect(a.virial, name).toBe(b.virial);
      expect(Array.from(forcesExplicit), name).toEqual(Array.from(sys.state.forces));
    }
  });
});
