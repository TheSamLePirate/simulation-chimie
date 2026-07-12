import {
  atomicAdd,
  atomicLoad,
  atomicStore,
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
  pow,
  round,
  sqrt,
  uint,
  vec2,
  vec3,
} from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import { buildPmeInfluenceGrid, buildPmeVirialFactorGrid } from "../../core/forces/pme";
import type { Box } from "../../core/types";
import { COULOMB_CONSTANT } from "../../core/units";
import { GpuFft3d } from "./GpuFft";

const WORKGROUP = [64];
const PME_ORDER = 6;
const SUPPORT_POINTS = PME_ORDER ** 3;
// A mesh cell receives only a small local support. 2^24 keeps scatter quantization below 6e-8 e
// while leaving over an order of magnitude of signed i32 headroom for dense liquid water.
const CHARGE_SCALE = 1 << 24;
const BINOMIAL_6 = [1, 6, 15, 20, 15, 6, 1] as const;
const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

const vec3Array = (data: Float32Array) => instancedArray(data, "vec3");
const vec2Array = (data: Float32Array) => instancedArray(data, "vec2");
const uintArray = (data: Uint32Array) => instancedArray(data, "uint");
type Kernel = ReturnType<typeof compute>;
type ScalarNode = ReturnType<typeof vec2>["x"];
// biome-ignore lint/suspicious/noExplicitAny: TSL node arithmetic is intentionally loosely typed.
type Node = any;

const fl = (value: unknown) => float(value as never);
const iv = (value: unknown) => int(value as never);
const uv = (value: unknown) => uint(value as never);
const kernel = (body: () => void, count: number): Kernel =>
  compute(Fn(body)() as never, count, WORKGROUP);

function scalarPairs(values: Float32Array, second?: Float32Array): Float32Array {
  const pairs = new Float32Array(2 * values.length);
  for (let i = 0; i < values.length; i++) {
    pairs[2 * i] = values[i];
    pairs[2 * i + 1] = second?.[i] ?? 0;
  }
  return pairs;
}

function spline(argument: Node, derivative = false): ScalarNode {
  const sum = float(0).toVar();
  const exponent = derivative ? 4 : 5;
  for (let k = 0; k < BINOMIAL_6.length; k++) {
    const truncated = max(argument.sub(k), float(0));
    const term = pow(truncated, float(exponent)).mul(BINOMIAL_6[k]);
    if (k % 2 === 0) sum.addAssign(term);
    else sum.subAssign(term);
  }
  // CPU spline derivative is dM(offset+1-t)/dt = -M'(argument).
  return sum.div(derivative ? -24 : 120) as ScalarNode;
}

function wrappedGridIndex(base: Node, offset: Node, length: number): Node {
  return uv(mod(fl(base.add(iv(offset)).add(length)), float(length)));
}

function roundVec(value: Node): Node {
  return vec3(round(value.x), round(value.y), round(value.z));
}

function erfcApprox(x: Node): Node {
  const t = float(1).div(x.mul(0.5).add(1));
  const polynomial = t
    .mul(0.17087277)
    .sub(0.82215223)
    .mul(t)
    .add(1.48851587)
    .mul(t)
    .sub(1.13520398)
    .mul(t)
    .add(0.27886807)
    .mul(t)
    .sub(0.18628806)
    .mul(t)
    .add(0.09678418)
    .mul(t)
    .add(0.37409196)
    .mul(t)
    .add(1.00002368)
    .mul(t)
    .sub(1.26551223)
    .sub(x.mul(x));
  return t.mul(exp(polynomial));
}

export interface GpuPmeReciprocalInput {
  readonly count: number;
  readonly positions: Float32Array;
  readonly charges: Float32Array;
  readonly box: Box;
  readonly alpha: number;
  readonly grid: readonly [number, number, number];
  readonly realCutoff?: number;
  readonly slabCorrection?: boolean;
  /** Equal ids omit that pair from real space; the reciprocal exclusion is applied externally. */
  readonly exclusionGroups?: Uint32Array;
}

/** GPU smooth-PME reciprocal mesh path (order-6 assignment and analytic force interpolation). */
export class GpuPmeReciprocal {
  readonly count: number;
  readonly fft: GpuFft3d;

  get positionStorage() {
    return this.positions;
  }

  get chargeStorage() {
    return this.charges;
  }

  get forceStorage() {
    return this.forces;
  }

