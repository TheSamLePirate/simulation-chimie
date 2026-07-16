import { erfc } from "../math/erf";
import { forEachNeighborPair } from "../neighbors";
import { isExcluded, type NonbondedExclusions } from "../topology";
import type { Box, ForceModel, ForceResult, SimState, Species } from "../types";
import { COULOMB_CONSTANT } from "../units";

const LJ_CUTOFF_FACTOR = 2.5;
const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

/**
 * Bonds i–j at r0, stiffness k. Optionally anharmonic (Morse): when `morseA[n] > 0` the bond uses
 * V = Dₑ(1 − e^(−a(r−r₀)))² with Dₑ = k/(2a²) (so the curvature at r₀ matches the harmonic k). The
 * Morse force vanishes as r → ∞ ⇒ the bond can BREAK (dissociation), unlike a harmonic spring.
 */
export interface BondList {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly r0: Float64Array;
  readonly k: Float64Array;
  /** Per-bond Morse width a (nm⁻¹); 0/absent ⇒ harmonic. */
  readonly morseA?: Float64Array;
}

/** Harmonic angles i–j–k (j = vertex) at theta0, stiffness kt. */
export interface AngleList {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly k: Int32Array;
  readonly theta0: Float64Array;
  readonly kt: Float64Array;
}

/**
 * Proper dihedrals i–j–k–l with a Ryckaert-Bellemans potential in the cos(φ) basis:
 * V(φ) = Σ_{n=0}^{5} cn[n]·cosⁿφ, where φ is the i-j-k-l torsion angle. This is what gives alkanes
 * their trans/gauche conformations (rotation about the central bond). Each row's coefficients live
 * in `c0..c5` (kJ·mol⁻¹).
 */
export interface DihedralList {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly k: Int32Array;
  readonly l: Int32Array;
  /** RB coefficients per dihedral: c[n] holds cn (length 6 × count, row-major). */
  readonly c: Float64Array;
}

/**
 * General multi-molecule force field: non-bonded Lennard-Jones (Lorentz-Berthelot mixing)
 * + Coulomb (Wolf DSF) with topology-derived exclusions, plus per-bond harmonic/Morse bonds,
 * per-angle harmonic angles and RB torsions. Atoms held rigid (e.g. SPC water under SHAKE)
 * contribute no bonds/angles here; their exclusions come from the constraint graph.
 *
 * Exclusions follow the bond graph, not molecule identity: a chain's 1-5 and further pairs
 * interact normally (that intrachain excluded volume is what makes a real chain fold), while
 * 1-2/1-3/1-4 are removed. See {@link buildExclusions}.
 *
 * All separations use the minimum image, so per-atom periodic wrapping never tears a
 * molecule apart.
 */
export class MolecularForce implements ForceModel {
  readonly name = "Mélange moléculaire";

  private readonly dihedrals: DihedralList;
  private readonly exclusions: NonbondedExclusions | null;

  constructor(
    private readonly bonds: BondList,
    private readonly angles: AngleList,
    private readonly alpha = 2.5,
    private readonly coulombCutoff = 0.9,
    dihedrals?: DihedralList,
    exclusions?: NonbondedExclusions,
  ) {
    this.dihedrals =
      dihedrals ??
      ({
        i: new Int32Array(0),
        j: new Int32Array(0),
        k: new Int32Array(0),
        l: new Int32Array(0),
        c: new Float64Array(0),
      } satisfies DihedralList);
    this.exclusions = exclusions ?? null;
  }

  /**
   * Should this intramolecular pair skip the nonbonded terms? Only consulted for same-molecule
   * pairs, so the common inter-molecular case stays a single integer compare.
   */
  private excludedPair(i: number, j: number): boolean {
    // Without an explicit policy, fall back to excluding the whole molecule. That is exactly the
    // topology answer for every ≤4-atom molecule (water, propane, diatomics) this force is used
    // with, and callers that build longer chains pass the real policy.
    return this.exclusions ? isExcluded(this.exclusions, i, j) : true;
  }

