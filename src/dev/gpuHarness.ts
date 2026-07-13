import { instancedArray } from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import { applyBoundary } from "../core/boundary";
import { createBoxXYZ } from "../core/box";
import { rattle, shake } from "../core/constraints";
import { planarLennardJonesTailCorrection } from "../core/forces/planarDispersionTail";
import { computeSmoothPme } from "../core/forces/pme";
import { Tip4p2005EwaldForce } from "../core/forces/tip4p2005Ewald";
import { fft1d, fft3d } from "../core/math/fft";
import { Rng } from "../core/rng";
import {
  buildTip4p2005System,
  redistributeTip4pVirtualForce,
  TIP4P_2005,
  tip4pVirtualPositionInBox,
} from "../core/tip4p2005";
import { buildSystem } from "../engine/buildSystem";
import { CpuEngine } from "../engine/cpu/CpuEngine";
import { GpuEngine } from "../engine/gpu/GpuEngine";
import { GpuFft1d, GpuFft3d } from "../engine/gpu/GpuFft";
import { GpuPlanarDispersionTail } from "../engine/gpu/GpuPlanarDispersionTail";
import { GpuPmeReciprocal } from "../engine/gpu/GpuPmeReciprocal";
import { GpuTip4pPme, gpuVec3Storage } from "../engine/gpu/GpuTip4pPme";
import type { SimConfig } from "../engine/types";

/**
 * Browser-side validation harness for the GPU engine, exposed on `window.__md`.
 *
 * These compare the GPU engine against the CPU reference oracle via buffer readback.
 * Readback (WebGPU `mapAsync`) does not resolve in *headless* Chromium, so the
 * readback-based Playwright checks are skipped in CI; run them in a real browser
 * (`bun run dev`, then call `window.__md.*()` from the console) to validate parity.
 */

const TEST_CONFIG: SimConfig = {
  seed: 7,
  particleCount: 125,
  boxLength: 1.8,
  boundary: "periodic",
  temperature: 120,
  timestep: 0.002,
  level: "L1",
  speciesName: "ARGON",
  secondSpeciesName: null,
  fractionSecond: 0,
  crossScale: 1,
  thermostat: "none",
  thermostatTau: 0.5,
  barostat: "none",
  pressureTarget: 1,
  gravity: 0,
  engineKind: "gpu",
};

function sharedRenderer(): WebGPURenderer {
  const renderer = (window as unknown as { __mdRenderer?: WebGPURenderer }).__mdRenderer;
  if (!renderer) throw new Error("No live WebGPU renderer available for the harness");
  return renderer;
}

function maxAbsDiff(a: Float32Array | Float64Array, b: Float32Array | Float64Array) {
  let maxAbs = 0;
  let refMax = 0;
  for (let i = 0; i < a.length; i++) {
    maxAbs = Math.max(maxAbs, Math.abs(a[i] - b[i]));
    refMax = Math.max(refMax, Math.abs(b[i]));
  }
  return { maxAbs, refMax, maxRel: refMax > 0 ? maxAbs / refMax : 0 };
}

function finiteDiagnostics(values: Float32Array | Float64Array) {
  let finite = 0;
  for (const value of values) if (Number.isFinite(value)) finite++;
  return { finite, length: values.length, sample: Array.from(values.slice(0, 9)) };
}

async function freshGpu(config: SimConfig): Promise<GpuEngine> {
  const gpu = new GpuEngine(config);
  gpu.attach(sharedRenderer());
  await gpu.warmup();
  return gpu;
}

/** GPU forces (after init) vs CPU reference forces on the same initial configuration. */
async function forceParity(config: SimConfig = TEST_CONFIG) {
  const gpu = await freshGpu(config);
  const gpuForces = await gpu.readForces();
  gpu.dispose();
  const cpu = new CpuEngine(config);
  return {
    n: config.particleCount,
    ...maxAbsDiff(gpuForces, cpu.state.forces),
  };
}

/** GPU positions after `steps` vs CPU positions — short-horizon agreement (float32). */
async function stepParity(config: SimConfig = TEST_CONFIG, steps = 3) {
  const gpu = await freshGpu(config);
  await gpu.stepAsync(steps);
  const gpuPos = await gpu.readPositions();
  gpu.dispose();
  const cpu = new CpuEngine(config);
  cpu.step(steps);
  return {
    n: config.particleCount,
    steps,
    ...maxAbsDiff(gpuPos, cpu.state.positions),
  };
}

