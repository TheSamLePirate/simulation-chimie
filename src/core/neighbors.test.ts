import { describe, expect, it } from "vitest";
import { createBoxXYZ } from "./box";
import { forEachPositionNeighborPair } from "./neighbors";

function brutePairs(positions: Float64Array, lengths: readonly number[], cutoff: number) {
  const count = positions.length / 3;
  const pairs: string[] = [];
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      let r2 = 0;
      for (let c = 0; c < 3; c++) {
        let delta = positions[3 * i + c] - positions[3 * j + c];
        delta -= lengths[c] * Math.round(delta / lengths[c]);
        r2 += delta * delta;
      }
      if (r2 < cutoff * cutoff && r2 > 1e-12) pairs.push(`${i}:${j}`);
    }
  }
  return pairs;
}

describe("linked-cell neighbor enumeration", () => {
  it.each([
    [3.2, 3.2, 10, 1.2],
    [2, 2, 2, 1.2],
    [2, 2, 2, 3],
  ])("matches brute force without duplicates for box %s×%s×%s cutoff %s", (lx, ly, lz, cutoff) => {
    const box = createBoxXYZ(lx, ly, lz, "periodic");
    const count = 80;
    const positions = new Float64Array(3 * count);
    for (let i = 0; i < count; i++) {
      positions[3 * i] = (((i * 37) % 101) / 101 - 0.5) * lx;
      positions[3 * i + 1] = (((i * 53 + 7) % 103) / 103 - 0.5) * ly;
      positions[3 * i + 2] = (((i * 71 + 11) % 107) / 107 - 0.5) * lz;
    }
    // Exercise a virtual site just outside the primary cell.
    positions[0] += lx;
    const actual: string[] = [];
    forEachPositionNeighborPair(count, positions, box, cutoff, (i, j) => actual.push(`${i}:${j}`));
    expect(actual.sort()).toEqual(brutePairs(positions, box.lengths, cutoff).sort());
    expect(new Set(actual).size).toBe(actual.length);
  });

  it("rejects a non-positive cutoff", () => {
    expect(() =>
      forEachPositionNeighborPair(2, new Float64Array(6), createBoxXYZ(2, 2, 2), 0, () => {}),
    ).toThrow(/positive/);
  });
});
