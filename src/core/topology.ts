/**
 * Nonbonded pair policy derived from the bond graph.
 *
 * Molecule identity is NOT a pair policy: two atoms of one molecule may be bonded neighbours
 * (excluded) or distant along the chain (fully interacting). Excluding every same-molecule pair
 * happens to be right for ≤4-atom molecules (water, propane, diatomics) but deletes the
 * intrachain excluded volume that makes a real chain fold — so the policy is stated explicitly
 * here and derived from the topology instead.
 */

/** Atom pairs joined by a fixed distance (bonds or rigid constraints both bond the graph). */
export interface PairGraph {
  readonly i: Int32Array;
  readonly j: Int32Array;
}

/**
 * TraPPE-UA: "intramolecular Lennard-Jones interactions are computed only for beads separated by
 * more than three bonds" (Martin & Siepmann 1998). 1-2, 1-3 and 1-4 are therefore excluded
 * outright — the Ryckaert-Bellemans torsion is fitted with the 1-4 LJ already removed, so
 * re-adding it (scaled or not) would double-count. SPC/Fw water excludes its whole 3-site
 * molecule, which the same depth-3 rule reproduces.
 *
 * No model in this project uses OPLS-style scaled 1-4 pairs; if one is added, it belongs here as
 * an explicit per-force-field policy rather than a global constant.
 */
export const EXCLUDED_BOND_DEPTH = 3;

export interface NonbondedExclusions {
  /** Packed `min·atomCount + max` keys of pairs that must skip all nonbonded interaction. */
  readonly excluded: ReadonlySet<number>;
  readonly atomCount: number;
  /**
   * True when every pair inside every molecule is excluded — i.e. no molecule holds two atoms
   * more than {@link EXCLUDED_BOND_DEPTH} bonds apart. Only then is "skip same-molecule pairs"
   * exactly this policy, which is what lets the GPU keep that cheap test.
   */
  readonly allIntramolecularExcluded: boolean;
}

function key(atomCount: number, a: number, b: number): number {
  return a < b ? a * atomCount + b : b * atomCount + a;
}

/** Adjacency built from every fixed-distance pair (springs and constraints alike). */
function adjacency(atomCount: number, ...graphs: PairGraph[]): number[][] {
  const adjacent: number[][] = Array.from({ length: atomCount }, () => []);
  for (const graph of graphs) {
    for (let b = 0; b < graph.i.length; b++) {
      const a = graph.i[b];
      const c = graph.j[b];
      if (a === c) continue;
      adjacent[a].push(c);
      adjacent[c].push(a);
    }
  }
  return adjacent;
}

/**
 * Bond-hop distance between two atoms (1 = bonded, 2 = angle, 3 = torsion, ∞ = unconnected).
 * Intended for tests and topology assertions, not the force hot path.
 */
export function pairSeparation(
  atomCount: number,
  ...graphs: PairGraph[]
): (a: number, b: number) => number {
  const adjacent = adjacency(atomCount, ...graphs);
  return (a, b) => {
    if (a === b) return 0;
    const seen = new Uint8Array(atomCount);
    let frontier = [a];
    seen[a] = 1;
    for (let depth = 1; frontier.length > 0; depth++) {
      const next: number[] = [];
      for (const atom of frontier) {
        for (const neighbour of adjacent[atom]) {
          if (seen[neighbour]) continue;
          if (neighbour === b) return depth;
          seen[neighbour] = 1;
          next.push(neighbour);
        }
      }
      frontier = next;
    }
    return Number.POSITIVE_INFINITY;
  };
}

/**
 * Enumerate the excluded pairs by walking the bond graph out to {@link EXCLUDED_BOND_DEPTH} from
 * every atom. Pass bonds and constraints: rigid molecules carry no springs, and ignoring their
 * constraints would leave a molecule's own atoms interacting through LJ/Coulomb.
 */
export function buildExclusions(
  atomCount: number,
  bonds: PairGraph,
  constraints?: PairGraph,
): NonbondedExclusions {
  const adjacent = constraints
    ? adjacency(atomCount, bonds, constraints)
    : adjacency(atomCount, bonds);
  const excluded = new Set<number>();

  // Breadth-first to depth 3 from each atom; every atom reached is an excluded partner.
  const seen = new Int32Array(atomCount).fill(-1);
  for (let start = 0; start < atomCount; start++) {
    let frontier = [start];
    seen[start] = start;
    for (let depth = 0; depth < EXCLUDED_BOND_DEPTH && frontier.length > 0; depth++) {
      const next: number[] = [];
      for (const atom of frontier) {
        for (const neighbour of adjacent[atom]) {
          if (seen[neighbour] === start) continue;
          seen[neighbour] = start;
          excluded.add(key(atomCount, start, neighbour));
          next.push(neighbour);
        }
      }
      frontier = next;
    }
  }

  return {
    excluded,
    atomCount,
    allIntramolecularExcluded: allPairsWithinDepth(atomCount, adjacent, excluded),
  };
}

/** Does any molecule hold two atoms further apart than the excluded depth? */
function allPairsWithinDepth(
  atomCount: number,
  adjacent: number[][],
  excluded: ReadonlySet<number>,
): boolean {
  // Walk each connected component (= molecule) and check every internal pair is excluded.
  const component = new Int32Array(atomCount).fill(-1);
  for (let start = 0; start < atomCount; start++) {
    if (component[start] !== -1) continue;
    const members: number[] = [start];
    component[start] = start;
    for (let head = 0; head < members.length; head++) {
      for (const neighbour of adjacent[members[head]]) {
        if (component[neighbour] !== -1) continue;
        component[neighbour] = start;
        members.push(neighbour);
      }
    }
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        if (!excluded.has(key(atomCount, members[a], members[b]))) return false;
      }
    }
  }
  return true;
}

/** Is this nonbonded pair excluded by the topology? */
export function isExcluded(policy: NonbondedExclusions, a: number, b: number): boolean {
  return policy.excluded.has(key(policy.atomCount, a, b));
}
