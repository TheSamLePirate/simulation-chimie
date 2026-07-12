import { describe, expect, it } from "vitest";
import { createBoxXYZ } from "../../core/box";
import { TIP4P_2005 } from "../../core/tip4p2005";
import { GpuTip4pPme } from "./GpuTip4pPme";

describe("GPU TIP4P/2005 PME contract", () => {
  it("requires one H1,H2,M charge-site triple per molecule", () => {
    const box = createBoxXYZ(2, 2, 3, "periodic");
    const model = new GpuTip4pPme({
      molecules: 1,
      positions: Float32Array.from([0.07, 0, 0.06, -0.07, 0, 0.06, 0, 0, 0.01546]),
      charges: Float32Array.from([TIP4P_2005.chargeH, TIP4P_2005.chargeH, TIP4P_2005.chargeM]),
      box,
      alpha: 3.5,
      grid: [8, 8, 16],
      slabCorrection: true,
    });
    expect(model.molecules).toBe(1);
    expect(
      () =>
        new GpuTip4pPme({
          molecules: 1,
          positions: new Float32Array(6),
          charges: new Float32Array(3),
          box,
          alpha: 3.5,
          grid: [8, 8, 16],
        }),
    ).toThrow(/triples/);
  });
});