/** GPU total-energy drift over a run (symplectic ⇒ bounded). */
async function energyDrift(config: SimConfig = TEST_CONFIG, steps = 1000, chunk = 50) {
  const gpu = await freshGpu(config);
  const e0 = (await gpu.observables()).totalEnergy;
  let min = e0;
  let max = e0;
  for (let done = 0; done < steps; done += chunk) {
    await gpu.stepAsync(chunk);
    const e = (await gpu.observables()).totalEnergy;
    min = Math.min(min, e);
    max = Math.max(max, e);
  }
  gpu.dispose();
  return {
    e0,
    min,
    max,
    drift: Math.abs(e0) > 0 ? (max - min) / Math.abs(e0) : 0,
  };
}

/** Two independent GPU runs with the same seed must produce identical buffers. */
async function determinism(config: SimConfig = TEST_CONFIG, steps = 200) {
  const a = await freshGpu(config);
  await a.stepAsync(steps);
  const posA = await a.readPositions();
  a.dispose();

  const b = await freshGpu(config);
  await b.stepAsync(steps);
  const posB = await b.readPositions();
  b.dispose();

  let identical = posA.length === posB.length;
  for (let i = 0; i < posA.length && identical; i++) {
    if (posA[i] !== posB[i]) identical = false;
  }
  return { identical, n: config.particleCount };
}

/** GPU radix-2 FFT vs the Float64 CPU transform, including an inverse round-trip. */
async function fftParity(length = 64) {
  const input = new Float32Array(2 * length);
  for (let i = 0; i < input.length; i++) input[i] = Math.sin(0.37 * i) + 0.03 * i;
  const reference = Float64Array.from(input);
  fft1d(reference);
  const gpu = new GpuFft1d(input.slice());
  const renderer = sharedRenderer();
  await gpu.transform(renderer);
  const transformed = await gpu.read(renderer);
  const forward = maxAbsDiff(transformed, reference);
  await gpu.transform(renderer, true);
  const roundTrip = await gpu.read(renderer);
  return { length, forward, roundTrip: maxAbsDiff(roundTrip, input) };
}

/** Batched/strided 3D GPU FFT vs the x-fastest Float64 CPU oracle. */
async function fft3dParity(nx = 8, ny = 4, nz = 4) {
  const length = nx * ny * nz;
  const input = new Float32Array(2 * length);
  for (let i = 0; i < input.length; i++) {
    input[i] = Math.sin(0.17 * i) + Math.cos(0.031 * i * i) + 0.002 * i;
  }
  const reference = Float64Array.from(input);
  fft3d(reference, nx, ny, nz);
  const gpu = new GpuFft3d(input.slice(), nx, ny, nz);
  const renderer = sharedRenderer();
  await gpu.transform(renderer);
  const transformed = await gpu.read(renderer);
  const forward = maxAbsDiff(transformed, reference);
  await gpu.transform(renderer, true);
  const roundTrip = await gpu.read(renderer);
  return { nx, ny, nz, forward, roundTrip: maxAbsDiff(roundTrip, input) };
}

/** Order-6 charge assignment → reciprocal mesh → analytic interpolation vs CPU smooth PME. */
async function pmeReciprocalParity(nx = 16, ny = 16, nz = 32) {
  const positions = Float32Array.from([
    -0.71, 0.12, -0.55, -0.23, -0.62, 0.81, 0.18, 0.43, -0.91, 0.57, -0.31, 0.22, 0.82, 0.71, 1.03,
    -0.49, 0.83, -0.17,
  ]);
  const charges = Float32Array.from([0.75, -0.5, 0.25, -0.75, 0.5, -0.25]);
  const box = createBoxXYZ(2.4, 2.6, 3.2, "periodic");
  const alpha = 3.5;
  const grid = [nx, ny, nz] as const;
  const gpu = new GpuPmeReciprocal({ count: charges.length, positions, charges, box, alpha, grid });
  const renderer = sharedRenderer();
  await gpu.compute(renderer);
  const gpuForces = await gpu.readForces(renderer);
  const gpuReciprocal = await gpu.readReciprocalEnergyVirial(renderer);
  // PME's exact periodic force has no translation mode; apply the same projection as the CPU path.
  for (let component = 0; component < 3; component++) {
    let total = 0;
    for (let i = 0; i < charges.length; i++) total += gpuForces[3 * i + component];
    const correction = total / charges.length;
    for (let i = 0; i < charges.length; i++) gpuForces[3 * i + component] -= correction;
  }
  const cpu = computeSmoothPme(
    {
      count: charges.length,
      positions: Float64Array.from(positions),
      charges: Float64Array.from(charges),
    },
    box,
    { alpha, grid, realCutoff: 0.2 },
  );
  const reference = cpu.forces;
  return {
    nx,
    ny,
    nz,
    gpu: finiteDiagnostics(gpuForces),
    cpu: finiteDiagnostics(reference),
    energy: {
      gpu: gpuReciprocal.energy,
      cpu: cpu.reciprocalEnergy,
      relative:
        Math.abs(gpuReciprocal.energy - cpu.reciprocalEnergy) / Math.abs(cpu.reciprocalEnergy),
    },
    virial: {
      gpu: gpuReciprocal.virial,
      cpu: cpu.virial,
      relative: Math.abs(gpuReciprocal.virial - cpu.virial) / Math.abs(cpu.virial),
    },
    ...maxAbsDiff(gpuForces, reference),
  };
}

