import { describe, expect, it } from "vitest";
import { iapwsSurfaceTension } from "./referenceSurfaceTension";

describe("IAPWS surface-tension reference", () => {
  it("matches the standard correlation at experiment temperatures", () => {
    expect(iapwsSurfaceTension(280)).toBeCloseTo(74.68, 1);
    expect(iapwsSurfaceTension(300)).toBeCloseTo(71.69, 1);
    expect(iapwsSurfaceTension(340)).toBeCloseTo(65.04, 1);
    expect(iapwsSurfaceTension(647.096)).toBe(0);
  });
});
