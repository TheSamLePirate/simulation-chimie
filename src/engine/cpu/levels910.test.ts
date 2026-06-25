import { describe, expect, it } from "vitest";
import type { SimConfig } from "../types";
import { CpuEngine } from "./CpuEngine";

const base: SimConfig = {
  seed: 3,
  particleCount: 8,
  boxLength: 6,
  boundary: "periodic",
  temperature: 450,
  timestep: 0.001,
  level: "L9",
  speciesName: "OIL_CH2",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "csvr",
  thermostatTau: 0.1,
  barostat: "none",
  pressureTarget: 1,
  gravity: 0,
  engineKind: "cpu",
};

function allFinite(a: ArrayLike<number>): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

describe("L9 alkane (dihedrals)", () => {
  it("builds 8 chains × 9 carbons with bonds/angles/dihedrals and runs stably", () => {
    const e = new CpuEngine(base);
    expect(e.state.count).toBe(8 * 9);
    expect(e.bonds).not.toBeNull();
    expect(e.bonds?.i.length).toBe(8 * 8); // 8 bonds per 9-carbon chain
    e.step(2000);
    expect(allFinite(e.state.positions)).toBe(true);
    // Stays near the target (the dihedrals don't pump energy in).
    expect(e.observables().temperature).toBeGreaterThan(250);
    expect(e.observables().temperature).toBeLessThan(700);
  });

  it("samples both trans and gauche dihedrals once warm (conformational change)", () => {
    const e = new CpuEngine(base);
    e.step(3000);
    // Measure the central dihedral of the first chain over time; it must leave pure trans.
    const p = e.state.positions;
    const dihedral = (a: number, b: number, c: number, d: number): number => {
      const v = (x: number, y: number) => [
        p[3 * x] - p[3 * y],
        p[3 * x + 1] - p[3 * y + 1],
        p[3 * x + 2] - p[3 * y + 2],
      ];
      const [bx, by, bz] = v(a, b);
      const [cx, cy, cz] = v(c, b);
      const [dx, dy, dz] = v(c, d);
      const m = [by * cz - bz * cy, bz * cx - bx * cz, bx * cy - by * cx];
      const nn = [cy * dz - cz * dy, cz * dx - cx * dz, cx * dy - cy * dx];
      const dot = m[0] * nn[0] + m[1] * nn[1] + m[2] * nn[2];
      const mag = Math.hypot(...m) * Math.hypot(...nn);
      return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
    };
    let sawNonTrans = false;
    for (let s = 0; s < 200; s++) {
      e.step(20);
      if (dihedral(3, 4, 5, 6) < 150) sawNonTrans = true; // left the trans (≈180°) basin
    }
    expect(sawNonTrans).toBe(true);
  });
});

describe("L10 Morse dissociation", () => {
  const cfg: SimConfig = {
    ...base,
    level: "L10",
    particleCount: 32,
    boxLength: 4.5,
    boundary: "reflective",
    initialTemperature: 60,
    temperature: 1200,
    timestep: 0.002,
    thermostat: "berendsen",
    thermostatTau: 0.4,
  };

  it("builds diatomics and breaks bonds when heated past the well", () => {
    const e = new CpuEngine(cfg);
    expect(e.state.count).toBe(64); // 32 molecules × 2 atoms
    // Initial bond lengths ≈ r0 (0.14 nm).
    const len = (m: number) => {
      const p = e.state.positions;
      return Math.hypot(
        p[6 * m] - p[6 * m + 3],
        p[6 * m + 1] - p[6 * m + 4],
        p[6 * m + 2] - p[6 * m + 5],
      );
    };
    expect(len(0)).toBeLessThan(0.2);
    e.step(8000); // heat to 1200 K ⇒ bonds dissociate
    expect(allFinite(e.state.positions)).toBe(true);
    // Count broken bonds (stretched well past r0): at least some molecules dissociate.
    let broken = 0;
    for (let m = 0; m < 32; m++) if (len(m) > 0.4) broken++;
    expect(broken).toBeGreaterThan(0);
  });
});