/** Full smooth PME (real + reciprocal + self + Yeh–Berkowitz slab) vs the CPU oracle. */
async function pmeFullParity(nx = 8, ny = 8, nz = 16) {
  const positions = Float32Array.from([
    -0.71, 0.12, -0.55, -0.23, -0.62, 0.81, 0.18, 0.43, -0.91, 0.57, -0.31, 0.22, 0.82, 0.71, 1.03,
    -0.49, 0.83, -0.17,
  ]);
  const charges = Float32Array.from([0.75, -0.5, 0.25, -0.75, 0.5, -0.25]);
  const box = createBoxXYZ(2.4, 2.6, 3.2, "periodic");
  const alpha = 3.5;
  const grid = [nx, ny, nz] as const;
  const realCutoff = 1.1;
  const gpu = new GpuPmeReciprocal({
    count: charges.length,
    positions,
    charges,
    box,
    alpha,
    grid,
    realCutoff,
    slabCorrection: true,
  });
  const renderer = sharedRenderer();
  await gpu.computeFull(renderer);
  const gpuForces = await gpu.readForces(renderer);
  const gpuThermodynamics = await gpu.readFullEnergyVirial(renderer);
  for (let component = 0; component < 3; component++) {
    let total = 0;
    for (let i = 0; i < charges.length; i++) total += gpuForces[3 * i + component];
    const correction = total / charges.length;
    for (let i = 0; i < charges.length; i++) gpuForces[3 * i + component] -= correction;
  }
  const cpu = computeSmoothPme(
    {
      count: charges.length,
      positions: Float64Array.from(positions),
      charges: Float64Array.from(charges),
    },
    box,
    { alpha, grid, realCutoff, slabCorrection: true },
  );
  return {
    nx,
    ny,
    nz,
    energy: {
      gpu: gpuThermodynamics.energy,
      cpu: cpu.potentialEnergy,
      absolute: Math.abs(gpuThermodynamics.energy - cpu.potentialEnergy),
      relative:
        Math.abs(gpuThermodynamics.energy - cpu.potentialEnergy) / Math.abs(cpu.potentialEnergy),
      scaled:
        Math.abs(gpuThermodynamics.energy - cpu.potentialEnergy) /
        Math.max(1, Math.abs(cpu.potentialEnergy)),
    },
    virial: {
      gpu: gpuThermodynamics.virial,
      cpu: cpu.virial,
      absolute: Math.abs(gpuThermodynamics.virial - cpu.virial),
      relative: Math.abs(gpuThermodynamics.virial - cpu.virial) / Math.abs(cpu.virial),
      scaled: Math.abs(gpuThermodynamics.virial - cpu.virial) / Math.max(1, Math.abs(cpu.virial)),
    },
    ...maxAbsDiff(gpuForces, cpu.forces),
  };
}