  compute(state: SimState, box: Box, species: readonly Species[]): ForceResult {
    const { positions, forces, typeIds, moleculeId } = state;
    forces.fill(0);

    const [lx, ly, lz] = box.lengths;
    const periodic = box.boundary === "periodic";
    const min = (d: number, l: number) => (periodic ? d - l * Math.round(d / l) : d);

    const ke = COULOMB_CONSTANT;
    const alpha = this.alpha;
    // Cutoffs must respect the minimum-image limit (≤ L/2), else an atom interacts with a
    // neighbour and its periodic image ⇒ double-counted force ⇒ slow blow-up.
    const minImage = 0.49 * Math.min(lx, ly, lz);
    const rcC = Math.min(this.coulombCutoff, minImage);
    const rcC2 = rcC * rcC;
    const erfcRc = erfc(alpha * rcC);
    const expRc = Math.exp(-alpha * alpha * rcC * rcC);
    const shift = erfcRc / rcC2 + (TWO_OVER_SQRT_PI * alpha * expRc) / rcC;

    let pe = 0;
    let virial = 0;

    let maxSigma = 0;
    for (const s of species) if (s.epsilon > 0) maxSigma = Math.max(maxSigma, s.sigma);
    const gridCutoff = Math.min(minImage, Math.max(rcC, LJ_CUTOFF_FACTOR * maxSigma));

    // --- Non-bonded (LJ Lorentz-Berthelot + Coulomb DSF), topology-excluded (cell-list) ---
    forEachNeighborPair(state, box, gridCutoff, (i, j, dx, dy, dz, r2) => {
      // Exclusions only ever live inside a molecule, so the cheap id compare gates the lookup.
      if (moleculeId[j] === moleculeId[i] && this.excludedPair(i, j)) return;
      const si = species[typeIds[i]];
      const sj = species[typeIds[j]];
      let fOverR = 0;
      let r = -1;

      const epsilon = Math.sqrt(si.epsilon * sj.epsilon);
      if (epsilon > 0) {
        const sigma = 0.5 * (si.sigma + sj.sigma);
        const rcLj = Math.min(LJ_CUTOFF_FACTOR * sigma, minImage);
        if (r2 < rcLj * rcLj) {
          r = Math.sqrt(r2);
          const inv2 = (sigma * sigma) / r2;
          const inv6 = inv2 * inv2 * inv2;
          const inv12 = inv6 * inv6;
          const c2 = (sigma * sigma) / (rcLj * rcLj);
          const c6 = c2 * c2 * c2;
          const c12 = c6 * c6;
          const fAtRc = (24 * epsilon * (2 * c12 - c6)) / rcLj;
          const vAtRc = 4 * epsilon * (c12 - c6);
          fOverR += ((24 * epsilon * (2 * inv12 - inv6)) / r - fAtRc) / r;
          pe += 4 * epsilon * (inv12 - inv6) - vAtRc + (r - rcLj) * fAtRc;
        }
      }

      const qq = si.charge * sj.charge;
      if (qq !== 0 && r2 < rcC2) {
        if (r < 0) r = Math.sqrt(r2);
        const erfcR = erfc(alpha * r);
        const expR = Math.exp(-alpha * alpha * r2);
        const fCoul = ke * qq * (erfcR / r2 + (TWO_OVER_SQRT_PI * alpha * expR) / r - shift);
        fOverR += fCoul / r;
        pe += ke * qq * (erfcR / r - erfcRc / rcC + shift * (r - rcC));
      }

      if (fOverR !== 0) {
        forces[3 * i] += fOverR * dx;
        forces[3 * i + 1] += fOverR * dy;
        forces[3 * i + 2] += fOverR * dz;
        forces[3 * j] -= fOverR * dx;
        forces[3 * j + 1] -= fOverR * dy;
        forces[3 * j + 2] -= fOverR * dz;
        virial += fOverR * r2;
      }
    });

    // --- Harmonic bonds ---
    const b = this.bonds;
    for (let n = 0; n < b.i.length; n++) {
      const i = b.i[n];
      const j = b.j[n];
      const dx = min(positions[3 * i] - positions[3 * j], lx);
      const dy = min(positions[3 * i + 1] - positions[3 * j + 1], ly);
      const dz = min(positions[3 * i + 2] - positions[3 * j + 2], lz);
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (r < 1e-9) continue;
      const dr = r - b.r0[n];
      const a = b.morseA?.[n] ?? 0;
      let fOverR: number;
      if (a > 0) {
        // Morse: V = Dₑ(1−e^(−a·dr))², Dₑ = k/(2a²). F = −dV/dr = −2Dₑ·a·e^(−a·dr)(1−e^(−a·dr)).
        const de = b.k[n] / (2 * a * a);
        const e = Math.exp(-a * dr);
        pe += de * (1 - e) * (1 - e);
        const dVdr = 2 * de * a * e * (1 - e);
        fOverR = -dVdr / r;
      } else {
        pe += 0.5 * b.k[n] * dr * dr;
        fOverR = (-b.k[n] * dr) / r;
      }
      forces[3 * i] += fOverR * dx;
      forces[3 * i + 1] += fOverR * dy;
      forces[3 * i + 2] += fOverR * dz;
      forces[3 * j] -= fOverR * dx;
      forces[3 * j + 1] -= fOverR * dy;
      forces[3 * j + 2] -= fOverR * dz;
      virial += fOverR * r * r;
    }

    // --- Harmonic angles (j = vertex) ---
    const a = this.angles;
    for (let n = 0; n < a.j.length; n++) {
      const i = a.i[n];
      const j = a.j[n];
      const k = a.k[n];
      const rijx = min(positions[3 * i] - positions[3 * j], lx);
      const rijy = min(positions[3 * i + 1] - positions[3 * j + 1], ly);
      const rijz = min(positions[3 * i + 2] - positions[3 * j + 2], lz);
      const rkjx = min(positions[3 * k] - positions[3 * j], lx);
      const rkjy = min(positions[3 * k + 1] - positions[3 * j + 1], ly);
      const rkjz = min(positions[3 * k + 2] - positions[3 * j + 2], lz);
      const lij = Math.hypot(rijx, rijy, rijz);
      const lkj = Math.hypot(rkjx, rkjy, rkjz);
      if (lij < 1e-9 || lkj < 1e-9) continue;
      let cosT = (rijx * rkjx + rijy * rkjy + rijz * rkjz) / (lij * lkj);
      cosT = Math.max(-1, Math.min(1, cosT));
      const theta = Math.acos(cosT);
      const sinT = Math.max(Math.sin(theta), 1e-8);
      const dVdTheta = a.kt[n] * (theta - a.theta0[n]);
      pe += 0.5 * a.kt[n] * (theta - a.theta0[n]) ** 2;
      const factor = dVdTheta / sinT;

      const fix = factor * (rkjx / (lij * lkj) - (cosT * rijx) / (lij * lij));
      const fiy = factor * (rkjy / (lij * lkj) - (cosT * rijy) / (lij * lij));
      const fiz = factor * (rkjz / (lij * lkj) - (cosT * rijz) / (lij * lij));
      const fkx = factor * (rijx / (lij * lkj) - (cosT * rkjx) / (lkj * lkj));
      const fky = factor * (rijy / (lij * lkj) - (cosT * rkjy) / (lkj * lkj));
      const fkz = factor * (rijz / (lij * lkj) - (cosT * rkjz) / (lkj * lkj));

      forces[3 * i] += fix;
      forces[3 * i + 1] += fiy;
      forces[3 * i + 2] += fiz;
      forces[3 * k] += fkx;
      forces[3 * k + 1] += fky;
      forces[3 * k + 2] += fkz;
      forces[3 * j] -= fix + fkx;
      forces[3 * j + 1] -= fiy + fky;
      forces[3 * j + 2] -= fiz + fkz;
    }

    // --- Proper dihedrals (Ryckaert-Bellemans), force via the standard GROMACS gradient ---
    const d = this.dihedrals;
    for (let n = 0; n < d.i.length; n++) {
      const i = d.i[n];
      const j = d.j[n];
      const k = d.k[n];
      const l = d.l[n];
      // r_ij = r_i − r_j, r_kj = r_k − r_j, r_kl = r_k − r_l (minimum image).
      const ijx = min(positions[3 * i] - positions[3 * j], lx);
      const ijy = min(positions[3 * i + 1] - positions[3 * j + 1], ly);
      const ijz = min(positions[3 * i + 2] - positions[3 * j + 2], lz);
      const kjx = min(positions[3 * k] - positions[3 * j], lx);
      const kjy = min(positions[3 * k + 1] - positions[3 * j + 1], ly);
      const kjz = min(positions[3 * k + 2] - positions[3 * j + 2], lz);
      const klx = min(positions[3 * k] - positions[3 * l], lx);
      const kly = min(positions[3 * k + 1] - positions[3 * l + 1], ly);
      const klz = min(positions[3 * k + 2] - positions[3 * l + 2], lz);
      // m = r_ij × r_kj, nv = r_kj × r_kl (plane normals).
      const mx = ijy * kjz - ijz * kjy;
      const my = ijz * kjx - ijx * kjz;
      const mz = ijx * kjy - ijy * kjx;
      const nx = kjy * klz - kjz * kly;
      const ny = kjz * klx - kjx * klz;
      const nz = kjx * kly - kjy * klx;
      const m2 = mx * mx + my * my + mz * mz;
      const n2 = nx * nx + ny * ny + nz * nz;
      const kjLen = Math.hypot(kjx, kjy, kjz);
      if (m2 < 1e-12 || n2 < 1e-12 || kjLen < 1e-9) continue; // collinear ⇒ undefined torsion
      const mLen = Math.sqrt(m2);
      const nLen = Math.sqrt(n2);
      let cosP = (mx * nx + my * ny + mz * nz) / (mLen * nLen);
      cosP = Math.max(-1, Math.min(1, cosP));
      // sinφ from (m × n)·r_kj, signed.
      const sinP =
        ((my * nz - mz * ny) * kjx + (mz * nx - mx * nz) * kjy + (mx * ny - my * nx) * kjz) /
        (mLen * nLen * kjLen);
      // V(φ) = Σ c_p cosᵖφ ; dV/dφ = −sinφ·Σ p·c_p cosᵖ⁻¹φ.
      let v = 0;
      let dVdcos = 0;
      let cp = 1; // cosᵖφ
      for (let p = 0; p < 6; p++) {
        const cn = d.c[6 * n + p];
        v += cn * cp;
        if (p > 0) dVdcos += (p * cn * cp) / cosP; // p·c_p·cosᵖ⁻¹
        cp *= cosP;
      }
      pe += v;
      const dVdphi = -sinP * dVdcos;
      // GROMACS dihedral forces (momentum-conserving): F_i, F_l from the normals; F_j, F_k balance.
      const fiC = (-dVdphi * kjLen) / m2;
      const flC = (dVdphi * kjLen) / n2;
      const fix = fiC * mx;
      const fiy = fiC * my;
      const fiz = fiC * mz;
      const flx = flC * nx;
      const fly = flC * ny;
      const flz = flC * nz;
      const pCoef = (ijx * kjx + ijy * kjy + ijz * kjz) / (kjLen * kjLen);
      const qCoef = (klx * kjx + kly * kjy + klz * kjz) / (kjLen * kjLen);
      const fjx = (pCoef - 1) * fix - qCoef * flx;
      const fjy = (pCoef - 1) * fiy - qCoef * fly;
      const fjz = (pCoef - 1) * fiz - qCoef * flz;
      const fkx = (qCoef - 1) * flx - pCoef * fix;
      const fky = (qCoef - 1) * fly - pCoef * fiy;
      const fkz = (qCoef - 1) * flz - pCoef * fiz;
      forces[3 * i] += fix;
      forces[3 * i + 1] += fiy;
      forces[3 * i + 2] += fiz;
      forces[3 * j] += fjx;
      forces[3 * j + 1] += fjy;
      forces[3 * j + 2] += fjz;
      forces[3 * k] += fkx;
      forces[3 * k + 1] += fky;
      forces[3 * k + 2] += fkz;
      forces[3 * l] += flx;
      forces[3 * l + 1] += fly;
      forces[3 * l + 2] += flz;
    }

    return { potentialEnergy: pe, virial };
  }
}
