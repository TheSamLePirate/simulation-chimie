import { describe, expect, it } from "vitest";
import { WATER_BOND_R0, WATER_HH } from "../../core/water";
import type { SimConfig } from "../types";
import { CpuEngine } from "./CpuEngine";

const CONFIG: SimConfig = {
  seed: 4,
  particleCount: 64, // molecules
  boxLength: 1.3,
  boundary: "periodic",
  temperature: 300,
  timestep: 0.002, // 2 fs — only possible because bonds are rigid
  level: "L5",
  speciesName: "WATER_O",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "berendsen",
  thermostatTau: 0.2,
  barostat: "none",
  pressureTarget: 1,
  gravity: 0,
  engineKind: "cpu",
};

function minImageDist(pos: Float64Array, a: number, b: number, l: number): number {
  let dx = pos[3 * a] - pos[3 * b];
  let dy = pos[3 * a + 1] - pos[3 * b + 1];
  let dz = pos[3 * a + 2] - pos[3 * b + 2];
  dx -= l * Math.round(dx / l);
  dy -= l * Math.round(dy / l);
  dz -= l * Math.round(dz / l);
  return Math.hypot(dx, dy, dz);
}

describe("rigid water (L5) — SHAKE/RATTLE constraints", () => {
  it("holds O–H and H–H distances fixed over a long run at 2 fs", () => {
    const engine = new CpuEngine(CONFIG);
    engine.step(2000);

    const pos = engine.state.positions;
    const l = engine.box.lengths[0];
    let maxBondErr = 0;
    let maxHHErr = 0;
    for (let m = 0; m < 64; m++) {
      const o = 3 * m;
      const h1 = 3 * m + 1;
      const h2 = 3 * m + 2;
      maxBondErr = Math.max(maxBondErr, Math.abs(minImageDist(pos, o, h1, l) - WATER_BOND_R0));
      maxBondErr = Math.max(maxBondErr, Math.abs(minImageDist(pos, o, h2, l) - WATER_BOND_R0));
      maxHHErr = Math.max(maxHHErr, Math.abs(minImageDist(pos, h1, h2, l) - WATER_HH));
    }
    expect(pos.every((x) => Number.isFinite(x))).toBe(true);
    expect(maxBondErr).toBeLessThan(1e-4);
    expect(maxHHErr).toBeLessThan(1e-4);

    const t = engine.observables().temperature;
    expect(t).toBeGreaterThan(150);
    expect(t).toBeLessThan(500);
  }, 20_000);
});
