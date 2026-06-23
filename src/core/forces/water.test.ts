import { describe, expect, it } from "vitest";
import { CpuEngine } from "../../engine/cpu/CpuEngine";
import type { SimConfig } from "../../engine/types";
import { createBox } from "../box";
import { WATER_H, WATER_O } from "../species";
import { createState } from "../state";
import type { SimState } from "../types";
import { WATER_BOND_R0, type WaterTopology } from "../water";
import { WaterForce } from "./water";

const SPECIES = [WATER_O, WATER_H];
const BIG_BOX = createBox(100, "reflective"); // isolate bonded terms (no min-image)

const EMPTY = new Int32Array(0);

/** Numeric gradient check: force component == −dV/d(coord). */
function checkGradient(force: WaterForce, base: SimState, atom: number, comp: number): void {
  const idx = 3 * atom + comp;
  const h = 1e-6;
  const potAt = (delta: number) => {
    const s = cloneWith(base, idx, delta);
    return force.compute(s, BIG_BOX, SPECIES).potentialEnergy;
  };
  const numeric = -(potAt(h) - potAt(-h)) / (2 * h);
  const s = cloneWith(base, idx, 0);
  force.compute(s, BIG_BOX, SPECIES);
  expect(s.forces[idx]).toBeCloseTo(numeric, 2);
}

function cloneWith(base: SimState, idx: number, delta: number): SimState {
  const s = createState(base.count, base.typeIds.slice(), base.moleculeId.slice());
  s.positions.set(base.positions);
  s.positions[idx] += delta;
  return s;
}

describe("WaterForce bonded terms vs numerical gradient", () => {
  it("harmonic O–H bond force matches −dV/dr", () => {
    const topo: WaterTopology = {
      bondI: Int32Array.from([0]),
      bondJ: Int32Array.from([1]),
      angleI: EMPTY,
      angleJ: EMPTY,
      angleK: EMPTY,
    };
    const force = new WaterForce(topo);
    const state = createState(2, Uint8Array.from([0, 1]), Int32Array.from([0, 0]));
    state.positions[3] = WATER_BOND_R0 + 0.02; // H stretched along x
    checkGradient(force, state, 0, 0);
    checkGradient(force, state, 1, 0);
  });

  it("harmonic H–O–H angle force matches −dV/d(position)", () => {
    const topo: WaterTopology = {
      bondI: EMPTY,
      bondJ: EMPTY,
      angleI: Int32Array.from([1]),
      angleJ: Int32Array.from([0]), // central O
      angleK: Int32Array.from([2]),
    };
    const force = new WaterForce(topo);
    const state = createState(3, Uint8Array.from([0, 1, 1]), Int32Array.from([0, 0, 0]));
    // Bent geometry away from equilibrium.
    state.positions[3] = 0.1; // H1
    state.positions[4] = 0.02;
    state.positions[6] = -0.08; // H2
    state.positions[7] = 0.06;
    checkGradient(force, state, 1, 1);
    checkGradient(force, state, 2, 0);
    checkGradient(force, state, 0, 1);
  });
});

const WATER_CONFIG: SimConfig = {
  seed: 3,
  particleCount: 64, // molecules
  boxLength: 1.3,
  boundary: "periodic",
  temperature: 300,
  timestep: 0.0005,
  level: "L4",
  speciesName: "WATER_O",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "berendsen",
  thermostatTau: 0.2,
  barostat: "none",
  pressureTarget: 1,
  engineKind: "cpu",
};

describe("atomistic water (L4) stability", () => {
  it("stays finite with intact molecules at ~target temperature", () => {
    const engine = new CpuEngine(WATER_CONFIG);
    expect(engine.state.count).toBe(64 * 3);
    engine.step(2000);

    const pos = engine.state.positions;
    expect(pos.every((x) => Number.isFinite(x))).toBe(true);

    // Mean O–H bond length stays near r0 (molecules not torn apart).
    const lx = engine.box.lengths[0];
    let sum = 0;
    for (let m = 0; m < 64; m++) {
      for (const h of [1, 2]) {
        let dxb = pos[9 * m] - pos[9 * m + 3 * h];
        dxb -= lx * Math.round(dxb / lx);
        let dyb = pos[9 * m + 1] - pos[9 * m + 3 * h + 1];
        dyb -= lx * Math.round(dyb / lx);
        let dzb = pos[9 * m + 2] - pos[9 * m + 3 * h + 2];
        dzb -= lx * Math.round(dzb / lx);
        sum += Math.hypot(dxb, dyb, dzb);
      }
    }
    const meanBond = sum / (64 * 2);
    expect(meanBond).toBeGreaterThan(0.085);
    expect(meanBond).toBeLessThan(0.125);

    const t = engine.observables().temperature;
    expect(t).toBeGreaterThan(150);
    expect(t).toBeLessThan(500);
  }, 20_000);
});