/** TIP4P exclusions, M-site force redistribution, energy and virial vs the CPU model. */
async function tip4pPmeParity(nx = 8, ny = 8, nz = 16) {
  const molecules = 4;
  const box = createBoxXYZ(2.4, 2.6, 3.2, "periodic");
  const system = buildTip4p2005System(molecules, box, 300, new Rng(20250713));
  for (let i = 0; i < system.state.positions.length; i++) {
    system.state.positions[i] = Math.fround(system.state.positions[i]);
  }
  const sitePositions = new Float32Array(9 * molecules);
  const charges = new Float32Array(3 * molecules);
  for (let molecule = 0; molecule < molecules; molecule++) {
    const oxygen = 3 * molecule;
    const o = system.state.positions.subarray(3 * oxygen, 3 * oxygen + 3);
    const h1 = system.state.positions.subarray(3 * (oxygen + 1), 3 * (oxygen + 1) + 3);
    const h2 = system.state.positions.subarray(3 * (oxygen + 2), 3 * (oxygen + 2) + 3);
    sitePositions.set(h1, 9 * molecule);
    sitePositions.set(h2, 9 * molecule + 3);
    sitePositions.set(tip4pVirtualPositionInBox(o, h1, h2, box), 9 * molecule + 6);
    charges[3 * molecule] = TIP4P_2005.chargeH;
    charges[3 * molecule + 1] = TIP4P_2005.chargeH;
    charges[3 * molecule + 2] = TIP4P_2005.chargeM;
  }
  const grid = [nx, ny, nz] as const;
  const gpu = new GpuTip4pPme({
    molecules,
    // Intentionally start charge sites at zero: the GPU must rebuild H1,H2,M from live atoms.
    positions: new Float32Array(sitePositions.length),
    charges,
    box,
    alpha: 3.5,
    grid,
    slabCorrection: true,
    atomicPositionStorage: gpuVec3Storage(Float32Array.from(system.state.positions)),
  });
  const renderer = sharedRenderer();
  await gpu.compute(renderer);
  const gpuSite = await gpu.readSiteForces(renderer);
  const gpuAtomic = await gpu.readAtomicForces(renderer);
  const gpuThermodynamics = await gpu.readEnergyVirial(renderer);

  const cpuModel = new Tip4p2005EwaldForce({ alpha: 3.5, pmeGrid: grid, slabCorrection: true });
  cpuModel.compute(system.state, box, system.species);
  const cpu = cpuModel.lastEwald;
  if (!cpu) throw new Error("CPU TIP4P Ewald diagnostics unavailable");
  const cpuAtomic = new Float64Array(9 * molecules);
  for (let molecule = 0; molecule < molecules; molecule++) {
    const base = 3 * molecule;
    const mForce = cpu.forces.subarray(3 * (base + 2), 3 * (base + 3));
    const distributed = redistributeTip4pVirtualForce(mForce);
    cpuAtomic.set(distributed.oxygen, 3 * base);
    for (let component = 0; component < 3; component++) {
      cpuAtomic[3 * (base + 1) + component] =
        cpu.forces[3 * base + component] + distributed.hydrogen1[component];
      cpuAtomic[3 * (base + 2) + component] =
        cpu.forces[3 * (base + 1) + component] + distributed.hydrogen2[component];
    }
  }
  return {
    nx,
    ny,
    nz,
    siteForces: maxAbsDiff(gpuSite, cpu.forces),
    atomicForces: maxAbsDiff(gpuAtomic, cpuAtomic),
    energy: {
      gpu: gpuThermodynamics.energy,
      cpu: cpu.potentialEnergy,
      absolute: Math.abs(gpuThermodynamics.energy - cpu.potentialEnergy),
      relative:
        Math.abs(gpuThermodynamics.energy - cpu.potentialEnergy) / Math.abs(cpu.potentialEnergy),
      scaled:
        Math.abs(gpuThermodynamics.energy - cpu.potentialEnergy) /
        Math.max(1, Math.abs(cpu.potentialEnergy)),
    },
    virial: {
      gpu: gpuThermodynamics.virial,
      cpu: cpu.virial,
      absolute: Math.abs(gpuThermodynamics.virial - cpu.virial),
      relative: Math.abs(gpuThermodynamics.virial - cpu.virial) / Math.abs(cpu.virial),
      scaled: Math.abs(gpuThermodynamics.virial - cpu.virial) / Math.max(1, Math.abs(cpu.virial)),
    },
  };
}

/** Integrated GpuEngine L11 initial force vs identical CPU TIP4P raw-LJ/PME physics. */
async function l11EngineForceParity(molecules = 8) {
  const config: SimConfig = {
    ...TEST_CONFIG,
    particleCount: molecules,
    boxLength: 1.8,
    temperature: 300,
    timestep: 0.002,
    level: "L11",
    speciesName: "WATER_O",
    thermostat: "csvr",
    thermostatTau: 1,
    engineKind: "gpu",
  };
  const gpu = await freshGpu(config);
  const gpuForces = await gpu.readForces();
  gpu.dispose();
  const system = buildSystem(config);
  const force = new Tip4p2005EwaldForce({
    alpha: 3.5,
    pmeGrid: [32, 32, 128],
    slabCorrection: true,
    dispersionTailBins: 80,
  });
  force.compute(system.state, system.box, system.species);
  return { molecules, ...maxAbsDiff(gpuForces, system.state.forces) };
}

