import {
  acos,
  atomicAdd,
  atomicLoad,
  atomicStore,
  clamp,
  compute,
  exp,
  Fn,
  float,
  floor,
  If,
  instancedArray,
  instanceIndex,
  int,
  Loop,
  max,
  mod,
  round,
  sqrt,
  uint,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type * as THREE from "three/webgpu";
import { Vector3 } from "three/webgpu";
import { erfc as erfcScalar } from "../../core/math/erf";
import { pressure } from "../../core/observables";
import { SPECIES_LIBRARY } from "../../core/species";
import type { Species } from "../../core/types";
import { BAR_PER_KJ_PER_MOL_NM3, COULOMB_CONSTANT, temperatureFromKinetic } from "../../core/units";
import { buildSystem } from "../buildSystem";
import type { AccuracyLevel, Observables, SimConfig } from "../types";

const WORKGROUP = [64];
/** Fixed-point scale for the i32 quantised force accumulator (WebGPU has no f32 atomics). */
const FORCE_SCALE = 1 << 14; // 16384 ⇒ ~±1.3e5 kJ·mol⁻¹·nm⁻¹ range, ~6e-5 resolution

/** Pack per-bond (i,j) atom indices into a flat uint array (min length 1 for empty topology). */
function packBondIdx(i: Int32Array, j: Int32Array): Uint32Array {
  const out = new Uint32Array(2 * Math.max(1, i.length));
  for (let b = 0; b < i.length; b++) {
    out[2 * b] = i[b];
    out[2 * b + 1] = j[b];
  }
  return out;
}
/** Pack per-angle (i,j,k) atom indices into a flat uint array. */
function packAngleIdx(i: Int32Array, j: Int32Array, k: Int32Array): Uint32Array {
  const out = new Uint32Array(3 * Math.max(1, i.length));
  for (let a = 0; a < i.length; a++) {
    out[3 * a] = i[a];
    out[3 * a + 1] = j[a];
    out[3 * a + 2] = k[a];
  }
  return out;
}
/** Interleave two Float32 arrays into a vec2 buffer (e.g. (r0,k) or (theta0,kt) per item). */
function packPairF32(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(2 * Math.max(1, a.length));
  for (let x = 0; x < a.length; x++) {
    out[2 * x] = a[x];
    out[2 * x + 1] = b[x];
  }
  return out;
}
const packScalarF32 = (a: Float32Array): Float32Array =>
  a.length ? Float32Array.from(a) : new Float32Array(1);
const TWO_POW_1_6 = 1.122462048309373;
/** Max particles per cell bin. Generous vs liquid occupancy (~15) to avoid dropped pairs. */
const CELL_CAPACITY = 96;

// Typed storage helpers (the raw `instancedArray` overloads resolve ambiguously).
const vec3Array = (data: Float32Array) => instancedArray(data, "vec3");
const vec2Array = (data: Float32Array) => instancedArray(data, "vec2");
const vec4Array = (data: Float32Array) => instancedArray(data, "vec4");
const uintArray = (data: Uint32Array) => instancedArray(data, "uint");
const floatArray = (data: Float32Array) => instancedArray(data, "float");
type Vec3Storage = ReturnType<typeof vec3Array>;
type Vec2Storage = ReturnType<typeof vec2Array>;
type Vec4Storage = ReturnType<typeof vec4Array>;
type UintStorage = ReturnType<typeof uintArray>;
type FloatStorage = ReturnType<typeof floatArray>;
type Kernel = ReturnType<typeof compute>;

// biome-ignore lint/suspicious/noExplicitAny: TSL node arithmetic is loosely typed.
type Node = any;

/** erfc(x) for x ≥ 0 (Numerical Recipes rational-exponential approximation), in TSL. */
function erfcApprox(x: Node): Node {
  const t = float(1).div(x.mul(0.5).add(1));
  const p = t
    .mul(0.17087277)
    .add(-0.82215223)
    .mul(t)
    .add(1.48851587)
    .mul(t)
    .add(-1.13520398)
    .mul(t)
    .add(0.27886807)
    .mul(t)
    .add(-0.18628806)
    .mul(t)
    .add(0.09678418)
    .mul(t)
    .add(0.37409196)
    .mul(t)
    .add(1.00002368)
    .mul(t)
    .add(-1.26551223);
  return t.mul(exp(x.mul(x).mul(-1).add(p)));
}

/** Wrap a TSL compute body into a dispatchable kernel. */
function kernel(body: () => void, count: number): Kernel {
  // `Fn(body)()` returns the body node at runtime; the typings don't expose `.compute`.
  return compute(Fn(body)() as never, count, WORKGROUP);
}

/** Component-wise round. `round` is typed scalar-only but is per-component at runtime. */
function roundVec<T>(x: T): T {
  return (round as (a: unknown) => unknown)(x) as T;
}

/**
 * Re-wrap a node as a fluent float node. Some TSL builders (`clamp`, `mod`, `floor`) and
 * the atomic ops return the bare `Node` type, which loses the chained `.mul/.add/...`
 * arithmetic API in the typings (the runtime supports it). `fl()` restores it.
 */
const fl = (x: unknown) => float(x as never);
/** Re-wrap as a fluent int / uint node (the typings reject atomic / derived nodes here). */
const iv = (x: unknown) => int(x as never);
const uv = (x: unknown) => uint(x as never);

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
  /** Per-atom (σ, ε, charge, 1/mass) — enables multi-species + electrostatics on the GPU. */
  private readonly params: Vec4Storage;
  private readonly masses: Float64Array;
  /** Per-atom RGB colour (0–1) and radius (nm) for multi-species GPU rendering. */
  readonly renderColors: Float32Array;
  readonly renderRadii: Float32Array;

  /** Atom count (≥ 3× molecule count for molecular systems); the kernel dispatch size. */
  readonly atomCount: number;
  /** True for molecular levels (L4–L8): bonded forces + intramolecular exclusions + constraints. */
  readonly molecular: boolean;
  /** Render bonds (i,j) for ball-and-stick molecular drawing, or null (monatomic). */
  readonly renderBonds: { i: Int32Array; j: Int32Array } | null;
  /** Per-atom molecule id (for intramolecular nonbonded exclusions). */
  private readonly moleculeIds: UintStorage;
  /** i32 (stored as uint, atomic) quantised force accumulator for bonded scatter-adds. */
  private readonly forceQ: UintStorage;
  /** Positions before the constraint step (for SETTLE/RATTLE). */
  private readonly refPositions: Vec3Storage;
  // Flat bonded topology (uploaded once; box/forcefield are fixed per engine instance).
  private readonly numBonds: number;
  private readonly numAngles: number;
  private readonly numConstraints: number;
  private readonly bondIdx: UintStorage;
  private readonly bondParam: Vec2Storage;
  private readonly angleIdx: UintStorage;
  private readonly angleParam: Vec2Storage;
  private readonly constraintIdx: UintStorage;
  private readonly constraintD0: FloatStorage;

  // Uniforms (updated from the CPU on config change).
  private readonly uDt = uniform(0);
  private readonly uHalfDt = uniform(0);
  private readonly uInvMass = uniform(0);
  private readonly uBox = uniform(new Vector3(1, 1, 1));
  private readonly uSigma2 = uniform(0);
  private readonly uEpsilon = uniform(0);
  private readonly uRc2 = uniform(0);
  private readonly uPeriodic = uniform(1);
  private readonly uGravity = uniform(0);
  // Electrostatics (Coulomb–Wolf DSF). uUseCoulomb / uUseShift switch the force form per level.
  private readonly uAlpha = uniform(2.5);
  private readonly uRcC2 = uniform(0);
  private readonly uErfcRc = uniform(0);
  private readonly uShiftC = uniform(0);
  private readonly uRcC = uniform(0);
  private readonly uKe = uniform(0);
  private readonly uUseCoulomb = uniform(0);
  private readonly uUseShift = uniform(0);
  // Cell-list grid.
  private readonly uCellsPerAxis = uniform(1);
  private readonly uCellSize = uniform(1);
  private readonly uHalfBox = uniform(0.5);
  // Berendsen thermostat scale (computed on CPU from the readback KE; 1 = no-op).
  private readonly uThermoLambda = uniform(1);

  private readonly cellCounts: UintStorage;
  private readonly cellParticles: UintStorage;
  private cellsEnabled = false;

  private readonly kZeroForces: Kernel;
  private readonly kIntegrateA: Kernel;
  private readonly kForcesWCA: Kernel;
  private readonly kForcesLJ: Kernel;
  private readonly kClearCells: Kernel;
  private readonly kBinParticles: Kernel;
  private readonly kForcesCellWCA: Kernel;
  private readonly kForcesCellLJ: Kernel;
  private readonly kThermostat: Kernel;
  private readonly kIntegrateB: Kernel;
  // Molecular kernels (built only for molecular systems; null for monatomic L0–L3).
  private readonly kForcesMol: Kernel | null;
  private readonly kBondForces: Kernel | null;
  private readonly kAngleForces: Kernel | null;
  private readonly kAddQForces: Kernel | null;
  private readonly kZeroForceQ: Kernel | null;
  private readonly kSettle: Kernel | null;
  private readonly kRattle: Kernel | null;
  private readonly kSaveRef: Kernel | null;

  private renderer: THREE.WebGPURenderer | null = null;
  private stepCount = 0;
  private elapsed = 0;

  constructor(config: SimConfig) {
    this.config = config;
    this.species = resolveSpecies(config.speciesName);

    // Build the full system (state + species + flat topology) the same way the CPU engine
    // does — this is what lets molecular levels (L4–L8: water, oil, ions) run on the GPU.
    const system = buildSystem(config);
    const { state, box, species, bonds, angles, constraints } = system;
    const n = state.count; // ATOM count (molecular systems have ≥3× the molecule count)
    this.atomCount = n;
    this.molecular = system.molecular;
    this.renderBonds = system.renderBonds;
    this.boxLengths = new Vector3(box.lengths[0], box.lengths[1], box.lengths[2]);
    const typeIds = state.typeIds;

    // Per-atom (σ, ε, charge, 1/mass) packed into a vec4, + CPU mass / render arrays.
    const param = new Float32Array(n * 4);
    this.masses = new Float64Array(n);
    this.renderColors = new Float32Array(n * 3);
    this.renderRadii = new Float32Array(n);
    const renderScale = this.molecular ? 0.42 : 0.78; // ball-and-stick for molecules
    for (let i = 0; i < n; i++) {
      const s = species[typeIds[i]];
      param[4 * i] = s.sigma;
      param[4 * i + 1] = s.epsilon;
      param[4 * i + 2] = s.charge;
      param[4 * i + 3] = 1 / s.mass;
      this.masses[i] = s.mass;
      this.renderColors[3 * i] = ((s.color >> 16) & 0xff) / 255;
      this.renderColors[3 * i + 1] = ((s.color >> 8) & 0xff) / 255;
      this.renderColors[3 * i + 2] = (s.color & 0xff) / 255;
      this.renderRadii[i] = s.radius * renderScale;
    }
    this.params = vec4Array(param);

    this.positions = vec3Array(Float32Array.from(state.positions));
    this.velocities = vec3Array(Float32Array.from(state.velocities));
    this.forces = vec3Array(new Float32Array(n * 3));
    this.energyVirial = vec2Array(new Float32Array(n * 2));
    this.moleculeIds = uintArray(Uint32Array.from(state.moleculeId));

    // Bonded topology + i32 quantised force accumulator (WebGPU has no f32 atomics, so bonded
    // kernels scatter forces as fixed-point integers; a dequantise pass adds them to `forces`).
    this.numBonds = bonds.i.length;
    this.numAngles = angles.i.length;
    this.numConstraints = constraints.i.length;
    this.bondIdx = uintArray(packBondIdx(bonds.i, bonds.j));
    this.bondParam = vec2Array(packPairF32(bonds.r0, bonds.k));
    this.angleIdx = uintArray(packAngleIdx(angles.i, angles.j, angles.k));
    this.angleParam = vec2Array(packPairF32(angles.theta0, angles.kt));
    this.constraintIdx = uintArray(packBondIdx(constraints.i, constraints.j));
    this.constraintD0 = floatArray(packScalarF32(constraints.d0));
    this.forceQ = uintArray(new Uint32Array(n * 3)).toAtomic();
    this.refPositions = vec3Array(new Float32Array(n * 3));

    // Cell-list buffers sized for the FINEST grid (WCA cutoff ⇒ most cells); coarser
    // levels (bigger cutoff) use a subset. Box is fixed per engine (GPU has no barostat).
    const rcFinest = TWO_POW_1_6 * this.species.sigma;
    const cpaMax = Math.max(1, Math.floor(config.boxLength / rcFinest));
    const nCellsAlloc = cpaMax * cpaMax * cpaMax;
    this.cellCounts = uintArray(new Uint32Array(nCellsAlloc)).toAtomic();
    this.cellParticles = uintArray(new Uint32Array(nCellsAlloc * CELL_CAPACITY));

    this.applyConfigUniforms();

    this.kZeroForces = kernel(() => {
      this.forces.element(instanceIndex).assign(vec3(0));
      this.energyVirial.element(instanceIndex).assign(vec2(0, 0));
    }, n);

    // Shifted-force LJ constants at r_c = 2.5σ: (σ/r_c)² = (1/2.5)² = 0.16 ⇒ σ-independent.
    const C6 = 0.16 ** 3;
    const C12 = 0.16 ** 6;
    const TWO_PI = 2 / Math.sqrt(Math.PI);

    this.kIntegrateA = kernel(() => {
      const p = this.positions.element(instanceIndex);
      const v = this.velocities.element(instanceIndex);
      const f = this.forces.element(instanceIndex);
      const invM = this.params.element(instanceIndex).w;
      v.addAssign(
        f
          .mul(invM)
          .sub(vec3(0, this.uGravity, 0))
          .mul(this.uHalfDt),
      );
      p.addAssign(v.mul(this.uDt));
      If(this.uPeriodic.greaterThan(0.5), () => {
        p.assign(p.sub(this.uBox.mul(roundVec(p.div(this.uBox)))));
      });
    }, n);

    // L1 — multi-species WCA (purely repulsive LJ truncated at 2^(1/6)·σ_ij).
    this.kForcesWCA = kernel(() => {
      const idx = instanceIndex;
      const pi = this.positions.element(idx).toVar();
      const pmi = this.params.element(idx).toVar();
      const fi = vec3(0).toVar();
      const peSum = float(0).toVar();
      const virSum = float(0).toVar();

      Loop(n, ({ i: j }) => {
        const d = pi.sub(this.positions.element(j)).toVar();
        If(this.uPeriodic.greaterThan(0.5), () => {
          d.assign(d.sub(this.uBox.mul(roundVec(d.div(this.uBox)))));
        });
        const r2 = d.dot(d).toVar();
        const pj = this.params.element(j);
        const sigma = pmi.x.add(pj.x).mul(0.5);
        const eps = sqrt(pmi.y.mul(pj.y));
        const rcW = sigma.mul(TWO_POW_1_6);
        const rc2 = rcW.mul(rcW);
        If(r2.greaterThan(float(1e-12)), () => {
          If(r2.lessThan(rc2), () => {
            const inv2 = sigma.mul(sigma).div(r2);
            const inv6 = inv2.mul(inv2).mul(inv2);
            const inv12 = inv6.mul(inv6);
            const fOverR = float(24).mul(eps).mul(inv12.mul(2).sub(inv6)).div(r2);
            fi.addAssign(d.mul(fOverR));
            peSum.addAssign(float(4).mul(eps).mul(inv12.sub(inv6)).add(eps).mul(0.5));
            virSum.addAssign(fOverR.mul(r2).mul(0.5));
          });
        });
      });

      this.forces.element(idx).assign(fi);
      this.energyVirial.element(idx).assign(vec2(peSum, virSum));
    }, n);

    // L2/L3 — multi-species shifted-force LJ (Lorentz-Berthelot) + optional Coulomb (Wolf DSF).
    this.kForcesLJ = kernel(() => {
      const idx = instanceIndex;
      const pi = this.positions.element(idx).toVar();
      const pmi = this.params.element(idx).toVar();
      const fi = vec3(0).toVar();
      const peSum = float(0).toVar();
      const virSum = float(0).toVar();

      Loop(n, ({ i: j }) => {
        const d = pi.sub(this.positions.element(j)).toVar();
        If(this.uPeriodic.greaterThan(0.5), () => {
          d.assign(d.sub(this.uBox.mul(roundVec(d.div(this.uBox)))));
        });
        const r2 = d.dot(d).toVar();
        const pj = this.params.element(j);
        const sigma = pmi.x.add(pj.x).mul(0.5);
        const eps = sqrt(pmi.y.mul(pj.y));
        const qq = pmi.z.mul(pj.z);
        const rcLj = sigma.mul(2.5);
        const rcLj2 = rcLj.mul(rcLj);

        If(r2.greaterThan(float(1e-12)), () => {
          const r = sqrt(r2).toVar();
          const fOverR = float(0).toVar();

          If(r2.lessThan(rcLj2), () => {
            const inv2 = sigma.mul(sigma).div(r2);
            const inv6 = inv2.mul(inv2).mul(inv2);
            const inv12 = inv6.mul(inv6);
            const fAtRc = float(24)
              .mul(eps)
              .mul(C12 * 2 - C6)
              .div(rcLj);
            const vAtRc = float(4)
              .mul(eps)
              .mul(C12 - C6);
            const fRadial = float(24).mul(eps).mul(inv12.mul(2).sub(inv6)).div(r);
            fOverR.addAssign(fRadial.sub(fAtRc).div(r));
            const vv = float(4).mul(eps).mul(inv12.sub(inv6));
            peSum.addAssign(vv.sub(vAtRc).add(r.sub(rcLj).mul(fAtRc)).mul(0.5));
          });

          If(this.uUseCoulomb.greaterThan(0.5), () => {
            If(r2.lessThan(this.uRcC2), () => {
              const erfcR = erfcApprox(this.uAlpha.mul(r));
              const expR = exp(this.uAlpha.mul(this.uAlpha).mul(r2).mul(-1));
              const fCoul = this.uKe
                .mul(qq)
                .mul(
                  erfcR
                    .div(r2)
                    .add(float(TWO_PI).mul(this.uAlpha).mul(expR).div(r))
                    .sub(this.uShiftC),
                );
              fOverR.addAssign(fCoul.div(r));
              peSum.addAssign(
                this.uKe
                  .mul(qq)
                  .mul(
                    erfcR
                      .div(r)
                      .sub(this.uErfcRc.div(this.uRcC))
                      .add(this.uShiftC.mul(r.sub(this.uRcC))),
                  )
                  .mul(0.5),
              );
            });
          });

          fi.addAssign(d.mul(fOverR));
          virSum.addAssign(fOverR.mul(r2).mul(0.5));
        });
      });

      this.forces.element(idx).assign(fi);
      this.energyVirial.element(idx).assign(vec2(peSum, virSum));
    }, n);

    this.kIntegrateB = kernel(() => {
      const v = this.velocities.element(instanceIndex);
      const f = this.forces.element(instanceIndex);
      const invM = this.params.element(instanceIndex).w;
      v.addAssign(
        f
          .mul(invM)
          .sub(vec3(0, this.uGravity, 0))
          .mul(this.uHalfDt),
      );
    }, n);

    // --- Cell-list neighbour search (spatial hash + atomic bins) ---
    this.kClearCells = kernel(() => {
      atomicStore(this.cellCounts.element(instanceIndex), uint(0));
    }, nCellsAlloc);

    this.kBinParticles = kernel(() => {
      const ciF = this.cellIndexFloat(this.positions.element(instanceIndex)).toVar();
      // atomicAdd returns the previous count = this particle's slot in the bin.
      const slotF = fl(atomicAdd(this.cellCounts.element(uint(ciF)), uint(1))).toVar();
      If(slotF.lessThan(float(CELL_CAPACITY)), () => {
        const dst = uint(ciF.mul(CELL_CAPACITY).add(slotF));
        this.cellParticles.element(dst).assign(instanceIndex);
      });
    }, n);

    this.kForcesCellWCA = this.buildCellForceKernel(false);
    this.kForcesCellLJ = this.buildCellForceKernel(true);

    // Berendsen thermostat: scale velocities by λ (computed on CPU from the readback KE).
    this.kThermostat = kernel(() => {
      const v = this.velocities.element(instanceIndex);
      v.assign(v.mul(this.uThermoLambda));
    }, n);

    // --- Molecular kernels: nonbonded with exclusions + bonded forces + rigid constraints ---
    const rigid = this.numConstraints > 0;
    this.kZeroForceQ = this.molecular ? this.buildZeroForceQ() : null;
    this.kForcesMol = this.molecular ? this.buildMolNonbonded() : null;
    this.kBondForces = this.molecular && this.numBonds > 0 ? this.buildBondForces() : null;
    this.kAngleForces = this.molecular && this.numAngles > 0 ? this.buildAngleForces() : null;
    this.kAddQForces = this.molecular ? this.buildAddQForces() : null;
    this.kSaveRef = rigid ? this.buildSaveRef() : null;
    this.kSettle = rigid ? this.buildSettle() : null;
    this.kRattle = rigid ? this.buildRattle() : null;
  }

  /** Wrap a separation vector to the minimum image (no-op for reflective boundaries). */
  private wrapMinImage(d: Node): void {
    If(this.uPeriodic.greaterThan(0.5), () => {
      d.assign(d.sub(this.uBox.mul(roundVec(d.div(this.uBox)))));
    });
  }

  /** Scatter a vec3 force onto an atom's i32 quantised accumulator (atomic, race-safe). */
  private addForceQ(atomIdx: Node, f: Node): void {
    const base = atomIdx.mul(3);
    atomicAdd(this.forceQ.element(uv(base)), uv(iv(roundVec(f.x.mul(FORCE_SCALE)))));
    atomicAdd(this.forceQ.element(uv(base.add(1))), uv(iv(roundVec(f.y.mul(FORCE_SCALE)))));
    atomicAdd(this.forceQ.element(uv(base.add(2))), uv(iv(roundVec(f.z.mul(FORCE_SCALE)))));
  }

  /** Zero the i32 quantised bonded-force accumulator (3 components per atom). */
  private buildZeroForceQ(): Kernel {
    return kernel(() => {
      atomicStore(this.forceQ.element(instanceIndex), uint(0));
    }, this.atomCount * 3);
  }

  /** Multi-species LJ (Lorentz-Berthelot) + Coulomb (Wolf DSF) with intramolecular exclusions. */
  private buildMolNonbonded(): Kernel {
    const n = this.atomCount;
    const C6 = 0.16 ** 3;
    const C12 = 0.16 ** 6;
    const TWO_PI = 2 / Math.sqrt(Math.PI);
    return kernel(() => {
      const idx = instanceIndex;
      const pi = this.positions.element(idx).toVar();
      const pmi = this.params.element(idx).toVar();
      const myMol = this.moleculeIds.element(idx).toVar();
      const fi = vec3(0).toVar();
      const peSum = float(0).toVar();
      const virSum = float(0).toVar();

      Loop(n, ({ i: j }) => {
        // Intramolecular exclusion: skip bonded (same-molecule) pairs incl. self.
        If(this.moleculeIds.element(j).notEqual(myMol), () => {
          const d = pi.sub(this.positions.element(j)).toVar();
          this.wrapMinImage(d);
          const r2 = d.dot(d).toVar();
          const pj = this.params.element(j);
          const sigma = pmi.x.add(pj.x).mul(0.5);
          const eps = sqrt(pmi.y.mul(pj.y));
          const qq = pmi.z.mul(pj.z);
          const rcLj = sigma.mul(2.5);
          const rcLj2 = rcLj.mul(rcLj);

          If(r2.greaterThan(float(1e-12)), () => {
            const r = sqrt(r2).toVar();
            const fOverR = float(0).toVar();

            If(r2.lessThan(rcLj2), () => {
              const inv2 = sigma.mul(sigma).div(r2);
              const inv6 = inv2.mul(inv2).mul(inv2);
              const inv12 = inv6.mul(inv6);
              const fAtRc = float(24)
                .mul(eps)
                .mul(C12 * 2 - C6)
                .div(rcLj);
              const vAtRc = float(4)
                .mul(eps)
                .mul(C12 - C6);
              const fRadial = float(24).mul(eps).mul(inv12.mul(2).sub(inv6)).div(r);
              fOverR.addAssign(fRadial.sub(fAtRc).div(r));
              const vv = float(4).mul(eps).mul(inv12.sub(inv6));
              peSum.addAssign(vv.sub(vAtRc).add(r.sub(rcLj).mul(fAtRc)).mul(0.5));
            });

            If(this.uUseCoulomb.greaterThan(0.5), () => {
              If(r2.lessThan(this.uRcC2), () => {
                const erfcR = erfcApprox(this.uAlpha.mul(r));
                const expR = exp(this.uAlpha.mul(this.uAlpha).mul(r2).mul(-1));
                const fCoul = this.uKe
                  .mul(qq)
                  .mul(
                    erfcR
                      .div(r2)
                      .add(float(TWO_PI).mul(this.uAlpha).mul(expR).div(r))
                      .sub(this.uShiftC),
                  );
                fOverR.addAssign(fCoul.div(r));
                peSum.addAssign(
                  this.uKe
                    .mul(qq)
                    .mul(
                      erfcR
                        .div(r)
                        .sub(this.uErfcRc.div(this.uRcC))
                        .add(this.uShiftC.mul(r.sub(this.uRcC))),
                    )
                    .mul(0.5),
                );
              });
            });

            fi.addAssign(d.mul(fOverR));
            virSum.addAssign(fOverR.mul(r2).mul(0.5));
          });
        });
      });

      this.forces.element(idx).assign(fi);
      this.energyVirial.element(idx).assign(vec2(peSum, virSum));
    }, n);
  }

  /** Harmonic bonds: one thread per bond, scatter forces via the i32 accumulator. */
  private buildBondForces(): Kernel {
    return kernel(() => {
      const b = instanceIndex;
      const i = this.bondIdx.element(b.mul(2)).toVar();
      const j = this.bondIdx.element(b.mul(2).add(1)).toVar();
      const par = this.bondParam.element(b).toVar(); // (r0, k)
      const d = this.positions.element(i).sub(this.positions.element(j)).toVar();
      this.wrapMinImage(d);
      const r = sqrt(d.dot(d)).toVar();
      const fOverR = par.y
        .mul(r.sub(par.x))
        .mul(-1)
        .div(max(r, float(1e-9)));
      const fvec = d.mul(fOverR).toVar();
      this.addForceQ(i, fvec);
      this.addForceQ(j, fvec.mul(-1));
    }, this.numBonds);
  }

  /** Harmonic angles (j = vertex): one thread per angle, scatter forces via the i32 accumulator. */
  private buildAngleForces(): Kernel {
    return kernel(() => {
      const a = instanceIndex;
      const i = this.angleIdx.element(a.mul(3)).toVar();
      const j = this.angleIdx.element(a.mul(3).add(1)).toVar();
      const k = this.angleIdx.element(a.mul(3).add(2)).toVar();
      const par = this.angleParam.element(a).toVar(); // (theta0, kt)
      const rij = this.positions.element(i).sub(this.positions.element(j)).toVar();
      this.wrapMinImage(rij);
      const rkj = this.positions.element(k).sub(this.positions.element(j)).toVar();
      this.wrapMinImage(rkj);
      const lij = max(sqrt(rij.dot(rij)), float(1e-9)).toVar();
      const lkj = max(sqrt(rkj.dot(rkj)), float(1e-9)).toVar();
      const cosT = clamp(rij.dot(rkj).div(lij.mul(lkj)), float(-1), float(1)).toVar();
      const sinT = max(sqrt(float(1).sub(cosT.mul(cosT))), float(1e-6)).toVar();
      const factor = par.y.mul(acos(cosT).sub(par.x)).div(sinT).toVar();
      const fi = rkj
        .div(lij.mul(lkj))
        .sub(rij.mul(cosT).div(lij.mul(lij)))
        .mul(factor)
        .toVar();
      const fk = rij
        .div(lij.mul(lkj))
        .sub(rkj.mul(cosT).div(lkj.mul(lkj)))
        .mul(factor)
        .toVar();
      this.addForceQ(i, fi);
      this.addForceQ(k, fk);
      this.addForceQ(j, fi.add(fk).mul(-1));
    }, this.numAngles);
  }

  /** Dequantise the bonded-force accumulator and add it into the f32 force buffer. */
  private buildAddQForces(): Kernel {
    return kernel(() => {
      const idx = instanceIndex;
      const base = idx.mul(3);
      const fx = fl(iv(atomicLoad(this.forceQ.element(uv(base))))).div(FORCE_SCALE);
      const fy = fl(iv(atomicLoad(this.forceQ.element(uv(base.add(1)))))).div(FORCE_SCALE);
      const fz = fl(iv(atomicLoad(this.forceQ.element(uv(base.add(2)))))).div(FORCE_SCALE);
      this.forces.element(idx).addAssign(vec3(fx, fy, fz));
    }, this.atomCount);
  }

  /** Save positions before the constraint step (SETTLE/RATTLE reference). */
  private buildSaveRef(): Kernel {
    return kernel(() => {
      this.refPositions.element(instanceIndex).assign(this.positions.element(instanceIndex));
    }, this.atomCount);
  }

  /** One SHAKE position correction for a constraint pair (mutates the pa/pb/va/vb vars). */
  private shakePair(
    pa: Node,
    pb: Node,
    va: Node,
    vb: Node,
    ra: Node,
    rb: Node,
    d0: Node,
    iA: Node,
    iB: Node,
  ): void {
    const s = pa.sub(pb).toVar();
    this.wrapMinImage(s);
    const r = ra.sub(rb).toVar();
    this.wrapMinImage(r);
    const diff = d0.mul(d0).sub(s.dot(s));
    const g = diff.div(float(2).mul(iA.add(iB)).mul(r.dot(s)).add(1e-12));
    pa.addAssign(r.mul(iA.mul(g)));
    pb.addAssign(r.mul(iB.mul(g)).mul(-1));
    const gdt = g.div(this.uDt);
    va.addAssign(r.mul(iA.mul(gdt)));
    vb.addAssign(r.mul(iB.mul(gdt)).mul(-1));
  }

  /** One RATTLE velocity correction for a constraint pair (mutates va/vb). */
  private rattlePair(pa: Node, pb: Node, va: Node, vb: Node, iA: Node, iB: Node): void {
    const r = pa.sub(pb).toVar();
    this.wrapMinImage(r);
    const rv = r.dot(va.sub(vb));
    const kf = rv.mul(-1).div(iA.add(iB).mul(r.dot(r)).add(1e-12));
    va.addAssign(r.mul(iA.mul(kf)));
    vb.addAssign(r.mul(iB.mul(kf)).mul(-1));
  }

  /** Per-water-molecule indices: constraint triple 3g=(O,H1), 3g+1=(O,H2), 3g+2=(H1,H2). */
  private waterAtoms(g: Node): {
    iO: Node;
    iH1: Node;
    iH2: Node;
    dOH: Node;
    dHH: Node;
  } {
    const c0 = g.mul(3);
    return {
      iO: uv(this.constraintIdx.element(c0.mul(2))),
      iH1: uv(this.constraintIdx.element(c0.mul(2).add(1))),
      iH2: uv(this.constraintIdx.element(c0.add(1).mul(2).add(1))),
      dOH: this.constraintD0.element(c0),
      dHH: this.constraintD0.element(c0.add(2)),
    };
  }

  /**
   * Rigid water by per-molecule SHAKE — one thread per molecule owns its 3 atoms (O,H1,H2), so
   * the iterations are race-free (no atomics). Equivalent in effect to SETTLE for 3-site water,
   * but reuses the validated CPU SHAKE algorithm. Fixed iteration count (no early exit on GPU).
   */
  private buildSettle(): Kernel {
    const ITERS = 6;
    return kernel(
      () => {
        const a = this.waterAtoms(instanceIndex);
        const pO = this.positions.element(a.iO).toVar();
        const pH1 = this.positions.element(a.iH1).toVar();
        const pH2 = this.positions.element(a.iH2).toVar();
        const vO = this.velocities.element(a.iO).toVar();
        const vH1 = this.velocities.element(a.iH1).toVar();
        const vH2 = this.velocities.element(a.iH2).toVar();
        const rO = this.refPositions.element(a.iO).toVar();
        const rH1 = this.refPositions.element(a.iH1).toVar();
        const rH2 = this.refPositions.element(a.iH2).toVar();
        const iMO = this.params.element(a.iO).w;
        const iMH = this.params.element(a.iH1).w;
        Loop(ITERS, () => {
          this.shakePair(pO, pH1, vO, vH1, rO, rH1, a.dOH, iMO, iMH);
          this.shakePair(pO, pH2, vO, vH2, rO, rH2, a.dOH, iMO, iMH);
          this.shakePair(pH1, pH2, vH1, vH2, rH1, rH2, a.dHH, iMH, iMH);
        });
        this.positions.element(a.iO).assign(pO);
        this.positions.element(a.iH1).assign(pH1);
        this.positions.element(a.iH2).assign(pH2);
        this.velocities.element(a.iO).assign(vO);
        this.velocities.element(a.iH1).assign(vH1);
        this.velocities.element(a.iH2).assign(vH2);
      },
      Math.max(1, this.numConstraints / 3),
    );
  }

  /** Rigid water velocity correction by per-molecule RATTLE (race-free, one thread per molecule). */
  private buildRattle(): Kernel {
    const ITERS = 4;
    return kernel(
      () => {
        const a = this.waterAtoms(instanceIndex);
        const pO = this.positions.element(a.iO).toVar();
        const pH1 = this.positions.element(a.iH1).toVar();
        const pH2 = this.positions.element(a.iH2).toVar();
        const vO = this.velocities.element(a.iO).toVar();
        const vH1 = this.velocities.element(a.iH1).toVar();
        const vH2 = this.velocities.element(a.iH2).toVar();
        const iMO = this.params.element(a.iO).w;
        const iMH = this.params.element(a.iH1).w;
        Loop(ITERS, () => {
          this.rattlePair(pO, pH1, vO, vH1, iMO, iMH);
          this.rattlePair(pO, pH2, vO, vH2, iMO, iMH);
          this.rattlePair(pH1, pH2, vH1, vH2, iMH, iMH);
        });
        this.velocities.element(a.iO).assign(vO);
        this.velocities.element(a.iH1).assign(vH1);
        this.velocities.element(a.iH2).assign(vH2);
      },
      Math.max(1, this.numConstraints / 3),
    );
  }

  /** Flat index ((z·cpa + y)·cpa + x) as a fluent float; each step re-wrapped (typing). */
  private flatIndex(x: unknown, y: unknown, z: unknown, cpa: unknown) {
    const r1 = fl(fl(z).mul(cpa as never));
    const r2 = fl(r1.add(y as never));
    const r3 = fl(r2.mul(cpa as never));
    return fl(r3.add(x as never));
  }

  /** Flat cell index as a float (clamped into the grid); convert with `uint()` to index. */
  private cellIndexFloat(piNode: unknown) {
    const cpa = this.uCellsPerAxis;
    const pi = vec3(piNode as never);
    const rel = pi.add(vec3(this.uHalfBox)).div(this.uCellSize);
    const cx = fl(clamp(floor(rel.x), float(0), cpa.sub(1)));
    const cy = fl(clamp(floor(rel.y), float(0), cpa.sub(1)));
    const cz = fl(clamp(floor(rel.z), float(0), cpa.sub(1)));
    return this.flatIndex(cx, cy, cz, cpa);
  }

  /** Build a cell-list pair-force kernel (LJ shifted-force, or WCA when `isLJ` is false). */
  private buildCellForceKernel(isLJ: boolean): Kernel {
    const n = this.atomCount;
    return kernel(() => {
      const idx = instanceIndex;
      const pi = this.positions.element(idx).toVar();
      const fi = vec3(0).toVar();
      const peSum = float(0).toVar();
      const virSum = float(0).toVar();
      const cpa = this.uCellsPerAxis;

      const rc = sqrt(this.uRc2).toVar();
      const c2 = this.uSigma2.div(this.uRc2);
      const c6 = c2.mul(c2).mul(c2);
      const c12 = c6.mul(c6);
      const fAtRc = float(24).mul(this.uEpsilon).mul(c12.mul(2).sub(c6)).div(rc);
      const vAtRc = float(4).mul(this.uEpsilon).mul(c12.sub(c6));

      const rel = pi.add(vec3(this.uHalfBox)).div(this.uCellSize);
      const cx = fl(clamp(floor(rel.x), float(0), cpa.sub(1))).toVar();
      const cy = fl(clamp(floor(rel.y), float(0), cpa.sub(1))).toVar();
      const cz = fl(clamp(floor(rel.z), float(0), cpa.sub(1))).toVar();

      Loop(3, ({ i: a }) => {
        const ncx = fl(mod(cx.add(float(a).sub(1)).add(cpa), cpa));
        Loop(3, ({ i: b }) => {
          const ncy = fl(mod(cy.add(float(b).sub(1)).add(cpa), cpa));
          Loop(3, ({ i: cIdx }) => {
            const ncz = fl(mod(cz.add(float(cIdx).sub(1)).add(cpa), cpa));
            const ncellF = this.flatIndex(ncx, ncy, ncz, cpa).toVar();
            const baseF = ncellF.mul(CELL_CAPACITY).toVar();
            const cntF = fl(atomicLoad(this.cellCounts.element(uint(ncellF)))).toVar();
            // Fixed-bound loop with a guard (avoids a dynamic loop count); CELL_CAPACITY
            // exceeds realistic cell occupancy, so guarded iterations are cheap skips.
            Loop(CELL_CAPACITY, ({ i: s }) => {
              If(float(s).lessThan(cntF), () => {
                const j = this.cellParticles.element(uint(baseF.add(float(s)))).toVar();
                If(float(j).notEqual(float(idx)), () => {
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
                      if (isLJ) {
                        const r = sqrt(r2);
                        const fRadial = float(24)
                          .mul(this.uEpsilon)
                          .mul(inv12.mul(2).sub(inv6))
                          .div(r);
                        const fOverR = fRadial.sub(fAtRc).div(r);
                        const vv = float(4).mul(this.uEpsilon).mul(inv12.sub(inv6));
                        fi.addAssign(d.mul(fOverR));
                        peSum.addAssign(vv.sub(vAtRc).add(r.sub(rc).mul(fAtRc)).mul(0.5));
                        virSum.addAssign(fOverR.mul(r2).mul(0.5));
                      } else {
                        const fOverR = float(24)
                          .mul(this.uEpsilon)
                          .mul(inv12.mul(2).sub(inv6))
                          .div(r2);
                        fi.addAssign(d.mul(fOverR));
                        peSum.addAssign(
                          float(4)
                            .mul(this.uEpsilon)
                            .mul(inv12.sub(inv6))
                            .add(this.uEpsilon)
                            .mul(0.5),
                        );
                        virSum.addAssign(fOverR.mul(r2).mul(0.5));
                      }
                    });
                  });
                });
              });
            });
          });
        });
      });

      this.forces.element(idx).assign(fi);
      this.energyVirial.element(idx).assign(vec2(peSum, virSum));
    }, n);
  }

  private applyConfigUniforms(): void {
    const { config, species } = this;
    this.uDt.value = config.timestep;
    this.uHalfDt.value = 0.5 * config.timestep;
    this.uInvMass.value = 1 / species.mass;
    this.uBox.value.copy(this.boxLengths); // actual (possibly non-cubic) box lengths
    this.uSigma2.value = species.sigma * species.sigma;
    this.uEpsilon.value = species.epsilon;
    this.updateCutoff();
    this.uPeriodic.value = config.boundary === "periodic" ? 1 : 0;
    this.uGravity.value = config.gravity;

    // Electrostatics (Wolf DSF), active for L3. Pre-compute the cutoff-shift constants.
    const useCoulomb = config.level === "L3";
    this.uUseCoulomb.value = useCoulomb ? 1 : 0;
    this.uUseShift.value = config.level === "L2" || config.level === "L3" ? 1 : 0;
    const alpha = 2.5;
    const rcC = Math.min(0.9, 0.49 * config.boxLength);
    const erfcRc = erfcScalar(alpha * rcC);
    const expRc = Math.exp(-alpha * alpha * rcC * rcC);
    const twoPi = 2 / Math.sqrt(Math.PI);
    this.uAlpha.value = alpha;
    this.uRcC.value = rcC;
    this.uRcC2.value = rcC * rcC;
    this.uErfcRc.value = erfcRc;
    this.uShiftC.value = erfcRc / (rcC * rcC) + (twoPi * alpha * expRc) / rcC;
    this.uKe.value = COULOMB_CONSTANT;
  }

  /** Update gravity (nm·ps⁻², downward) live. */
  setGravity(gravity: number): void {
    (this.config as { gravity: number }).gravity = gravity;
    this.uGravity.value = gravity;
  }

  /** Switch thermostat (Berendsen on GPU via λ from the readback KE). */
  setThermostat(thermostat: SimConfig["thermostat"], tau: number): void {
    (
      this.config as {
        thermostat: SimConfig["thermostat"];
        thermostatTau: number;
      }
    ).thermostat = thermostat;
    (this.config as { thermostatTau: number }).thermostatTau = tau;
    if (thermostat === "none") this.uThermoLambda.value = 1;
  }

  /**
   * Set the cutoff uniform for the active level (WCA: 2^(1/6)σ, LJ: 2.5σ) and rebuild the
   * cell grid (cells per axis ≥ cutoff). Cell-lists engage only when ≥ 3 cells/axis fit.
   */
  private updateCutoff(): void {
    // GPU has no Coulomb kernel; L3 runs the LJ part only (2.5σ cutoff).
    const factor = this.config.level === "L2" || this.config.level === "L3" ? 2.5 : TWO_POW_1_6;
    const rc = factor * this.species.sigma;
    this.uRc2.value = rc * rc;

    const L = this.config.boxLength;
    const cpa = Math.floor(L / rc);
    // The GPU cell-list force kernel is numerically incorrect (the spatial-hash binning is
    // verified correct, but the cell-traversal force pass produces phantom close-pair forces).
    // It stays disabled; the brute O(N²) kernel is the proven path and, being fully parallel,
    // still handles thousands of atoms. Re-enabling needs the force kernel rewritten + a
    // multi-species/Coulomb pass. Validate any future fix in a real browser (mapAsync readback).
    this.cellsEnabled = false;
    const usedCpa = Math.max(1, cpa);
    this.uCellsPerAxis.value = usedCpa;
    this.uCellSize.value = L / usedCpa;
    this.uHalfBox.value = 0.5 * L;
  }

  private get forcesEnabled(): boolean {
    return this.config.level !== "L0";
  }

  /** Force-computation passes: cell-list (clear→bin→forces) when it fits, else O(N²) brute. */
  private forcePassNodes(): Kernel[] {
    // Molecular: nonbonded-with-exclusions (assigns f32 forces) + bonded scatter into the i32
    // accumulator (zeroed first) + a dequantise pass that folds it into the f32 forces.
    if (this.molecular && this.kForcesMol && this.kZeroForceQ && this.kAddQForces) {
      const passes: Kernel[] = [this.kZeroForceQ, this.kForcesMol];
      if (this.kBondForces) passes.push(this.kBondForces);
      if (this.kAngleForces) passes.push(this.kAngleForces);
      passes.push(this.kAddQForces);
      return passes;
    }
    const isLJ = this.config.level === "L2" || this.config.level === "L3";
    if (this.cellsEnabled) {
      return [
        this.kClearCells,
        this.kBinParticles,
        isLJ ? this.kForcesCellLJ : this.kForcesCellWCA,
      ];
    }
    return [isLJ ? this.kForcesLJ : this.kForcesWCA];
  }

  /** Bind the renderer. Call {@link warmup} once before stepping. */
  attach(renderer: THREE.WebGPURenderer): void {
    this.renderer = renderer;
  }

  /** Compute the initial forces F(0). Must be awaited before the first step. */
  async warmup(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    await renderer.computeAsync(this.forcesEnabled ? this.forcePassNodes() : [this.kZeroForces]);
  }

  private stepNodes(): Kernel[] {
    // Rigid molecules (SETTLE/RATTLE): save ref positions → drift → constrain positions →
    // forces → kick → constrain velocities. Mirrors the CPU stepRigidConstrained() order.
    const rigid = this.kSettle && this.kRattle && this.kSaveRef;
    const nodes: Kernel[] = [];
    if (rigid && this.kSaveRef) nodes.push(this.kSaveRef);
    nodes.push(this.kIntegrateA);
    if (rigid && this.kSettle) nodes.push(this.kSettle);
    if (this.forcesEnabled) nodes.push(...this.forcePassNodes());
    nodes.push(this.kIntegrateB);
    if (rigid && this.kRattle) nodes.push(this.kRattle);
    if (this.config.thermostat !== "none") nodes.push(this.kThermostat);
    return nodes;
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
    const n = this.atomCount;
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

    let ke = 0;
    for (let i = 0; i < n; i++) {
      const vx = vel[3 * i];
      const vy = vel[3 * i + 1];
      const vz = vel[3 * i + 2];
      ke += 0.5 * this.masses[i] * (vx * vx + vy * vy + vz * vz);
    }
    let pe = 0;
    let virial = 0;
    for (let i = 0; i < n; i++) {
      pe += ev[2 * i];
      virial += ev[2 * i + 1];
    }

    // Feed the GPU Berendsen thermostat: recompute λ from the just-read KE. Applied each
    // step by kThermostat via the uThermoLambda uniform (held between readbacks).
    if (this.config.thermostat !== "none") {
      const dof = 3 * n - 3;
      const currentT = temperatureFromKinetic(ke, dof);
      if (currentT > 1e-6) {
        const ratio = this.config.temperature / currentT;
        const tau = Math.max(this.config.thermostatTau, this.config.timestep);
        const lambda2 = 1 + (this.config.timestep / tau) * (ratio - 1);
        this.uThermoLambda.value = Math.sqrt(Math.max(0.04, lambda2));
      }
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
    if (!renderer) return new Float32Array(this.atomCount * 3);
    return new Float32Array(await renderer.getArrayBufferAsync(this.positions.value));
  }

  /** Read the current forces back to the CPU (for parity checks). */
  async readForces(): Promise<Float32Array> {
    const renderer = this.renderer;
    if (!renderer) return new Float32Array(this.atomCount * 3);
    return new Float32Array(await renderer.getArrayBufferAsync(this.forces.value));
  }

  setLevel(level: AccuracyLevel): void {
    (this.config as { level: AccuracyLevel }).level = level;
    this.applyConfigUniforms(); // refresh cutoff + electrostatics uniforms for the level
    void this.renderer?.computeAsync(
      this.forcesEnabled ? this.forcePassNodes() : [this.kZeroForces],
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
