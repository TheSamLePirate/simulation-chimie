import {
  compute,
  Fn,
  float,
  If,
  instancedArray,
  instanceIndex,
  Loop,
  round,
  sqrt,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type * as THREE from "three/webgpu";
import { Vector3 } from "three/webgpu";
import { placeOnLattice, setMaxwellBoltzmannVelocities } from "../../core/init";
import { pressure } from "../../core/observables";
import { Rng } from "../../core/rng";
import { SPECIES_LIBRARY } from "../../core/species";
import { createState } from "../../core/state";
import type { Species } from "../../core/types";
import { BAR_PER_KJ_PER_MOL_NM3, temperatureFromKinetic } from "../../core/units";
import type { AccuracyLevel, Observables, SimConfig } from "../types";

const WORKGROUP = [64];
const TWO_POW_1_6 = 1.122462048309373;

// Typed storage helpers (the raw `instancedArray` overloads resolve ambiguously).
const vec3Array = (data: Float32Array) => instancedArray(data, "vec3");
const vec2Array = (data: Float32Array) => instancedArray(data, "vec2");
type Vec3Storage = ReturnType<typeof vec3Array>;
type Vec2Storage = ReturnType<typeof vec2Array>;
type Kernel = ReturnType<typeof compute>;

/** Wrap a TSL compute body into a dispatchable kernel. */
function kernel(body: () => void, count: number): Kernel {
  // `Fn(body)()` returns the body node at runtime; the typings don't expose `.compute`.
  return compute(Fn(body)() as never, count, WORKGROUP);
}

/** Component-wise round. `round` is typed scalar-only but is per-component at runtime. */
function roundVec<T>(x: T): T {
  return (round as (a: unknown) => unknown)(x) as T;
}

function resolveSpecies(name: string): Species {
  const key = name.toUpperCase() as keyof typeof SPECIES_LIBRARY;
  return SPECIES_LIBRARY[key] ?? SPECIES_LIBRARY.ARGON;
}

/**
 * WebGPU molecular-dynamics engine (TSL compute). Velocity-Verlet across three
 * compute passes (half-kick → forces → half-kick), O(N²) pair forces with periodic
 * minimum image. float32 with a fixed per-thread summation order ⇒ reproducible.
 *
 * Positions live entirely on the GPU and are read straight into the vertex stage for
 * rendering — no per-frame readback. Observables use a throttled async readback.
 */
export class GpuEngine {
  readonly config: SimConfig;
  readonly species: Species;
  readonly boxLengths: Vector3;

  readonly positions: Vec3Storage;
  private readonly velocities: Vec3Storage;
  private readonly forces: Vec3Storage;
  private readonly energyVirial: Vec2Storage;

  // Uniforms (updated from the CPU on config change).
  private readonly uDt = uniform(0);
  private readonly uHalfDt = uniform(0);
  private readonly uInvMass = uniform(0);
  private readonly uBox = uniform(new Vector3(1, 1, 1));
  private readonly uSigma2 = uniform(0);
  private readonly uEpsilon = uniform(0);
  private readonly uRc2 = uniform(0);
  private readonly uPeriodic = uniform(1);

  private readonly kZeroForces: Kernel;
  private readonly kIntegrateA: Kernel;
  private readonly kForcesWCA: Kernel;
  private readonly kForcesLJ: Kernel;
  private readonly kIntegrateB: Kernel;

  private renderer: THREE.WebGPURenderer | null = null;
  private stepCount = 0;
  private elapsed = 0;

  constructor(config: SimConfig) {
    this.config = config;
    this.species = resolveSpecies(config.speciesName);
    const n = config.particleCount;
    this.boxLengths = new Vector3(config.boxLength, config.boxLength, config.boxLength);

    // Initial conditions from the shared CPU initialiser (lattice + Maxwell-Boltzmann).
    const init = createState(n);
    const rng = new Rng(config.seed);
    const box = {
      lengths: [config.boxLength, config.boxLength, config.boxLength] as const,
      boundary: "periodic" as const,
    };
    placeOnLattice(init, box, { jitter: 0.05, rng });
    setMaxwellBoltzmannVelocities(init, [this.species], config.temperature, rng);

    this.positions = vec3Array(Float32Array.from(init.positions));
    this.velocities = vec3Array(Float32Array.from(init.velocities));
    this.forces = vec3Array(new Float32Array(n * 3));
    this.energyVirial = vec2Array(new Float32Array(n * 2));

    this.applyConfigUniforms();

    this.kZeroForces = kernel(() => {
      this.forces.element(instanceIndex).assign(vec3(0));
      this.energyVirial.element(instanceIndex).assign(vec2(0, 0));
    }, n);

    this.kIntegrateA = kernel(() => {
      const p = this.positions.element(instanceIndex);
      const v = this.velocities.element(instanceIndex);
      const f = this.forces.element(instanceIndex);
      v.addAssign(f.mul(this.uInvMass).mul(this.uHalfDt));
      p.addAssign(v.mul(this.uDt));
      If(this.uPeriodic.greaterThan(0.5), () => {
        p.assign(p.sub(this.uBox.mul(roundVec(p.div(this.uBox)))));
      });
    }, n);

    this.kForcesWCA = kernel(() => {
      const idx = instanceIndex;
      const pi = this.positions.element(idx).toVar();
      const fi = vec3(0).toVar();
      const peSum = float(0).toVar();
      const virSum = float(0).toVar();

      Loop(n, ({ i: j }) => {
        const d = pi.sub(this.positions.element(j)).toVar();
        If(this.uPeriodic.greaterThan(0.5), () => {
          d.assign(d.sub(this.uBox.mul(roundVec(d.div(this.uBox)))));
        });
        const r2 = d.dot(d).toVar();
        If(r2.greaterThan(float(1e-12)), () => {
          If(r2.lessThan(this.uRc2), () => {
            const inv2 = this.uSigma2.div(r2);
            const inv6 = inv2.mul(inv2).mul(inv2);
            const inv12 = inv6.mul(inv6);
            const fOverR = float(24).mul(this.uEpsilon).mul(inv12.mul(2).sub(inv6)).div(r2);
            fi.addAssign(d.mul(fOverR));
            peSum.addAssign(
              float(4).mul(this.uEpsilon).mul(inv12.sub(inv6)).add(this.uEpsilon).mul(0.5),
            );
            virSum.addAssign(fOverR.mul(r2).mul(0.5));
          });
        });
      });

      this.forces.element(idx).assign(fi);
      this.energyVirial.element(idx).assign(vec2(peSum, virSum));
    }, n);

    // L2 — full Lennard-Jones with shifted-force truncation at r_c = √uRc2.
    this.kForcesLJ = kernel(() => {
      const idx = instanceIndex;
      const pi = this.positions.element(idx).toVar();
      const fi = vec3(0).toVar();
      const peSum = float(0).toVar();
      const virSum = float(0).toVar();

      const rc = sqrt(this.uRc2).toVar();
      const c2 = this.uSigma2.div(this.uRc2);
      const c6 = c2.mul(c2).mul(c2);
      const c12 = c6.mul(c6);
      const fAtRc = float(24).mul(this.uEpsilon).mul(c12.mul(2).sub(c6)).div(rc);
      const vAtRc = float(4).mul(this.uEpsilon).mul(c12.sub(c6));

      Loop(n, ({ i: j }) => {
        const d = pi.sub(this.positions.element(j)).toVar();
        If(this.uPeriodic.greaterThan(0.5), () => {
          d.assign(d.sub(this.uBox.mul(roundVec(d.div(this.uBox)))));
        });
        const r2 = d.dot(d).toVar();
        If(r2.greaterThan(float(1e-12)), () => {
          If(r2.lessThan(this.uRc2), () => {
            const r = sqrt(r2);
            const inv2 = this.uSigma2.div(r2);
            const inv6 = inv2.mul(inv2).mul(inv2);
            const inv12 = inv6.mul(inv6);
            const fRadial = float(24).mul(this.uEpsilon).mul(inv12.mul(2).sub(inv6)).div(r);
            const fOverR = fRadial.sub(fAtRc).div(r);
            const v = float(4).mul(this.uEpsilon).mul(inv12.sub(inv6));
            fi.addAssign(d.mul(fOverR));
            peSum.addAssign(v.sub(vAtRc).add(r.sub(rc).mul(fAtRc)).mul(0.5));
            virSum.addAssign(fOverR.mul(r2).mul(0.5));
          });
        });
      });

      this.forces.element(idx).assign(fi);
      this.energyVirial.element(idx).assign(vec2(peSum, virSum));
    }, n);

    this.kIntegrateB = kernel(() => {
      const v = this.velocities.element(instanceIndex);
      v.addAssign(this.forces.element(instanceIndex).mul(this.uInvMass).mul(this.uHalfDt));
    }, n);
  }

  private applyConfigUniforms(): void {
    const { config, species } = this;
    this.uDt.value = config.timestep;
    this.uHalfDt.value = 0.5 * config.timestep;
    this.uInvMass.value = 1 / species.mass;
    this.uBox.value.set(config.boxLength, config.boxLength, config.boxLength);
    this.uSigma2.value = species.sigma * species.sigma;
    this.uEpsilon.value = species.epsilon;
    this.updateCutoff();
    this.uPeriodic.value = config.boundary === "periodic" ? 1 : 0;
  }

  /** Set the cutoff uniform for the active level (WCA: 2^(1/6)σ, LJ: 2.5σ). */
  private updateCutoff(): void {
    // GPU has no Coulomb kernel; L3 runs the LJ part only (2.5σ cutoff).
    const factor = this.config.level === "L2" || this.config.level === "L3" ? 2.5 : TWO_POW_1_6;
    const rc = factor * this.species.sigma;
    this.uRc2.value = rc * rc;
  }

  private get forcesEnabled(): boolean {
    return this.config.level !== "L0";
  }

  private activeForceKernel(): Kernel {
    return this.config.level === "L2" || this.config.level === "L3"
      ? this.kForcesLJ
      : this.kForcesWCA;
  }

  /** Bind the renderer. Call {@link warmup} once before stepping. */
  attach(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
  }

  /** Compute the initial forces F(0). Must be awaited before the first step. */
  async warmup(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    await renderer.computeAsync(this.forcesEnabled ? this.activeForceKernel() : this.kZeroForces);
  }

  private stepNodes(): Kernel[] {
    return this.forcesEnabled
      ? [this.kIntegrateA, this.activeForceKernel(), this.kIntegrateB]
      : [this.kIntegrateA, this.kIntegrateB];
  }

  /**
   * Advance `steps` steps for the real-time loop: dispatches are queued (not awaited);
   * the subsequent `renderer.render()` submits them. Use {@link stepAsync} when the
   * result must be read back immediately (tests / observables).
   */
  step(steps: number): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const nodes = this.stepNodes();
    for (let s = 0; s < steps; s++) {
      void renderer.computeAsync(nodes);
      this.elapsed += this.config.timestep;
      this.stepCount += 1;
    }
  }

  /** Integration steps advanced so far (synchronous counter). */
  get steps(): number {
    return this.stepCount;
  }

  /** Elapsed simulated time in ps (synchronous counter). */
  get elapsedPs(): number {
    return this.elapsed;
  }

  /** Advance `steps` steps, awaiting GPU completion (so buffers are readable). */
  async stepAsync(steps: number): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    const nodes = this.stepNodes();
    for (let s = 0; s < steps; s++) {
      await renderer.computeAsync(nodes);
      this.elapsed += this.config.timestep;
      this.stepCount += 1;
    }
  }

  /** Read measurements back from the GPU (async). Throttle the caller. */
  async observables(): Promise<Observables> {
    const renderer = this.renderer;
    const n = this.config.particleCount;
    const base = { step: this.stepCount, time: this.elapsed };
    if (!renderer) {
      return {
        ...base,
        kineticEnergy: 0,
        potentialEnergy: 0,
        totalEnergy: 0,
        temperature: 0,
        pressure: 0,
      };
    }

    const [velBuf, evBuf] = await Promise.all([
      renderer.getArrayBufferAsync(this.velocities.value),
      renderer.getArrayBufferAsync(this.energyVirial.value),
    ]);
    const vel = new Float32Array(velBuf);
    const ev = new Float32Array(evBuf);

    const mass = this.species.mass;
    let ke = 0;
    for (let i = 0; i < n; i++) {
      const vx = vel[3 * i];
      const vy = vel[3 * i + 1];
      const vz = vel[3 * i + 2];
      ke += 0.5 * mass * (vx * vx + vy * vy + vz * vz);
    }
    let pe = 0;
    let virial = 0;
    for (let i = 0; i < n; i++) {
      pe += ev[2 * i];
      virial += ev[2 * i + 1];
    }

    const volume = this.config.boxLength ** 3;
    const pInternal = pressure(ke, virial, volume);
    return {
      ...base,
      kineticEnergy: ke,
      potentialEnergy: pe,
      totalEnergy: ke + pe,
      temperature: temperatureFromKinetic(ke, 3 * n - 3),
      pressure: pInternal * BAR_PER_KJ_PER_MOL_NM3,
    };
  }

  /** Read the current positions back to the CPU (for tests / parity checks). */
  async readPositions(): Promise<Float32Array> {
    const renderer = this.renderer;
    if (!renderer) return new Float32Array(this.config.particleCount * 3);
    return new Float32Array(await renderer.getArrayBufferAsync(this.positions.value));
  }

  /** Read the current forces back to the CPU (for parity checks). */
  async readForces(): Promise<Float32Array> {
    const renderer = this.renderer;
    if (!renderer) return new Float32Array(this.config.particleCount * 3);
    return new Float32Array(await renderer.getArrayBufferAsync(this.forces.value));
  }

  setLevel(level: AccuracyLevel): void {
    (this.config as { level: AccuracyLevel }).level = level;
    this.updateCutoff();
    void this.renderer?.computeAsync(
      this.forcesEnabled ? this.activeForceKernel() : this.kZeroForces,
    );
  }

  setTimestep(dt: number): void {
    (this.config as { timestep: number }).timestep = dt;
    this.uDt.value = dt;
    this.uHalfDt.value = 0.5 * dt;
  }

  dispose(): void {
    this.renderer = null;
  }
}
