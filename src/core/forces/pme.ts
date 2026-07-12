import { erfcAccurate as erfc } from "../math/erf";
import { fft3d } from "../math/fft";
import type { Box } from "../types";
import { COULOMB_CONSTANT } from "../units";
import type { ChargeSites, EwaldResult } from "./ewald";

const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);
const PME_ORDER = 6;

export interface SmoothPmeOptions {
  readonly alpha: number;
  readonly grid: readonly [number, number, number];
  readonly realCutoff?: number;
  readonly slabCorrection?: boolean;
}

interface AxisWeights {
  readonly base: number;
  readonly weights: readonly number[];
  readonly derivatives: readonly number[];
}

const FACTORIAL = [1, 1, 2, 6, 24, 120, 720];

function binomial(n: number, k: number): number {
  return FACTORIAL[n] / (FACTORIAL[k] * FACTORIAL[n - k]);
}

function cardinalBSpline(order: number, x: number): number {
  if (x <= 0 || x >= order) return 0;
  let sum = 0;
  for (let k = 0; k <= Math.floor(x); k++) {
    sum += (k % 2 === 0 ? 1 : -1) * binomial(order, k) * (x - k) ** (order - 1);
  }
  return sum / FACTORIAL[order - 1];
}

function cardinalBSplineDerivative(order: number, x: number): number {
  if (x <= 0 || x >= order) return 0;
  let sum = 0;
  for (let k = 0; k <= Math.floor(x); k++) {
    sum += (k % 2 === 0 ? 1 : -1) * binomial(order, k) * (x - k) ** (order - 2);
  }
  return sum / FACTORIAL[order - 2];
}

/** Cardinal B-spline weights and derivatives with respect to the mesh coordinate. */
function splineWeights(meshCoordinate: number): AxisWeights {
  const cell = Math.floor(meshCoordinate);
  const t = meshCoordinate - cell;
  const weights = new Array<number>(PME_ORDER);
  const derivatives = new Array<number>(PME_ORDER);
  for (let offset = 0; offset < PME_ORDER; offset++) {
    const argument = offset + 1 - t;
    weights[offset] = cardinalBSpline(PME_ORDER, argument);
    derivatives[offset] = -cardinalBSplineDerivative(PME_ORDER, argument);
  }
  return {
    base: cell - PME_ORDER / 2 + 1,
    weights,
    derivatives,
  };
}

function splineAssignmentModulus(mode: number, gridSize: number): number {
  const angle = (2 * Math.PI * mode) / gridSize;
  let re = 0;
  let im = 0;
  for (let sample = 1; sample < PME_ORDER; sample++) {
    const value = cardinalBSpline(PME_ORDER, sample);
    re += value * Math.cos(angle * (sample - 1));
    im += value * Math.sin(angle * (sample - 1));
  }
  return Math.hypot(re, im);
}

function wrapIndex(index: number, length: number): number {
  const value = index % length;
  return value < 0 ? value + length : value;
}

function validate(sites: ChargeSites, box: Box, options: SmoothPmeOptions) {
  if (sites.count < 1) throw new RangeError("PME requires at least one charge site");
  if (sites.positions.length < 3 * sites.count || sites.charges.length < sites.count) {
    throw new RangeError("charge-site buffers are shorter than count");
  }
  if (!(options.alpha > 0)) throw new RangeError("alpha must be positive");
  const [nx, ny, nz] = options.grid;
  for (const n of [nx, ny, nz]) {
    if (!Number.isInteger(n) || n < 4 || (n & (n - 1)) !== 0) {
      throw new RangeError("PME grid dimensions must be powers of two of at least four");
    }
  }
  const volume = box.lengths[0] * box.lengths[1] * box.lengths[2];
  if (!(volume > 0)) throw new RangeError("box volume must be positive");
  let totalCharge = 0;
  for (let i = 0; i < sites.count; i++) totalCharge += sites.charges[i];
  if (Math.abs(totalCharge) > 1e-10) throw new Error("PME requires a neutral charge set");
}

/**
 * Float64 smooth particle-mesh Ewald with order-6 cardinal B-spline assignment.
 * It is the CPU production candidate and remains gated until its golden-state force RMS
 * reproduces the direct Ewald oracle.
 */