  private readonly positions: ReturnType<typeof vec3Array>;
  private readonly charges: ReturnType<typeof vec2Array>;
  private readonly exclusionGroups: ReturnType<typeof uintArray>;
  private readonly influence: ReturnType<typeof vec2Array>;
  private readonly meshChargeQ: ReturnType<typeof uintArray>;
  private readonly contributions: ReturnType<typeof vec3Array>;
  private readonly forces: ReturnType<typeof vec3Array>;
  private readonly energyVirial: ReturnType<typeof vec2Array>;
  private readonly realForces: ReturnType<typeof vec3Array>;
  private readonly realEnergyVirial: ReturnType<typeof vec2Array>;
  private readonly dipoleSlab: ReturnType<typeof vec2Array>;
  private readonly kClear: Kernel;
  private readonly kAssign: Kernel;
  private readonly kDequantize: Kernel;
  private readonly kInfluence: Kernel;
  private readonly kInterpolate: Kernel;
  private readonly kReduce: Kernel;
  private readonly kDipoleSlab: Kernel;
  private readonly kRealSpace: Kernel;
  private readonly kCombineForces: Kernel;

  constructor(input: GpuPmeReciprocalInput) {
    const { count, positions, charges, box, alpha, grid } = input;
    if (!Number.isInteger(count) || count < 1)
      throw new RangeError("GPU PME count must be positive");
    if (positions.length !== 3 * count || charges.length !== count) {
      throw new RangeError("GPU PME charge-site buffers do not match count");
    }
    if (input.exclusionGroups && input.exclusionGroups.length !== count) {
      throw new RangeError("GPU PME exclusion groups do not match count");
    }
    let netCharge = 0;
    for (const charge of charges) netCharge += charge;
    if (Math.abs(netCharge) > 1e-5) throw new Error("GPU PME requires a neutral charge set");
    const [nx, ny, nz] = grid;
    const gridPoints = nx * ny * nz;
    const [lx, ly, lz] = box.lengths;
    const volume = lx * ly * lz;
    const realCutoff = input.realCutoff ?? 0.49 * Math.min(lx, ly, lz);
    if (!(realCutoff > 0) || realCutoff > 0.5 * Math.min(lx, ly, lz)) {
      throw new RangeError("GPU PME realCutoff must be within the minimum-image radius");
    }
    const slabCorrection = input.slabCorrection ?? false;
    let chargeSquareSum = 0;
    for (const charge of charges) chargeSquareSum += charge * charge;
    const selfEnergy = (-COULOMB_CONSTANT * alpha * chargeSquareSum) / Math.sqrt(Math.PI);
    this.count = count;
    this.positions = vec3Array(positions);
    this.charges = vec2Array(scalarPairs(charges));
    this.exclusionGroups = uintArray(
      input.exclusionGroups ?? Uint32Array.from({ length: count }, (_, index) => index),
    );
    this.influence = vec2Array(
      scalarPairs(
        Float32Array.from(buildPmeInfluenceGrid(box, grid, alpha)),
        Float32Array.from(buildPmeVirialFactorGrid(box, grid, alpha)),
      ),
    );
    this.meshChargeQ = uintArray(new Uint32Array(gridPoints)).toAtomic();
    this.contributions = vec3Array(new Float32Array(3 * count * SUPPORT_POINTS));
    this.forces = vec3Array(new Float32Array(3 * count));
    this.energyVirial = vec2Array(new Float32Array(2 * gridPoints));
    this.realForces = vec3Array(new Float32Array(3 * count));
    this.realEnergyVirial = vec2Array(new Float32Array(2 * count));
    this.dipoleSlab = vec2Array(new Float32Array(2));
    this.fft = new GpuFft3d(new Float32Array(2 * gridPoints), nx, ny, nz);

    this.kClear = kernel(() => {
      atomicStore(this.meshChargeQ.element(instanceIndex), uint(0));
    }, gridPoints);

    this.kAssign = kernel(() => {
      const supportIndex = uv(instanceIndex);
      const particle = supportIndex.div(SUPPORT_POINTS);
      const local = supportIndex.sub(particle.mul(SUPPORT_POINTS));
      const az = local.div(PME_ORDER * PME_ORDER);
      const xy = local.sub(az.mul(PME_ORDER * PME_ORDER));
      const ay = xy.div(PME_ORDER);
      const ax = xy.sub(ay.mul(PME_ORDER));
      const position = this.positions.element(particle);

      const ux = position.x.div(lx).add(0.5).mul(nx);
      const uy = position.y.div(ly).add(0.5).mul(ny);
      const uz = position.z.div(lz).add(0.5).mul(nz);
      const cellX = floor(ux);
      const cellY = floor(uy);
      const cellZ = floor(uz);
      const wx = spline(fl(ax).add(1).sub(ux.sub(cellX)));
      const wy = spline(fl(ay).add(1).sub(uy.sub(cellY)));
      const wz = spline(fl(az).add(1).sub(uz.sub(cellZ)));
      const gx = wrappedGridIndex(iv(cellX).sub(2), ax, nx);
      const gy = wrappedGridIndex(iv(cellY).sub(2), ay, ny);
      const gz = wrappedGridIndex(iv(cellZ).sub(2), az, nz);
      const meshIndex = gx.add(uint(nx).mul(gy.add(uint(ny).mul(gz))));
      const quantized = iv(
        round(this.charges.element(particle).x.mul(wx).mul(wy).mul(wz).mul(CHARGE_SCALE)),
      );
      atomicAdd(this.meshChargeQ.element(meshIndex), uv(quantized));
    }, count * SUPPORT_POINTS);

    this.kDequantize = kernel(() => {
      const charge = fl(iv(atomicLoad(this.meshChargeQ.element(instanceIndex)))).div(CHARGE_SCALE);
      this.fft.data.element(instanceIndex).assign(vec2(charge, 0));
    }, gridPoints);

    this.kInfluence = kernel(() => {
      const rho = this.fft.data.element(instanceIndex).toVar();
      const coefficient = this.influence.element(instanceIndex);
      const energy = rho
        .dot(rho)
        .mul(coefficient.x)
        .mul(0.5 / gridPoints);
      this.energyVirial.element(instanceIndex).assign(vec2(energy, energy.mul(coefficient.y)));
      this.fft.data.element(instanceIndex).assign(rho.mul(coefficient.x));
    }, gridPoints);

    this.kInterpolate = kernel(() => {
      const supportIndex = uv(instanceIndex);
      const particle = supportIndex.div(SUPPORT_POINTS);
      const local = supportIndex.sub(particle.mul(SUPPORT_POINTS));
      const az = local.div(PME_ORDER * PME_ORDER);
      const xy = local.sub(az.mul(PME_ORDER * PME_ORDER));
      const ay = xy.div(PME_ORDER);
      const ax = xy.sub(ay.mul(PME_ORDER));
      const position = this.positions.element(particle);
      const ux = position.x.div(lx).add(0.5).mul(nx);
      const uy = position.y.div(ly).add(0.5).mul(ny);
      const uz = position.z.div(lz).add(0.5).mul(nz);
      const cellX = floor(ux);
      const cellY = floor(uy);
      const cellZ = floor(uz);
      const argX = fl(ax).add(1).sub(ux.sub(cellX));
      const argY = fl(ay).add(1).sub(uy.sub(cellY));
      const argZ = fl(az).add(1).sub(uz.sub(cellZ));
      const wx = spline(argX);
      const wy = spline(argY);
      const wz = spline(argZ);
      const dx = spline(argX, true);
      const dy = spline(argY, true);
      const dz = spline(argZ, true);
      const gx = wrappedGridIndex(iv(cellX).sub(2), ax, nx);
      const gy = wrappedGridIndex(iv(cellY).sub(2), ay, ny);
      const gz = wrappedGridIndex(iv(cellZ).sub(2), az, nz);
      const meshIndex = gx.add(uint(nx).mul(gy.add(uint(ny).mul(gz))));
      const potential = fl(this.fft.data.element(meshIndex).x);
      const scale = this.charges.element(particle).x.mul(potential).mul(-1);
      this.contributions.element(supportIndex).assign(
        vec3(
          scale
            .mul(dx)
            .mul(wy)
            .mul(wz)
            .mul(nx / lx),
          scale
            .mul(wx)
            .mul(dy)
            .mul(wz)
            .mul(ny / ly),
          scale
            .mul(wx)
            .mul(wy)
            .mul(dz)
            .mul(nz / lz),
        ),
      );
    }, count * SUPPORT_POINTS);

    this.kReduce = kernel(() => {
      const force = vec3(0).toVar();
      const base = uv(instanceIndex).mul(SUPPORT_POINTS);
      Loop(SUPPORT_POINTS, ({ i }: { i: Node }) => {
        force.addAssign(this.contributions.element(base.add(uv(i))));
      });
      this.forces.element(instanceIndex).assign(force);
    }, count);

    this.kDipoleSlab = kernel(() => {
      const dipoleZ = float(0).toVar();
      Loop(count, ({ i }: { i: Node }) => {
        dipoleZ.addAssign(this.charges.element(uv(i)).x.mul(this.positions.element(uv(i)).z));
      });
      const slabEnergy = slabCorrection
        ? dipoleZ.mul(dipoleZ).mul((COULOMB_CONSTANT * 2 * Math.PI) / volume)
        : float(0);
      this.dipoleSlab.element(uint(0)).assign(vec2(dipoleZ, slabEnergy));
    }, 1);

    this.kRealSpace = kernel(() => {
      const particle = uv(instanceIndex);
      const position = this.positions.element(particle).toVar();
      const charge = this.charges.element(particle).x;
      const force = vec3(0).toVar();
      const energy = float(0).toVar();
      const virial = float(0).toVar();
      const group = this.exclusionGroups.element(particle);
      Loop(count, ({ i: j }: { i: Node }) => {
        const other = uv(j);
        const delta = position.sub(this.positions.element(other)).toVar();
        const boxVector = vec3(lx, ly, lz);
        delta.assign(delta.sub(boxVector.mul(roundVec(delta.div(boxVector)))));
        const r2 = delta.dot(delta).toVar();
        const addRealPair = () => {
          If(r2.greaterThan(float(1e-12)), () => {
            If(r2.lessThan(realCutoff * realCutoff), () => {
              const r = sqrt(r2);
              const qq = charge.mul(this.charges.element(other).x);
              const erfcR = erfcApprox(r.mul(alpha));
              const expR = exp(r2.mul(-alpha * alpha));
              const fOverR = qq.mul(COULOMB_CONSTANT).mul(
                erfcR.div(r2.mul(r)).add(
                  float(TWO_OVER_SQRT_PI * alpha)
                    .mul(expR)
                    .div(r2),
                ),
              );
              force.addAssign(delta.mul(fOverR));
              energy.addAssign(
                qq
                  .mul(COULOMB_CONSTANT * 0.5)
                  .mul(erfcR)
                  .div(r),
              );
              virial.addAssign(fOverR.mul(r2).mul(0.5));
            });
          });
        };
        if (input.exclusionGroups) {
          If(group.notEqual(this.exclusionGroups.element(other)), addRealPair);
        } else {
          addRealPair();
        }
      });
      if (slabCorrection) {
        const dipoleZ = this.dipoleSlab.element(uint(0)).x;
        force.z.addAssign(charge.mul(dipoleZ).mul((-COULOMB_CONSTANT * 4 * Math.PI) / volume));
      }
      If(particle.equal(uint(0)), () => {
        const slabEnergy = this.dipoleSlab.element(uint(0)).y;
        energy.addAssign(float(selfEnergy).add(slabEnergy));
        virial.addAssign(slabEnergy);
      });
      this.realForces.element(particle).assign(force);
      this.realEnergyVirial.element(particle).assign(vec2(energy, virial));
    }, count);

    this.kCombineForces = kernel(() => {
      this.forces.element(instanceIndex).addAssign(this.realForces.element(instanceIndex));
    }, count);
  }

