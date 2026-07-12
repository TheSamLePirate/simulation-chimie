import type { SimState, Species } from "../types";
import { BOLTZMANN_KJ_PER_MOL_K } from "../units";

export interface SpeedDistribution {
  /** Bin-centre speeds |v|, nm·ps⁻¹. */
  readonly v: number[];
  /** Observed probability density at each bin (∫ f dv = 1). */
  readonly density: number[];
  /** Maxwell-Boltzmann density at the given temperature (number-weighted over species). */
  readonly theory: number[];
  /** Mean speed ⟨|v|⟩, nm·ps⁻¹. */
  readonly meanSpeed: number;
}

/**
 * Speed distribution f(|v|): histogram of particle speeds, normalised to a probability
 * density, plus the exact Maxwell-Boltzmann prediction at temperature T. For a mixture
 * the prediction is the number-weighted sum of per-species MB densities
 * f_s(v) = 4π v² (m_s / 2πkT)^{3/2} e^{−m_s v² / 2kT} — in GROMACS units (u, nm·ps⁻¹,
 * kJ·mol⁻¹) m·v² is directly kJ·mol⁻¹, so no conversion factor appears.
 *
 * The axis spans 3× the most-probable speed of the lightest species so the whole
 * curve (including the H tail of water) stays in frame.
 */
export function speedDistribution(
  state: SimState,
  species: readonly Species[],
  temperatureK: number,
  options: { bins?: number } = {},
): SpeedDistribution {
  const { count, velocities, typeIds } = state;
  const bins = options.bins ?? 48;
  const v = new Array<number>(bins).fill(0);
  const density = new Array<number>(bins).fill(0);
  const theory = new Array<number>(bins).fill(0);
  if (count === 0) return { v, density, theory, meanSpeed: 0 };

  const kT = BOLTZMANN_KJ_PER_MOL_K * Math.max(temperatureK, 1);

  // Species number fractions (for the mixture-weighted MB curve) and the lightest mass.
  const fractions = new Float64Array(species.length);
  for (let i = 0; i < count; i++) fractions[typeIds[i]] += 1 / count;
  let minMass = Number.POSITIVE_INFINITY;
  for (let s = 0; s < species.length; s++) {
    if (fractions[s] > 0) minMass = Math.min(minMass, species[s].mass);
  }
  const vMax = 3 * Math.sqrt((2 * kT) / minMass);
  const dv = vMax / bins;

  const hist = new Float64Array(bins);
  let sumSpeed = 0;
  for (let i = 0; i < count; i++) {
    const vx = velocities[3 * i];
    const vy = velocities[3 * i + 1];
    const vz = velocities[3 * i + 2];
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    sumSpeed += speed;
    const bin = Math.min(bins - 1, Math.floor(speed / dv));
    hist[bin] += 1;
  }

  for (let b = 0; b < bins; b++) {
    const vc = (b + 0.5) * dv;
    v[b] = vc;
    density[b] = hist[b] / (count * dv);
    let f = 0;
    for (let s = 0; s < species.length; s++) {
      if (fractions[s] === 0) continue;
      const m = species[s].mass;
      const a = m / (2 * Math.PI * kT);
      f +=
        fractions[s] *
        4 *
        Math.PI *
        vc *
        vc *
        a *
        Math.sqrt(a) *
        Math.exp((-m * vc * vc) / (2 * kT));
    }
    theory[b] = f;
  }

  return { v, density, theory, meanSpeed: sumSpeed / count };
}
