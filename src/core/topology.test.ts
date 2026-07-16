import { describe, expect, it } from "vitest";
import { buildExclusions, EXCLUDED_BOND_DEPTH, isExcluded, pairSeparation } from "./topology";

/** A linear chain 0–1–2–…–(n−1), the topology of a united-atom alkane. */
function chain(n: number) {
  const i: number[] = [];
  const j: number[] = [];
  for (let c = 0; c < n - 1; c++) {
    i.push(c);
    j.push(c + 1);
  }
  return { i: Int32Array.from(i), j: Int32Array.from(j) };
}

describe("bond-graph pair separation", () => {
  it("counts bond hops between atoms of a chain", () => {
    const sep = pairSeparation(5, chain(5));
    expect(sep(0, 1)).toBe(1); // 1–2
    expect(sep(0, 2)).toBe(2); // 1–3
    expect(sep(0, 3)).toBe(3); // 1–4
    expect(sep(0, 4)).toBe(4); // 1–5
    expect(sep(1, 4)).toBe(3);
  });

  it("reports unbonded atoms as unreachable", () => {
    const sep = pairSeparation(4, {
      i: Int32Array.from([0]),
      j: Int32Array.from([1]),
    });
    expect(sep(0, 1)).toBe(1);
    expect(sep(0, 2)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("TraPPE exclusion policy", () => {
  it("excludes 1-2, 1-3 and 1-4, but keeps 1-5 and beyond", () => {
    // TraPPE-UA: "intramolecular LJ is computed only for beads separated by more than three
    // bonds" — its RB torsion is parameterised with the 1-4 LJ removed, so restoring a 1-4
    // interaction would double-count.
    expect(EXCLUDED_BOND_DEPTH).toBe(3);
    const nonane = buildExclusions(9, chain(9));

    expect(isExcluded(nonane, 0, 1)).toBe(true); // 1-2 bonded
    expect(isExcluded(nonane, 0, 2)).toBe(true); // 1-3 angle
    expect(isExcluded(nonane, 0, 3)).toBe(true); // 1-4 torsion
    expect(isExcluded(nonane, 0, 4)).toBe(false); // 1-5 — full LJ
    expect(isExcluded(nonane, 0, 8)).toBe(false); // chain ends see each other
    expect(isExcluded(nonane, 2, 6)).toBe(false);
  });

  it("is symmetric and never excludes across separate molecules", () => {
    // Two independent 3-atom molecules: 0-1-2 and 3-4-5.
    const bonds = {
      i: Int32Array.from([0, 1, 3, 4]),
      j: Int32Array.from([1, 2, 4, 5]),
    };
    const ex = buildExclusions(6, bonds);
    expect(isExcluded(ex, 0, 2)).toBe(true);
    expect(isExcluded(ex, 2, 0)).toBe(true);
    expect(isExcluded(ex, 0, 3)).toBe(false);
    expect(isExcluded(ex, 2, 5)).toBe(false);
  });

  it("reports whether a blanket same-molecule exclusion is equivalent", () => {
    // ≤4-atom molecules: every intramolecular pair is within 3 bonds, so excluding the whole
    // molecule is exactly the TraPPE answer. This is what lets the GPU keep its fast path.
    const water = buildExclusions(3, {
      i: Int32Array.from([0, 0, 1]),
      j: Int32Array.from([1, 2, 2]),
    });
    expect(water.allIntramolecularExcluded).toBe(true);

    const butane = buildExclusions(4, chain(4));
    expect(butane.allIntramolecularExcluded).toBe(true);

    // A 5-atom chain has a 1-5 pair that must interact ⇒ blanket exclusion is NOT equivalent.
    const pentane = buildExclusions(5, chain(5));
    expect(pentane.allIntramolecularExcluded).toBe(false);
  });

  it("restores the intrachain excluded volume a nonane chain needs", () => {
    // Two carbons 4 bonds apart, folded to within LJ range. Under the old molecule-wide rule
    // they saw nothing and the chain could pass through itself; TraPPE gives them full LJ.
    const nonane = buildExclusions(9, chain(9));
    let interacting = 0;
    for (let a = 0; a < 9; a++) {
      for (let b = a + 1; b < 9; b++) if (!isExcluded(nonane, a, b)) interacting++;
    }
    // 36 intrachain pairs total; 8 (1-2) + 7 (1-3) + 6 (1-4) = 21 excluded ⇒ 15 must interact.
    expect(interacting).toBe(15);
  });

  it("derives the graph from constraints too, so rigid water stays excluded", () => {
    // Rigid water carries no spring bonds — only O–H, O–H, H–H constraints. Ignoring those
    // would let a molecule's own O and H interact via LJ/Coulomb.
    const rigidWater = buildExclusions(
      3,
      {
        i: Int32Array.from([]),
        j: Int32Array.from([]),
      },
      { i: Int32Array.from([0, 0, 1]), j: Int32Array.from([1, 2, 2]) },
    );
    expect(isExcluded(rigidWater, 0, 1)).toBe(true);
    expect(isExcluded(rigidWater, 1, 2)).toBe(true);
    expect(rigidWater.allIntramolecularExcluded).toBe(true);
  });
});
