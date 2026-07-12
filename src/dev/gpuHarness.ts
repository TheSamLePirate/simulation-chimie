import type { WebGPURenderer } from "three/webgpu";
import { fft1d } from "../core/math/fft";
import { CpuEngine } from "../engine/cpu/CpuEngine";
import { GpuEngine } from "../engine/gpu/GpuEngine";
import { GpuFft1d } from "../engine/gpu/GpuFft";
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

export interface MdHarness {
  forceParity: typeof forceParity;
  stepParity: typeof stepParity;
  energyDrift: typeof energyDrift;
  determinism: typeof determinism;
  fftParity: typeof fftParity;
}

declare global {
  interface Window {
    __md?: MdHarness;
  }
}

/** Attach the harness to `window.__md` (called once at startup; harmless in normal use). */
export function installGpuHarness(): void {
  window.__md = { forceParity, stepParity, energyDrift, determinism, fftParity };

  const requestedFftLength = new URLSearchParams(window.location.search).get("gpu-fft");
  if (requestedFftLength !== null) {
    const output = document.createElement("pre");
    output.dataset.testid = "gpu-fft-parity";
    output.hidden = true;
    document.body.append(output);

    const length = Number(requestedFftLength) || 64;
    const startedAt = performance.now();
    const runWhenRendererIsReady = () => {
      if ((window as unknown as { __mdRenderer?: WebGPURenderer }).__mdRenderer) {
        void fftParity(length)
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
  }
}
