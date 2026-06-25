import type { AngleList, BondList, DihedralList } from "./forces/molecular";
import { setMaxwellBoltzmannVelocities } from "./init";
import type { Rng } from "./rng";
import { OIL_CH2, OIL_CH3 } from "./species";
import { createState } from "./state";
import type { Box, SimState, Species } from "./types";

// United-atom alkane (TraPPE) intramolecular parameters.
const CC_R0 = 0.154; // nm (C–C bond)
const CC_K = 200000; // kJ·mol⁻¹·nm⁻²
const CCC_THETA0 = (114 * Math.PI) / 180;
const CCC_K = 519.6; // kJ·mol⁻¹·rad⁻²
/**
 * OPLS/TraPPE Ryckaert-Bellemans torsion for the C–C–C–C of an alkane, converted to the cos(φ)
 * basis (cₙ = (−1)ⁿ·Cₙ). Trans (φ = 180°) is the global minimum (V = 0); the gauche wells sit
 * ~3 kJ/mol up — so chains are mostly extended but flip between conformers as they're nudged.
 */
const ALKANE_RB = [9.279, -12.156, -13.12, 3.06, 26.24, 31.495] as const;

export interface AlkaneSystem {
  readonly state: SimState;
  readonly species: readonly Species[];
  readonly bonds: BondList;
  readonly angles: AngleList;
  readonly dihedrals: DihedralList;
  readonly renderBonds: { i: Int32Array; j: Int32Array };
}

/** Random rigid rotation (yaw then pitch) of a chain — preserves all internal geometry. */
function makeRotation(rng: Rng): (v: [number, number, number]) => [number, number, number] {
  const a = rng.range(0, 2 * Math.PI);
  const b = rng.range(0, 2 * Math.PI);
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  return (v) => {
    const x1 = v[0] * ca - v[1] * sa;
    const y1 = v[0] * sa + v[1] * ca;
    const z1 = v[2];
    return [x1, y1 * cb - z1 * sb, y1 * sb + z1 * cb];
  };
}

/**
 * Build a box of `nChains` united-atom alkane chains, each `nCarbons` long, as an extended
 * all-trans zig-zag then randomly rotated/placed. Bonds + angles + RB dihedrals make the chains
 * flex between trans/gauche conformations — the point of the dihedral demo.
 */
export function buildAlkaneSystem(
  nChains: number,
  nCarbons: number,
  box: Box,
  initT: number,
  rng: Rng,
): AlkaneSystem {
  const perChain = nCarbons;
  const count = nChains * perChain;
  const typeIds = new Uint8Array(count);
  const moleculeId = new Int32Array(count);

  // All-trans zig-zag template along x (alternating ±y), centred on the chain.
  const half = (180 - 114) / 2; // bond tilt from the chain axis, degrees
  const dx = CC_R0 * Math.cos((half * Math.PI) / 180);
  const dy = CC_R0 * Math.sin((half * Math.PI) / 180);
  const template: [number, number, number][] = [];
  for (let c = 0; c < perChain; c++) {
    template.push([c * dx - ((perChain - 1) * dx) / 2, (c % 2) * dy - dy / 2, 0]);
  }

  const state = createState(count, typeIds, moleculeId);
  const { positions } = state;

  // Grid of chain centres so they don't overlap at start.
  const perSide = Math.ceil(Math.cbrt(nChains));
  const [lx, ly, lz] = box.lengths;
  const spacing = Math.min(lx, ly, lz) / (perSide + 1);

  const bI: number[] = [];
  const bJ: number[] = [];
  const aI: number[] = [];
  const aJ: number[] = [];
  const aK: number[] = [];
  const dI: number[] = [];
  const dJ: number[] = [];
  const dK: number[] = [];
  const dL: number[] = [];

  let atom = 0;
  for (let m = 0; m < nChains; m++) {
    const gx = m % perSide;
    const gy = Math.floor(m / perSide) % perSide;
    const gz = Math.floor(m / (perSide * perSide));
    const cx = (gx + 1) * spacing - lx / 2;
    const cy = (gy + 1) * spacing - ly / 2;
    const cz = (gz + 1) * spacing - lz / 2;
    const rot = makeRotation(rng);
    const base = atom;
    for (let c = 0; c < perChain; c++) {
      const r = rot(template[c]);
      positions[3 * atom] = cx + r[0];
      positions[3 * atom + 1] = cy + r[1];
      positions[3 * atom + 2] = cz + r[2];
      typeIds[atom] = c === 0 || c === perChain - 1 ? 1 : 0; // CH3 ends, CH2 middle
      moleculeId[atom] = m;
      atom++;
    }
    // Topology along the chain.
    for (let c = 0; c < perChain - 1; c++) {
      bI.push(base + c);
      bJ.push(base + c + 1);
    }
    for (let c = 0; c < perChain - 2; c++) {
      aI.push(base + c);
      aJ.push(base + c + 1);
      aK.push(base + c + 2);
    }
    for (let c = 0; c < perChain - 3; c++) {
      dI.push(base + c);
      dJ.push(base + c + 1);
      dK.push(base + c + 2);
      dL.push(base + c + 3);
    }
  }

  // Species index 0 = CH2, 1 = CH3.
  const species: Species[] = [OIL_CH2, OIL_CH3];
  setMaxwellBoltzmannVelocities(state, species, initT, rng);

  const nb = bI.length;
  const bonds: BondList = {
    i: Int32Array.from(bI),
    j: Int32Array.from(bJ),
    r0: new Float64Array(nb).fill(CC_R0),
    k: new Float64Array(nb).fill(CC_K),
  };
  const na = aI.length;
  const angles: AngleList = {
    i: Int32Array.from(aI),
    j: Int32Array.from(aJ),
    k: Int32Array.from(aK),
    theta0: new Float64Array(na).fill(CCC_THETA0),
    kt: new Float64Array(na).fill(CCC_K),
  };
  const nd = dI.length;
  const c = new Float64Array(6 * nd);
  for (let t = 0; t < nd; t++) for (let p = 0; p < 6; p++) c[6 * t + p] = ALKANE_RB[p];
  const dihedrals: DihedralList = {
    i: Int32Array.from(dI),
    j: Int32Array.from(dJ),
    k: Int32Array.from(dK),
    l: Int32Array.from(dL),
    c,
  };

  return {
    state,
    species,
    bonds,
    angles,
    dihedrals,
    renderBonds: { i: Int32Array.from(bI), j: Int32Array.from(bJ) },
  };
}