/** One complete rigid-water Velocity-Verlet step through integrated L11 CPU/GPU paths. */
async function l11EngineStepParity(molecules = 8) {
  const config: SimConfig = {
    ...TEST_CONFIG,
    particleCount: molecules,
    boxLength: 1.8,
    temperature: 300,
    timestep: 0.002,
    level: "L11",
    speciesName: "WATER_O",
    thermostat: "none",
    thermostatTau: 1,
    engineKind: "gpu",
  };
  const gpu = await freshGpu(config);
  await gpu.stepAsync(1);
  const gpuPositions = await gpu.readPositions();
  gpu.dispose();

  const system = buildSystem(config);
  const force = new Tip4p2005EwaldForce({
    alpha: 3.5,
    pmeGrid: [32, 32, 128],
    slabCorrection: true,
    dispersionTailBins: 80,
  });
  force.compute(system.state, system.box, system.species);
  const inverseMass = new Float64Array(system.state.count);
  for (let atom = 0; atom < system.state.count; atom++) {
    inverseMass[atom] = 1 / system.species[system.state.typeIds[atom]].mass;
  }
  const referencePositions = system.state.positions.slice();
  const halfDt = 0.5 * config.timestep;
  for (let atom = 0; atom < system.state.count; atom++) {
    const inverse = inverseMass[atom];
    for (let component = 0; component < 3; component++) {
      const index = 3 * atom + component;
      system.state.velocities[index] += halfDt * system.state.forces[index] * inverse;
      system.state.positions[index] += config.timestep * system.state.velocities[index];
    }
  }
  applyBoundary(system.state, system.box, system.species);
  shake(
    system.state,
    {
      i: Int32Array.from(system.constraints.i),
      j: Int32Array.from(system.constraints.j),
      d0: Float64Array.from(system.constraints.d0),
    },
    referencePositions,
    inverseMass,
    system.box,
    config.timestep,
  );
  force.compute(system.state, system.box, system.species);
  for (let atom = 0; atom < system.state.count; atom++) {
    const inverse = inverseMass[atom];
    for (let component = 0; component < 3; component++) {
      const index = 3 * atom + component;
      system.state.velocities[index] += halfDt * system.state.forces[index] * inverse;
    }
  }
  rattle(
    system.state,
    {
      i: Int32Array.from(system.constraints.i),
      j: Int32Array.from(system.constraints.j),
      d0: Float64Array.from(system.constraints.d0),
    },
    inverseMass,
    system.box,
  );
  return { molecules, ...maxAbsDiff(gpuPositions, system.state.positions) };
}

/** GPU Janeček density-profile tail vs the standalone Float64 CPU convolution. */
async function janecekParity(molecules = 80) {
  const box = createBoxXYZ(3, 3, 10, "periodic");
  const oxygenPositions = new Float64Array(3 * molecules);
  const atomicPositions = new Float32Array(9 * molecules);
  for (let molecule = 0; molecule < molecules; molecule++) {
    const z = -1 + (2 * molecule) / (molecules - 1);
    oxygenPositions[3 * molecule + 2] = z;
    atomicPositions[9 * molecule + 2] = z;
  }
  const gpu = new GpuPlanarDispersionTail({
    molecules,
    atomicPositions: instancedArray(atomicPositions, "vec3"),
    targetForces: instancedArray(new Float32Array(9 * molecules), "vec3"),
    targetEnergyVirial: instancedArray(new Float32Array(6 * molecules), "vec2"),
    boxLengths: [3, 3, 10],
    sigma: TIP4P_2005.sigmaO,
    epsilon: TIP4P_2005.epsilonO,
    cutoff: 0.8,
    bins: 80,
  });
  const renderer = sharedRenderer();
  await renderer.computeAsync(gpu.kernels());
  const actual = await gpu.read(renderer);
  const reference = planarLennardJonesTailCorrection(
    oxygenPositions,
    box,
    TIP4P_2005.sigmaO,
    TIP4P_2005.epsilonO,
    0.8,
    80,
  );
  return {
    molecules,
    forces: maxAbsDiff(actual.forcesZ, reference.forcesZ),
    energy: {
      absolute: Math.abs(actual.potentialEnergy - reference.potentialEnergy),
      relative:
        Math.abs(actual.potentialEnergy - reference.potentialEnergy) /
        Math.abs(reference.potentialEnergy),
    },
    virial: {
      absolute: Math.abs(actual.virial - reference.virial),
      relative: Math.abs(actual.virial - reference.virial) / Math.abs(reference.virial),
    },
  };
}

