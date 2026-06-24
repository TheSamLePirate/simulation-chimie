import { describe, expect, it } from "vitest";
import type { SimConfig } from "../engine/types";
import { SCENES } from "./registry";

const byId = (id: string) => {
  const s = SCENES.find((x) => x.id === id);
  if (!s) throw new Error(`scene ${id} missing`);
  return s;
};

describe("scene registry", () => {
  it("every scene config defines the optional fields (so the store merge can't leak them)", () => {
    // The store loads a scene with `{...prevConfig, ...scene.config}`. If a scene omitted
    // `initialClump`, a previous scene's `true` would persist — packing a tight ionic crystal
    // into a clump larger than its box ⇒ overlaps ⇒ blow-up. Every scene must pin both keys.
    for (const scene of SCENES) {
      expect("initialClump" in scene.config).toBe(true);
      expect("initialTemperature" in scene.config).toBe(true);
    }
  });

  it("does not leak a clump start from Liquide into NaCl when merged like the store does", () => {
    const merged: SimConfig = {
      ...byId("lj-liquid").config,
      ...byId("nacl").config,
    };
    expect(byId("lj-liquid").config.initialClump).toBe(true); // the source of the leak
    expect(merged.initialClump).toBeUndefined(); // NaCl must reset it
    expect(merged.level).toBe("L3");
  });
});
