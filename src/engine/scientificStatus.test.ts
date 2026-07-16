import { describe, expect, it } from "vitest";
import {
  containUnsafeScientificConfig,
  energyUnavailableReason,
  hasRigidConstraints,
  isMolecularLevel,
  pressureUnavailableReason,
  SCIENTIFIC_STATUS_BY_LEVEL,
  scientificSafetyIssues,
} from "./scientificStatus";
import type { SimConfig } from "./types";

const BASE: SimConfig = {
  seed: 1,
  particleCount: 64,
  boxLength: 3,
  boundary: "periodic",
  temperature: 300,
  timestep: 0.002,
  level: "L1",
  speciesName: "ARGON",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "csvr",
  thermostatTau: 1,
  barostat: "none",
  pressureTarget: 1,
  gravity: 0,
  engineKind: "cpu",
};

describe("P64 scientific containment", () => {
  it("classifies molecular and constrained levels", () => {
    expect(isMolecularLevel("L3")).toBe(false);
    expect(isMolecularLevel("L4")).toBe(true);
    expect(isMolecularLevel("L11")).toBe(true);
    expect(hasRigidConstraints("L4")).toBe(false);
    expect(hasRigidConstraints("L5")).toBe(true);
    expect(hasRigidConstraints("L6")).toBe(true);
    expect(hasRigidConstraints("L11")).toBe(true);
  });

  it("rejects molecular NPT and constrained Langevin as uncertified", () => {
    const npt = scientificSafetyIssues({
      ...BASE,
      level: "L4",
      barostat: "berendsen",
    });
    expect(npt.map((issue) => issue.code)).toContain("molecular-npt-uncertified");

    const langevin = scientificSafetyIssues({
      ...BASE,
      level: "L5",
      thermostat: "langevin",
    });
    expect(langevin.map((issue) => issue.code)).toContain("constrained-langevin-uncertified");
  });

  it("contains unsafe runtime patches using certified fallbacks", () => {
    const contained = containUnsafeScientificConfig({
      ...BASE,
      level: "L7",
      thermostat: "langevin",
      barostat: "berendsen",
    });
    expect(contained.thermostat).toBe("csvr");
    expect(contained.barostat).toBe("none");
  });

  it("marks incomplete observables unavailable instead of publishing misleading numbers", () => {
    expect(pressureUnavailableReason({ ...BASE, level: "L5" })).toMatch(/contraintes/i);
    expect(pressureUnavailableReason({ ...BASE, level: "L11" })).toMatch(/L11/i);
    expect(pressureUnavailableReason({ ...BASE, level: "L2" })).toBeNull();

    expect(energyUnavailableReason({ ...BASE, level: "L4", engineKind: "gpu" })).toMatch(/liés/i);
    expect(energyUnavailableReason({ ...BASE, level: "L4", engineKind: "cpu" })).toBeNull();
  });

  it("labels only locally validated kernels as such and keeps molecular demos unaccepted", () => {
    expect(SCIENTIFIC_STATUS_BY_LEVEL.L2).toBe("kernel-validated");
    expect(SCIENTIFIC_STATUS_BY_LEVEL.L5).toBe("demo");
    expect(SCIENTIFIC_STATUS_BY_LEVEL.L11).toBe("kernel-validated");
    expect(Object.values(SCIENTIFIC_STATUS_BY_LEVEL)).not.toContain("accepted");
  });
});