export function computeSmoothPme(
  sites: ChargeSites,
  box: Box,
  options: SmoothPmeOptions,
): EwaldResult {
  validate(sites, box, options);
  const [lx, ly, lz] = box.lengths;
  const volume = lx * ly * lz;
  const [nx, ny, nz] = options.grid;
  const gridPoints = nx * ny * nz;
  const alpha = options.alpha;
  const alpha2 = alpha * alpha;
  const cutoff = options.realCutoff ?? 0.49 * Math.min(lx, ly, lz);
  if (!(cutoff > 0) || cutoff > 0.5 * Math.min(lx, ly, lz)) {
    throw new RangeError("realCutoff must be positive and within the minimum-image radius");
  }
  const cutoff2 = cutoff * cutoff;
  const forces = new Float64Array(3 * sites.count);
  let realEnergy = 0;
  let realVirial = 0;

  for (let i = 0; i < sites.count; i++) {
    for (let j = i + 1; j < sites.count; j++) {
      const qq = sites.charges[i] * sites.charges[j];
      if (qq === 0) continue;
      let dx = sites.positions[3 * i] - sites.positions[3 * j];
      let dy = sites.positions[3 * i + 1] - sites.positions[3 * j + 1];
      let dz = sites.positions[3 * i + 2] - sites.positions[3 * j + 2];
      dx -= lx * Math.round(dx / lx);
      dy -= ly * Math.round(dy / ly);
      dz -= lz * Math.round(dz / lz);
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 >= cutoff2 || r2 < 1e-20) continue;
      const r = Math.sqrt(r2);
      const erfcR = erfc(alpha * r);
      const expR = Math.exp(-alpha2 * r2);
      realEnergy += COULOMB_CONSTANT * qq * (erfcR / r);
      const fOverR =
        COULOMB_CONSTANT * qq * (erfcR / (r2 * r) + (TWO_OVER_SQRT_PI * alpha * expR) / r2);
      const fx = fOverR * dx;
      const fy = fOverR * dy;
      const fz = fOverR * dz;
      forces[3 * i] += fx;
      forces[3 * i + 1] += fy;
      forces[3 * i + 2] += fz;
      forces[3 * j] -= fx;
      forces[3 * j + 1] -= fy;
      forces[3 * j + 2] -= fz;
      realVirial += fOverR * r2;
    }
  }

  const mesh = new Float64Array(2 * gridPoints);
  const assignment = new Array<[AxisWeights, AxisWeights, AxisWeights]>(sites.count);
  for (let particle = 0; particle < sites.count; particle++) {
    const wx = splineWeights((sites.positions[3 * particle] / lx + 0.5) * nx);
    const wy = splineWeights((sites.positions[3 * particle + 1] / ly + 0.5) * ny);
    const wz = splineWeights((sites.positions[3 * particle + 2] / lz + 0.5) * nz);
    assignment[particle] = [wx, wy, wz];
    const charge = sites.charges[particle];
    for (let az = 0; az < PME_ORDER; az++) {
      const gz = wrapIndex(wz.base + az, nz);
      for (let ay = 0; ay < PME_ORDER; ay++) {
        const gy = wrapIndex(wy.base + ay, ny);
        for (let ax = 0; ax < PME_ORDER; ax++) {
          const gx = wrapIndex(wx.base + ax, nx);
          const index = gx + nx * (gy + ny * gz);
          mesh[2 * index] += charge * wx.weights[ax] * wy.weights[ay] * wz.weights[az];
        }
      }
    }
  }
  fft3d(mesh, nx, ny, nz);

  let reciprocalEnergy = 0;
  let reciprocalVirial = 0;
  for (let iz = 0; iz < nz; iz++) {
    const mz = iz <= nz / 2 ? iz : iz - nz;
    const kz = (2 * Math.PI * mz) / lz;
    const bz = splineAssignmentModulus(mz, nz);
    for (let iy = 0; iy < ny; iy++) {
      const my = iy <= ny / 2 ? iy : iy - ny;
      const ky = (2 * Math.PI * my) / ly;
      const by = splineAssignmentModulus(my, ny);
      for (let ix = 0; ix < nx; ix++) {
        const mx = ix <= nx / 2 ? ix : ix - nx;
        const index = ix + nx * (iy + ny * iz);
        if (mx === 0 && my === 0 && mz === 0) {
          mesh[2 * index] = 0;
          mesh[2 * index + 1] = 0;
          continue;
        }
        const kx = (2 * Math.PI * mx) / lx;
        const k2 = kx * kx + ky * ky + kz * kz;
        const weight = Math.exp(-k2 / (4 * alpha2)) / k2;
        const bx = splineAssignmentModulus(mx, nx);
        const assignmentFactor2 = (bx * by * bz) ** 2;
        const re = mesh[2 * index];
        const im = mesh[2 * index + 1];
        const influence = (COULOMB_CONSTANT * 4 * Math.PI * weight) / (volume * assignmentFactor2);
        const energyTerm = 0.5 * influence * (re * re + im * im);
        reciprocalEnergy += energyTerm;
        reciprocalVirial += energyTerm * (1 - k2 / (2 * alpha2));
        const potentialScale = gridPoints * influence;
        mesh[2 * index] = potentialScale * re;
        mesh[2 * index + 1] = potentialScale * im;
      }
    }
  }
  fft3d(mesh, nx, ny, nz, true);

  // Analytic differentiation of the same B-spline interpolation used by the mesh energy.
  for (let particle = 0; particle < sites.count; particle++) {
    const [wx, wy, wz] = assignment[particle];
    let gradientX = 0;
    let gradientY = 0;
    let gradientZ = 0;
    for (let az = 0; az < PME_ORDER; az++) {
      const gz = wrapIndex(wz.base + az, nz);
      for (let ay = 0; ay < PME_ORDER; ay++) {
        const gy = wrapIndex(wy.base + ay, ny);
        for (let ax = 0; ax < PME_ORDER; ax++) {
          const gx = wrapIndex(wx.base + ax, nx);
          const index = gx + nx * (gy + ny * gz);
          const potential = mesh[2 * index];
          gradientX += potential * wx.derivatives[ax] * wy.weights[ay] * wz.weights[az];
          gradientY += potential * wx.weights[ax] * wy.derivatives[ay] * wz.weights[az];
          gradientZ += potential * wx.weights[ax] * wy.weights[ay] * wz.derivatives[az];
        }
      }
    }
    const charge = sites.charges[particle];
    forces[3 * particle] -= charge * gradientX * (nx / lx);
    forces[3 * particle + 1] -= charge * gradientY * (ny / ly);
    forces[3 * particle + 2] -= charge * gradientZ * (nz / lz);
  }

  let chargeSquareSum = 0;
  for (let i = 0; i < sites.count; i++) chargeSquareSum += sites.charges[i] ** 2;
  const selfEnergy = (-COULOMB_CONSTANT * alpha * chargeSquareSum) / Math.sqrt(Math.PI);
  let slabEnergy = 0;
  if (options.slabCorrection) {
    let dipoleZ = 0;
    for (let i = 0; i < sites.count; i++) dipoleZ += sites.charges[i] * sites.positions[3 * i + 2];
    slabEnergy = (COULOMB_CONSTANT * 2 * Math.PI * dipoleZ * dipoleZ) / volume;
    const scale = (-COULOMB_CONSTANT * 4 * Math.PI * dipoleZ) / volume;
    for (let i = 0; i < sites.count; i++) forces[3 * i + 2] += scale * sites.charges[i];
  }
  // Remove the tiny mesh-translation mode left by analytic B-spline differentiation.
  // The exact periodic electrostatic force has zero total; this projection prevents COM drift.
  for (let component = 0; component < 3; component++) {
    let total = 0;
    for (let i = 0; i < sites.count; i++) total += forces[3 * i + component];
    const correction = total / sites.count;
    for (let i = 0; i < sites.count; i++) forces[3 * i + component] -= correction;
  }
  return {
    potentialEnergy: realEnergy + reciprocalEnergy + selfEnergy + slabEnergy,
    forces,
    virial: realVirial + reciprocalVirial + slabEnergy,
    realEnergy,
    reciprocalEnergy,
    selfEnergy,
    slabEnergy,
  };
}
