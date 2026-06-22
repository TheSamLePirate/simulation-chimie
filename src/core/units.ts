/**
 * Physical constants and unit conversions for the MD engine.
 *
 * Internal engine units (chosen for good single-precision conditioning, matching
 * the GROMACS convention):
 *   - length      nanometre        (nm)
 *   - time        picosecond       (ps)
 *   - mass        unified atomic mass unit (u)
 *   - energy      kilojoule/mole   (kJ·mol⁻¹)
 *   - temperature kelvin           (K)
 *   - charge      elementary charge (e)
 *
 * In this unit system, velocity is nm·ps⁻¹ and, conveniently, 1 u·(nm·ps⁻¹)² = 1 kJ·mol⁻¹,
 * so kinetic energy needs no extra conversion factor.
 */

/** Boltzmann constant in kJ·mol⁻¹·K⁻¹. */
export const BOLTZMANN_KJ_PER_MOL_K = 0.00831446261815324;

/** Avogadro constant in mol⁻¹. */
export const AVOGADRO = 6.02214076e23;

/** Ångström per nanometre. */
export const ANGSTROM_PER_NM = 10;

/** Zero Celsius expressed in kelvin. */
export const KELVIN_AT_ZERO_CELSIUS = 273.15;

export function angstromToNm(angstrom: number): number {
  return angstrom / ANGSTROM_PER_NM;
}

export function nmToAngstrom(nm: number): number {
  return nm * ANGSTROM_PER_NM;
}

export function celsiusToKelvin(celsius: number): number {
  return celsius + KELVIN_AT_ZERO_CELSIUS;
}

export function kelvinToCelsius(kelvin: number): number {
  return kelvin - KELVIN_AT_ZERO_CELSIUS;
}

/**
 * Instantaneous kinetic temperature from total kinetic energy via equipartition:
 *   T = 2·E_kin / (N_dof · k_B)
 *
 * @param kineticEnergyKjPerMol total kinetic energy in kJ·mol⁻¹
 * @param degreesOfFreedom number of degrees of freedom (e.g. 3N − constraints − 3 for fixed COM)
 */
export function temperatureFromKinetic(
  kineticEnergyKjPerMol: number,
  degreesOfFreedom: number,
): number {
  if (degreesOfFreedom <= 0) return 0;
  return (2 * kineticEnergyKjPerMol) / (degreesOfFreedom * BOLTZMANN_KJ_PER_MOL_K);
}

/** 1 kJ·mol⁻¹·nm⁻³ expressed in bar (the internal → reportable pressure factor). */
export const BAR_PER_KJ_PER_MOL_NM3 = 16.6053906717;

/** Convert an internal pressure (kJ·mol⁻¹·nm⁻³) to bar. */
export function pressureToBar(pressureInternal: number): number {
  return pressureInternal * BAR_PER_KJ_PER_MOL_NM3;
}
