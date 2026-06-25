import type { AngleList, BondList } from "./forces/molecular";
import { setMaxwellBoltzmannVelocities } from "./init";
import type { Rng } from "./rng";
import { OIL_CH2 } from "./species";
import { createState } from "./state";
import type { Box, SimState, Species } from "./types";

// Diatomic "molecule" held by a Morse bond. The well is intentionally shallow (~25 kJ/mol) so
// thermal energy at high T can break it — i.e. you watch real bond DISSOCIATION, which a harmonic
// spring (infinitely strong at large r) can never show.
const MORSE_R0 = 0.14; // nm
const MORSE_A = 18; // width (nm⁻¹)
const MORSE_DE = 25; // well depth (kJ·mol⁻¹)
const MORSE_K = 2 * MORSE_DE * MORSE_A * MORSE_A; // harmonic-equivalent curvature ⇒ De = k/(2a²)

export interface MorseSystem {
  readonly state: SimState;
  readonly species: readonly Species[];
  readonly bonds: BondList;
  readonly angles: AngleList;
  readonly renderBonds: { i: Int32Array; j: Int32Array };
}

const EMPTY_ANGLES: AngleList = {
  i: new Int32Array(0),
  j: new Int32Array(0),
  k: new Int32Array(0),
  theta0: new Float64Array(0),
  kt: new Float64Array(0),
};

/**
 * Build `nMolecules` diatomic molecules (2 united-atom sites each) joined by a Morse bond, placed
 * on a jittered lattice. Heated past the well depth, the Morse bonds snap and the atoms drift
 * apart — visible dissociation. Inter-molecular LJ is weak, so freed atoms wander off.
 */
export function buildMorseSystem(
  nMolecules: number,
  box: Box,
  initT: number,
  rng: Rng,
): MorseSystem {
  const count = nMolecules * 2;
  const typeIds = new Uint8Array(count);
  const moleculeId = new Int32Array(count);
  const state = createState(count, typeIds, moleculeId);
  const { positions } = state;

  const perSide = Math.ceil(Math.cbrt(nMolecules));
  const [lx, ly, lz] = box.lengths;
  const spacing = Math.min(lx, ly, lz) / (perSide + 1);

  const bI: number[] = [];
  const bJ: number[] = [];
  for (let m = 0; m < nMolecules; m++) {
    const gx = m % perSide;
    const gy = Math.floor(m / perSide) % perSide;
    const gz = Math.floor(m / (perSide * perSide));
    const cx = (gx + 1) * spacing - lx / 2 + rng.range(-0.02, 0.02);
    const cy = (gy + 1) * spacing - ly / 2 + rng.range(-0.02, 0.02);
    const cz = (gz + 1) * spacing - lz / 2 + rng.range(-0.02, 0.02);
    // Random bond orientation.
    const theta = rng.range(0, Math.PI);
    const phi = rng.range(0, 2 * Math.PI);
    const hx = 0.5 * MORSE_R0 * Math.sin(theta) * Math.cos(phi);
    const hy = 0.5 * MORSE_R0 * Math.sin(theta) * Math.sin(phi);
    const hz = 0.5 * MORSE_R0 * Math.cos(theta);
    const a0 = 2 * m;
    const a1 = 2 * m + 1;
    positions[3 * a0] = cx - hx;
    positions[3 * a0 + 1] = cy - hy;
    positions[3 * a0 + 2] = cz - hz;
    positions[3 * a1] = cx + hx;
    positions[3 * a1 + 1] = cy + hy;
    positions[3 * a1 + 2] = cz + hz;
    moleculeId[a0] = m;
    moleculeId[a1] = m;
    bI.push(a0);
    bJ.push(a1);
  }

  const species: Species[] = [OIL_CH2];
  setMaxwellBoltzmannVelocities(state, species, initT, rng);

  const nb = bI.length;
  const bonds: BondList = {
    i: Int32Array.from(bI),
    j: Int32Array.from(bJ),
    r0: new Float64Array(nb).fill(MORSE_R0),
    k: new Float64Array(nb).fill(MORSE_K),
    morseA: new Float64Array(nb).fill(MORSE_A),
  };

  return {
    state,
    species,
    bonds,
    angles: EMPTY_ANGLES,
    renderBonds: { i: Int32Array.from(bI), j: Int32Array.from(bJ) },
  };
}