  async compute(renderer: WebGPURenderer): Promise<void> {
    await renderer.computeAsync(this.kClear);
    await renderer.computeAsync(this.kAssign);
    await renderer.computeAsync(this.kDequantize);
    await this.fft.transform(renderer);
    await renderer.computeAsync(this.kInfluence);
    await this.fft.transform(renderer, true);
    await renderer.computeAsync(this.kInterpolate);
    await renderer.computeAsync(this.kReduce);
  }

  async computeFull(renderer: WebGPURenderer): Promise<void> {
    await this.compute(renderer);
    await renderer.computeAsync(this.kDipoleSlab);
    await renderer.computeAsync(this.kRealSpace);
    await renderer.computeAsync(this.kCombineForces);
  }

  async readForces(renderer: WebGPURenderer): Promise<Float32Array> {
    const raw = new Float32Array(await renderer.getArrayBufferAsync(this.forces.value));
    if (raw.length === 3 * this.count) return raw;
    // WebGPU storage buffers align vec3 elements to 16 bytes; Three.js therefore exposes a
    // four-float stride on readback even though shader indexing remains vec3-aware.
    if (raw.length !== 4 * this.count) {
      throw new Error(`Unexpected GPU PME force buffer length ${raw.length}`);
    }
    const packed = new Float32Array(3 * this.count);
    for (let i = 0; i < this.count; i++) {
      packed[3 * i] = raw[4 * i];
      packed[3 * i + 1] = raw[4 * i + 1];
      packed[3 * i + 2] = raw[4 * i + 2];
    }
    return packed;
  }

  async readReciprocalEnergyVirial(
    renderer: WebGPURenderer,
  ): Promise<{ energy: number; virial: number }> {
    const terms = new Float32Array(await renderer.getArrayBufferAsync(this.energyVirial.value));
    let energy = 0;
    let virial = 0;
    for (let i = 0; i < terms.length; i += 2) {
      energy += terms[i];
      virial += terms[i + 1];
    }
    return { energy, virial };
  }

  async readFullEnergyVirial(
    renderer: WebGPURenderer,
  ): Promise<{ energy: number; virial: number }> {
    const reciprocal = await this.readReciprocalEnergyVirial(renderer);
    const terms = new Float32Array(await renderer.getArrayBufferAsync(this.realEnergyVirial.value));
    let energy = reciprocal.energy;
    let virial = reciprocal.virial;
    for (let i = 0; i < terms.length; i += 2) {
      energy += terms[i];
      virial += terms[i + 1];
    }
    return { energy, virial };
  }
}