export interface MdHarness {
  forceParity: typeof forceParity;
  stepParity: typeof stepParity;
  energyDrift: typeof energyDrift;
  determinism: typeof determinism;
  fftParity: typeof fftParity;
  fft3dParity: typeof fft3dParity;
  pmeReciprocalParity: typeof pmeReciprocalParity;
  pmeFullParity: typeof pmeFullParity;
  tip4pPmeParity: typeof tip4pPmeParity;
  l11EngineForceParity: typeof l11EngineForceParity;
  l11EngineStepParity: typeof l11EngineStepParity;
  janecekParity: typeof janecekParity;
}

declare global {
  interface Window {
    __md?: MdHarness;
  }
}

/** Attach the harness to `window.__md` (called once at startup; harmless in normal use). */
export function installGpuHarness(): void {
  window.__md = {
    forceParity,
    stepParity,
    energyDrift,
    determinism,
    fftParity,
    fft3dParity,
    pmeReciprocalParity,
    pmeFullParity,
    tip4pPmeParity,
    l11EngineForceParity,
    l11EngineStepParity,
    janecekParity,
  };

  const installReadback = (testId: string, run: () => Promise<unknown>) => {
    const output = document.createElement("pre");
    output.dataset.testid = testId;
    output.hidden = true;
    document.body.append(output);
    const startedAt = performance.now();
    const runWhenRendererIsReady = () => {
      if ((window as unknown as { __mdRenderer?: WebGPURenderer }).__mdRenderer) {
        void run()
          .then((result) => {
            output.textContent = JSON.stringify(result);
          })
          .catch((error: unknown) => {
            output.textContent = JSON.stringify({ error: String(error) });
          });
        return;
      }
      if (performance.now() - startedAt > 15_000) {
        output.textContent = JSON.stringify({ error: "WebGPU renderer initialization timed out" });
        return;
      }
      window.requestAnimationFrame(runWhenRendererIsReady);
    };
    window.requestAnimationFrame(runWhenRendererIsReady);
  };

  const params = new URLSearchParams(window.location.search);
  const requestedFftLength = params.get("gpu-fft");
  if (requestedFftLength !== null) {
    const length = Number(requestedFftLength) || 64;
    installReadback("gpu-fft-parity", () => fftParity(length));
  }
  const requestedFft3d = params.get("gpu-fft3d");
  if (requestedFft3d !== null) {
    const dimensions = requestedFft3d.split("x").map(Number);
    const [nx = 8, ny = 4, nz = 4] = dimensions;
    installReadback("gpu-fft3d-parity", () => fft3dParity(nx, ny, nz));
  }
  const requestedPme = params.get("gpu-pme");
  if (requestedPme !== null) {
    const dimensions = requestedPme.split("x").map(Number);
    const [nx = 16, ny = 16, nz = 32] = dimensions;
    installReadback("gpu-pme-parity", () => pmeReciprocalParity(nx, ny, nz));
  }
  const requestedFullPme = params.get("gpu-pme-full");
  if (requestedFullPme !== null) {
    const dimensions = requestedFullPme.split("x").map(Number);
    const [nx = 8, ny = 8, nz = 16] = dimensions;
    installReadback("gpu-pme-full-parity", () => pmeFullParity(nx, ny, nz));
  }
  const requestedTip4p = params.get("gpu-tip4p");
  if (requestedTip4p !== null) {
    const dimensions = requestedTip4p.split("x").map(Number);
    const [nx = 8, ny = 8, nz = 16] = dimensions;
    installReadback("gpu-tip4p-parity", () => tip4pPmeParity(nx, ny, nz));
  }
  const requestedL11Force = params.get("gpu-l11-force");
  if (requestedL11Force !== null) {
    const molecules = Number(requestedL11Force) || 8;
    installReadback("gpu-l11-force-parity", () => l11EngineForceParity(molecules));
  }
  const requestedL11Step = params.get("gpu-l11-step");
  if (requestedL11Step !== null) {
    const molecules = Number(requestedL11Step) || 8;
    installReadback("gpu-l11-step-parity", () => l11EngineStepParity(molecules));
  }
  const requestedJanecek = params.get("gpu-janecek");
  if (requestedJanecek !== null) {
    const molecules = Number(requestedJanecek) || 80;
    installReadback("gpu-janecek-parity", () => janecekParity(molecules));
  }
}
