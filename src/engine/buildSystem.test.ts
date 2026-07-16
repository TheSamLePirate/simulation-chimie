import { describe, expect, it } from "vitest";
import { buildSystem, toGpuTopology } from "./buildSystem";
import { CpuEngine } from "./cpu/CpuEngine";
import type { AccuracyLevel, SimConfig } from "./types";
import { ACCURACY_LEVELS } from "./types";

const base: SimConfig = {
  seed: 1234,
  particleCount: 64,
  boxLength: 2,
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

/**
 * The GPU engine builds its initial system via {@link buildSystem}; the CPU reference engine
 * builds it internally. They MUST agree atom-for-atom (same seed) or GPU and CPU diverge. This
 * pins that lock-step across representative levels, including molecular ones.
 */
describe("buildSystem matches the CPU engine initial state", () => {
  const cases: Array<[string, Partial<SimConfig>]> = [
    ["L1 monatomic", { level: "L1", particleCount: 64 }],
    [
      "L3 ionic (rock-salt)",
      {
        level: "L3",
        speciesName: "SODIUM",
        secondSpeciesName: "CHLORIDE",
        fractionSecond: 0.5,
        particleCount: 64,
        boxLength: 1.5,
      },
    ],
    [
      "L4 flexible water",
      {
        level: "L4",
        speciesName: "WATER_O",
        particleCount: 32,
        boxLength: 1.6,
        timestep: 0.0005,
      },
    ],
    [
      "L5 rigid water",
      {
        level: "L5",
        speciesName: "WATER_O",
        particleCount: 32,
        boxLength: 1.7,
        timestep: 0.002,
      },
    ],
    [
      "L8 dissolution",
      {
        level: "L8",
        speciesName: "WATER_O",
        secondSpeciesName: "SODIUM",
        particleCount: 27,
        boxLength: 2,
        timestep: 0.002,
      },
    ],
    [
      "L11 TIP4P/2005 slab",
      {
        level: "L11",
        speciesName: "WATER_O",
        particleCount: 8,
        boxLength: 1.8,
        timestep: 0.002,
        thermostat: "csvr",
        thermostatTau: 1,
      },
    ],
    ["L0 ideal gas", { level: "L0", particleCount: 64 }],
    ["L2 Lennard-Jones", { level: "L2", particleCount: 64, boxLength: 2 }],
    [
      "L6 oil/water mixture",
      {
        level: "L6",
        speciesName: "WATER_O",
        secondSpeciesName: "OIL_CH3",
        fractionSecond: 0.4,
        particleCount: 24,
        boxLength: 2.4,
        boundary: "reflective",
        timestep: 0.001,
      },
    ],
    [
      "L7 water droplet",
      {
        level: "L7",
        speciesName: "WATER_O",
        particleCount: 24,
        boxLength: 3.2,
        timestep: 0.002,
      },
    ],
    [
      "L9 alkane chains (dihedrals)",
      {
        level: "L9",
        speciesName: "OIL_CH2",
        particleCount: 6,
        boxLength: 3,
        timestep: 0.002,
      },
    ],
    [
      "L10 Morse dissociation",
      {
        level: "L10",
        speciesName: "OIL_CH2",
        particleCount: 12,
        boxLength: 3,
        timestep: 0.001,
      },
    ],
  ];

  for (const [name, patch] of cases) {
    it(name, () => {
      const config = { ...base, ...patch };
      const cpu = new CpuEngine(config);
      const sys = buildSystem(config);
      expect(sys.state.count).toBe(cpu.state.count);
      expect(Array.from(sys.state.typeIds)).toEqual(Array.from(cpu.state.typeIds));
      // Positions + velocities identical to float precision (deterministic seeded build).
      for (let i = 0; i < sys.state.positions.length; i++) {
        expect(sys.state.positions[i]).toBeCloseTo(cpu.state.positions[i], 10);
        expect(sys.state.velocities[i]).toBeCloseTo(cpu.state.velocities[i], 10);
      }
      // Box geometry is part of the system: L6/L11 are deliberately anisotropic.
      expect(Array.from(sys.box.lengths)).toEqual(Array.from(cpu.box.lengths));
      expect(sys.box.boundary).toBe(cpu.box.boundary);
      expect(sys.species.map((s) => s.name)).toEqual(cpu.species.map((s) => s.name));
      expect(Array.from(sys.state.moleculeId)).toEqual(Array.from(cpu.state.moleculeId));
      // Render topology must match too, or the two backends draw different molecules.
      expect(sys.renderBonds?.i.length ?? 0).toBe(cpu.bonds?.i.length ?? 0);
    });
  }
});

describe("buildSystem covers the whole ladder", () => {
  /** Minimal valid config per level; every level must build its own system, never fall through. */
  const perLevel: Record<AccuracyLevel, Partial<SimConfig>> = {
    L0: { level: "L0", particleCount: 32 },
    L1: { level: "L1", particleCount: 32 },
    L2: { level: "L2", particleCount: 32 },
    L3: {
      level: "L3",
      speciesName: "SODIUM",
      secondSpeciesName: "CHLORIDE",
      fractionSecond: 0.5,
      particleCount: 27,
      boxLength: 1.5,
    },
    L4: {
      level: "L4",
      speciesName: "WATER_O",
      particleCount: 8,
      boxLength: 1.6,
    },
    L5: {
      level: "L5",
      speciesName: "WATER_O",
      particleCount: 8,
      boxLength: 1.7,
    },
    L6: {
      level: "L6",
      speciesName: "WATER_O",
      secondSpeciesName: "OIL_CH3",
      fractionSecond: 0.5,
      particleCount: 8,
      boxLength: 2.4,
    },
    L7: {
      level: "L7",
      speciesName: "WATER_O",
      particleCount: 8,
      boxLength: 3.2,
    },
    L8: {
      level: "L8",
      speciesName: "WATER_O",
      secondSpeciesName: "SODIUM",
      particleCount: 8,
      boxLength: 2,
    },
    L9: { level: "L9", speciesName: "OIL_CH2", particleCount: 4, boxLength: 3 },
    L10: {
      level: "L10",
      speciesName: "OIL_CH2",
      particleCount: 6,
      boxLength: 3,
    },
    L11: {
      level: "L11",
      speciesName: "WATER_O",
      particleCount: 8,
      boxLength: 1.8,
      thermostat: "csvr",
      thermostatTau: 1,
    },
  };

  it("builds every declared accuracy level", () => {
    for (const level of Object.keys(ACCURACY_LEVELS) as AccuracyLevel[]) {
      const sys = buildSystem({ ...base, ...perLevel[level] });
      expect(sys.state.count, level).toBeGreaterThan(0);
    }
  });

  it("expands molecular levels into their atoms rather than falling through to monatomic", () => {
    // A fall-through would silently produce `particleCount` bare atoms with no topology.
    const alkane = buildSystem({ ...base, ...perLevel.L9 });
    expect(alkane.state.count).toBe(4 * 9); // chains × united-atom carbons
    expect(alkane.molecular).toBe(true);

    const morse = buildSystem({ ...base, ...perLevel.L10 });
    expect(morse.state.count).toBe(6 * 2); // diatomic molecules
    expect(morse.molecular).toBe(true);

    const water = buildSystem({ ...base, ...perLevel.L4 });
    expect(water.state.count).toBe(8 * 3); // O + 2H
  });

  it("carries the topology each level's physics needs", () => {
    // L9 is defined by its Ryckaert-Bellemans torsions: losing them removes the whole point.
    const alkane = buildSystem({ ...base, ...perLevel.L9 });
    expect(alkane.dihedrals.i.length).toBeGreaterThan(0);
    expect(alkane.dihedrals.c.length).toBe(6 * alkane.dihedrals.i.length);

    // L10 is defined by anharmonic (dissociable) bonds: morseA > 0 distinguishes them.
    const morse = buildSystem({ ...base, ...perLevel.L10 });
    expect(morse.bonds.i.length).toBe(6);
    expect(morse.bonds.morseA).toBeDefined();
    expect(Array.from(morse.bonds.morseA ?? [])).toSatisfy((values: number[]) =>
      values.every((a) => a > 0),
    );

    // Rigid levels are held by constraints, not springs.
    const rigid = buildSystem({ ...base, ...perLevel.L5 });
    expect(rigid.constraints.i.length).toBeGreaterThan(0);
    expect(rigid.bonds.i.length).toBe(0);
  });

  it("packs GPU topology from the canonical system without losing counts", () => {
    const oil = buildSystem({ ...base, ...perLevel.L6 });
    const gpu = toGpuTopology(oil);
    expect(gpu.bonds.i.length).toBe(oil.bonds.i.length);
    expect(gpu.angles.i.length).toBe(oil.angles.i.length);
    expect(gpu.constraints.i.length).toBe(oil.constraints.i.length);
    expect(gpu.bonds.r0).toBeInstanceOf(Float32Array);
    expect(oil.bonds.r0).toBeInstanceOf(Float64Array);
  });
});
