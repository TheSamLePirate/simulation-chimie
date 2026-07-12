/** IAPWS R1-76(2014) surface tension of ordinary water, returned in mN·m⁻¹. */
export function iapwsSurfaceTension(temperatureK: number): number {
  const criticalTemperature = 647.096;
  if (temperatureK <= 0 || temperatureK >= criticalTemperature) return 0;
  const tau = 1 - temperatureK / criticalTemperature;
  return 235.8 * tau ** 1.256 * (1 - 0.625 * tau);
}
