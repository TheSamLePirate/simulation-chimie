import type { Box } from "../types";

export interface PlanarDispersionTailResult {
  readonly potentialEnergy: number;
  readonly forcesZ: Float64Array;
  readonly virial: number;
}

/**
 * Janeček density-profile long-range correction for a single-site Lennard-Jones fluid
 * with a planar interface normal to z. The density profile is periodically repeated so
 * interactions with slab images beyond the primary box are included.
 */
export function planarLennardJonesTailCorrection(
  oxygenPositions: ArrayLike<number>,
  box: Box,
  sigma: number,
  epsilon: number,
  cutoff: number,
  bins = 100,
  imageLayers = 8,
): PlanarDispersionTailResult {
  if (oxygenPositions.length % 3 !== 0)
    throw new RangeError("oxygen positions must be xyz triples");
  if (!(sigma > 0) || !(epsilon > 0) || !(cutoff > 0)) {
    throw new RangeError("LJ tail parameters must be positive");
  }
  if (!Number.isInteger(bins) || bins < 2) throw new RangeError("bins must be an integer >= 2");
  if (!Number.isInteger(imageLayers) || imageLayers < 1) {
    throw new RangeError("imageLayers must be a positive integer");
  }
  const count = oxygenPositions.length / 3;
  const [lx, ly, lz] = box.lengths;
  const binWidth = lz / bins;
  const binVolume = lx * ly * binWidth;
  const counts = new Uint32Array(bins);
  const particleBins = new Uint32Array(count);
  const wrap = (z: number) => z - lz * Math.floor((z + lz / 2) / lz);
  for (let particle = 0; particle < count; particle++) {
    const z = wrap(oxygenPositions[3 * particle + 2]);
    const bin = Math.min(bins - 1, Math.floor((z + lz / 2) / binWidth));
    particleBins[particle] = bin;
    counts[bin]++;
  }

  const sigma6 = sigma ** 6;
  const sigma12 = sigma6 * sigma6;
  const potentialAtCutoff = 4 * epsilon * (sigma12 / cutoff ** 12 - sigma6 / cutoff ** 6);
  const forcesZ = new Float64Array(count);
  let doubleEnergy = 0;
  let virial = 0;
  for (let particle = 0; particle < count; particle++) {
    const z1 = wrap(oxygenPositions[3 * particle + 2]);
    let potential = 0;
    let force = 0;
    for (let image = -imageLayers; image <= imageLayers; image++) {
      for (let bin = 0; bin < bins; bin++) {
        let density = counts[bin] / binVolume;
        if (image === 0 && bin === particleBins[particle]) density -= 1 / binVolume;
        if (density === 0) continue;
        const z2 = -lz / 2 + (bin + 0.5) * binWidth + image * lz;
        const separation = z2 - z1;
        const absolute = Math.abs(separation);
        const integrationRadius = Math.max(cutoff, absolute);
        const kernel =
          8 *
          Math.PI *
          epsilon *
          (sigma12 / (10 * integrationRadius ** 10) - sigma6 / (4 * integrationRadius ** 4));
        potential += density * kernel * binWidth;
        if (absolute > cutoff) {
          force +=
            -8 *
            Math.PI *
            epsilon *
            Math.sign(separation) *
            (sigma12 / absolute ** 11 - sigma6 / absolute ** 5) *
            density *
            binWidth;
        } else {
          force += -2 * Math.PI * potentialAtCutoff * density * separation * binWidth;
        }
      }
    }
    doubleEnergy += potential;
    forcesZ[particle] = force;
    virial += z1 * force;
  }
  return { potentialEnergy: 0.5 * doubleEnergy, forcesZ, virial };
}
