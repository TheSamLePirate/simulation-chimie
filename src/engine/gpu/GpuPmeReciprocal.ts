import {
  atomicAdd,
  atomicLoad,
  atomicStore,
  compute,
  Fn,
  float,
  floor,
  instancedArray,
  instanceIndex,
  int,
  Loop,
  max,
  mod,
  pow,
  round,
  uint,
  vec2,
  vec3,
} from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import { buildPmeInfluenceGrid } from "../../core/forces/pme";
import type { Box } from "../../core/types";
import { GpuFft3d } from "./GpuFft";

const WORKGROUP = [64];
const PME_ORDER = 6;
const SUPPORT_POINTS = PME_ORDER ** 3;
// A mesh cell receives only a small local support. 2^24 keeps scatter quantization below 6e-8 e
// while leaving over an order of magnitude of signed i32 headroom for dense liquid water.
const CHARGE_SCALE = 1 << 24;
const BINOMIAL_6 = [1, 6, 15, 20, 15, 6, 1] as const;

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

function scalarPairs(values: Float32Array): Float32Array {
  const pairs = new Float32Array(2 * values.length);
  for (let i = 0; i < values.length; i++) pairs[2 * i] = values[i];
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

export interface GpuPmeReciprocalInput {
  readonly count: number;
  readonly positions: Float32Array;
  readonly charges: Float32Array;
  readonly box: Box;
  readonly alpha: number;
  readonly grid: readonly [number, number, number];
}

/** GPU smooth-PME reciprocal mesh path (order-6 assignment and analytic force interpolation). */
export class GpuPmeReciprocal {
  readonly count: number;
  readonly fft: GpuFft3d;

  private readonly positions: ReturnType<typeof vec3Array>;
  private readonly charges: ReturnType<typeof vec2Array>;
  private readonly influence: ReturnType<typeof vec2Array>;
  private readonly meshChargeQ: ReturnType<typeof uintArray>;
  private readonly contributions: ReturnType<typeof vec3Array>;
  private readonly forces: ReturnType<typeof vec3Array>;
  private readonly kClear: Kernel;
  private readonly kAssign: Kernel;
  private readonly kDequantize: Kernel;
  private readonly kInfluence: Kernel;
  private readonly kInterpolate: Kernel;
  private readonly kReduce: Kernel;

  constructor(input: GpuPmeReciprocalInput) {
    const { count, positions, charges, box, alpha, grid } = input;
    if (!Number.isInteger(count) || count < 1)
      throw new RangeError("GPU PME count must be positive");
    if (positions.length !== 3 * count || charges.length !== count) {
      throw new RangeError("GPU PME charge-site buffers do not match count");
    }
    let netCharge = 0;
    for (const charge of charges) netCharge += charge;
    if (Math.abs(netCharge) > 1e-5) throw new Error("GPU PME requires a neutral charge set");
    const [nx, ny, nz] = grid;
    const gridPoints = nx * ny * nz;
    const [lx, ly, lz] = box.lengths;
    this.count = count;
    this.positions = vec3Array(positions);
    this.charges = vec2Array(scalarPairs(charges));
    this.influence = vec2Array(
      scalarPairs(Float32Array.from(buildPmeInfluenceGrid(box, grid, alpha))),
    );
    this.meshChargeQ = uintArray(new Uint32Array(gridPoints)).toAtomic();
    this.contributions = vec3Array(new Float32Array(3 * count * SUPPORT_POINTS));
    this.forces = vec3Array(new Float32Array(3 * count));
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
      this.fft.data.element(instanceIndex).mulAssign(this.influence.element(instanceIndex).x);
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
}
