import { describe, expect, it } from 'vitest'
import {
  angstromToNm,
  BOLTZMANN_KJ_PER_MOL_K,
  celsiusToKelvin,
  kelvinToCelsius,
  nmToAngstrom,
  temperatureFromKinetic,
} from './units'

describe('length conversions', () => {
  it('round-trips Å ↔ nm', () => {
    expect(angstromToNm(10)).toBe(1)
    expect(nmToAngstrom(1)).toBe(10)
    expect(nmToAngstrom(angstromToNm(3.1656))).toBeCloseTo(3.1656, 12)
  })
})

describe('temperature conversions', () => {
  it('maps 0 °C to 273.15 K and back', () => {
    expect(celsiusToKelvin(0)).toBe(273.15)
    expect(kelvinToCelsius(273.15)).toBe(0)
    expect(celsiusToKelvin(25)).toBeCloseTo(298.15, 12)
  })
})

describe('temperatureFromKinetic', () => {
  it('returns 0 for non-positive degrees of freedom', () => {
    expect(temperatureFromKinetic(100, 0)).toBe(0)
    expect(temperatureFromKinetic(100, -3)).toBe(0)
  })

  it('inverts equipartition: E_kin = (dof/2)·k_B·T yields T', () => {
    const dof = 3000
    const targetT = 300
    const kineticEnergy = 0.5 * dof * BOLTZMANN_KJ_PER_MOL_K * targetT
    expect(temperatureFromKinetic(kineticEnergy, dof)).toBeCloseTo(targetT, 9)
  })

  it('scales linearly with kinetic energy', () => {
    const dof = 600
    const t1 = temperatureFromKinetic(50, dof)
    const t2 = temperatureFromKinetic(100, dof)
    expect(t2 / t1).toBeCloseTo(2, 12)
  })
})
