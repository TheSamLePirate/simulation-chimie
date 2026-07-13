import {
  compute,
  cos,
  Fn,
  float,
  If,
  instancedArray,
  instanceIndex,
  sin,
  uint,
  vec2,
} from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";

const WORKGROUP = [64];
const vec2Array = (data: Float32Array) => instancedArray(data, "vec2");
const uintArray = (data: Uint32Array) => instancedArray(data, "uint");
type Kernel = ReturnType<typeof compute>;
type Axis = "x" | "y" | "z";
// biome-ignore lint/suspicious/noExplicitAny: TSL node arithmetic is intentionally loosely typed.
type Node = any;

function kernel(body: () => void, count: number): Kernel {
  return compute(Fn(body)() as never, count, WORKGROUP);
}

export function fftBitReverseIndices(length: number): Uint32Array {
  if (!Number.isInteger(length) || length < 2 || (length & (length - 1)) !== 0) {
    throw new RangeError("GPU FFT length must be a power of two >= 2");
  }
  const bits = Math.log2(length);
  const indices = new Uint32Array(length);
  for (let value = 0; value < length; value++) {
    let source = value;
    let reversed = 0;
    for (let bit = 0; bit < bits; bit++) {
      reversed = (reversed << 1) | (source & 1);
      source >>>= 1;
    }
    indices[value] = reversed;
  }
  return indices;
}

/** Transparent radix-2 complex FFT compute kernel used as the PME GPU foundation. */
export class GpuFft1d {
  readonly length: number;
  readonly data: ReturnType<typeof vec2Array>;

  private readonly bitReverse: ReturnType<typeof uintArray>;
  private readonly kBitReverse: Kernel;
  private readonly forwardPasses: readonly Kernel[];
  private readonly inversePasses: readonly Kernel[];
  private readonly kNormalize: Kernel;

  constructor(input: Float32Array) {
    if (input.length % 2 !== 0) throw new RangeError("GPU FFT input must contain complex pairs");
    this.length = input.length / 2;
    const reversed = fftBitReverseIndices(this.length);
    this.data = vec2Array(input);
    this.bitReverse = uintArray(reversed);
    this.kBitReverse = kernel(() => {
      const target = this.bitReverse.element(instanceIndex);
      If(instanceIndex.lessThan(target), () => {
        const a = this.data.element(instanceIndex).toVar();
        const b = this.data.element(target).toVar();
        this.data.element(instanceIndex).assign(b);
        this.data.element(target).assign(a);
      });
    }, this.length);
    this.forwardPasses = this.buildPasses(-1);
    this.inversePasses = this.buildPasses(1);
    this.kNormalize = kernel(() => {
      this.data.element(instanceIndex).divAssign(float(this.length));
    }, this.length);
  }

  private buildPasses(sign: -1 | 1): Kernel[] {
    const passes: Kernel[] = [];
    for (let half = 1; half < this.length; half *= 2) {
      const width = 2 * half;
      passes.push(
        kernel(() => {
          const pair = uint(instanceIndex);
          const group = pair.div(half);
          const offset = pair.sub(group.mul(half));
          const evenIndex = group.mul(width).add(offset);
          const oddIndex = evenIndex.add(half);
          const angle = float(offset).mul((sign * 2 * Math.PI) / width);
          const twiddleReal = cos(angle);
          const twiddleImag = sin(angle);
          const even = this.data.element(evenIndex).toVar();
          const odd = this.data.element(oddIndex).toVar();
          const transformed = vec2(
            odd.x.mul(twiddleReal).sub(odd.y.mul(twiddleImag)),
            odd.x.mul(twiddleImag).add(odd.y.mul(twiddleReal)),
          ).toVar();
          this.data.element(evenIndex).assign(even.add(transformed));
          this.data.element(oddIndex).assign(even.sub(transformed));
        }, this.length / 2),
      );
    }
    return passes;
  }

  async transform(renderer: WebGPURenderer, inverse = false): Promise<void> {
    await renderer.computeAsync(this.transformKernels(inverse));
  }

  transformKernels(inverse = false): Kernel[] {
    return [
      this.kBitReverse,
      ...(inverse ? this.inversePasses : this.forwardPasses),
      ...(inverse ? [this.kNormalize] : []),
    ];
  }

  async read(renderer: WebGPURenderer): Promise<Float32Array> {
    return new Float32Array(await renderer.getArrayBufferAsync(this.data.value));
  }
}

/**
 * Batched, strided 3D FFT on an x-fastest grid.
 *
 * Each radix-2 stage is a separate dispatch, which provides the device-wide
 * synchronization required before the next stage consumes its results.
 */
export class GpuFft3d {
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly length: number;
  readonly data: ReturnType<typeof vec2Array>;

  private readonly forwardAxes: readonly (readonly Kernel[])[];
  private readonly inverseAxes: readonly (readonly Kernel[])[];
  private readonly bitReverseAxes: readonly Kernel[];
  private readonly bitReverseTables: readonly ReturnType<typeof uintArray>[];
  private readonly kNormalize: Kernel;

  constructor(input: Float32Array, nx: number, ny: number, nz: number) {
    for (const [name, value] of [
      ["nx", nx],
      ["ny", ny],
      ["nz", nz],
    ] as const) {
      if (!Number.isInteger(value) || value < 2 || (value & (value - 1)) !== 0) {
        throw new RangeError(`${name} must be a power of two >= 2`);
      }
    }
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.length = nx * ny * nz;
    if (input.length !== 2 * this.length) {
      throw new RangeError("GPU 3D FFT input length does not match dimensions");
    }
    this.data = vec2Array(input);
    const axes = ["x", "y", "z"] as const;
    const lengths = [nx, ny, nz] as const;
    this.bitReverseTables = lengths.map((length) => uintArray(fftBitReverseIndices(length)));
    this.bitReverseAxes = axes.map((axis, index) =>
      this.buildBitReverse(axis, this.bitReverseTables[index]),
    );
    this.forwardAxes = axes.map((axis, index) => this.buildAxis(axis, lengths[index], -1));
    this.inverseAxes = axes.map((axis, index) => this.buildAxis(axis, lengths[index], 1));
    this.kNormalize = kernel(() => {
      this.data.element(instanceIndex).divAssign(float(this.length));
    }, this.length);
  }

  private flatIndex(axis: Axis, line: Node, offset: Node): Node {
    if (axis === "x") return line.mul(this.nx).add(offset);
    if (axis === "y") {
      const z = line.div(this.nx);
      const x = line.sub(z.mul(this.nx));
      return x.add(uint(this.nx).mul(offset.add(z.mul(this.ny))));
    }
    return line.add(uint(this.nx * this.ny).mul(offset));
  }

  private buildBitReverse(axis: Axis, reverse: ReturnType<typeof uintArray>): Kernel {
    return kernel(() => {
      const flat = uint(instanceIndex);
      let line: Node;
      let offset: Node;
      if (axis === "x") {
        line = flat.div(this.nx);
        offset = flat.sub(line.mul(this.nx));
      } else if (axis === "y") {
        const x = flat.sub(flat.div(this.nx).mul(this.nx));
        const yz = flat.div(this.nx);
        offset = yz.sub(yz.div(this.ny).mul(this.ny));
        line = yz.div(this.ny).mul(this.nx).add(x);
      } else {
        const plane = this.nx * this.ny;
        line = flat.sub(flat.div(plane).mul(plane));
        offset = flat.div(plane);
      }
      const targetOffset = reverse.element(offset);
      If(offset.lessThan(targetOffset), () => {
        const target = this.flatIndex(axis, line, targetOffset);
        const a = this.data.element(flat).toVar();
        const b = this.data.element(target).toVar();
        this.data.element(flat).assign(b);
        this.data.element(target).assign(a);
      });
    }, this.length);
  }

  private buildAxis(axis: Axis, axisLength: number, sign: -1 | 1): Kernel[] {
    const passes: Kernel[] = [];
    const pairsPerLine = axisLength / 2;
    for (let half = 1; half < axisLength; half *= 2) {
      const width = 2 * half;
      passes.push(
        kernel(() => {
          const pair = uint(instanceIndex);
          const line = pair.div(pairsPerLine);
          const withinLine = pair.sub(line.mul(pairsPerLine));
          const group = withinLine.div(half);
          const offset = withinLine.sub(group.mul(half));
          const evenOffset = group.mul(width).add(offset);
          const oddOffset = evenOffset.add(half);
          const evenIndex = this.flatIndex(axis, line, evenOffset);
          const oddIndex = this.flatIndex(axis, line, oddOffset);
          const angle = float(offset).mul((sign * 2 * Math.PI) / width);
          const twiddleReal = cos(angle);
          const twiddleImag = sin(angle);
          const even = this.data.element(evenIndex).toVar();
          const odd = this.data.element(oddIndex).toVar();
          const transformed = vec2(
            odd.x.mul(twiddleReal).sub(odd.y.mul(twiddleImag)),
            odd.x.mul(twiddleImag).add(odd.y.mul(twiddleReal)),
          ).toVar();
          this.data.element(evenIndex).assign(even.add(transformed));
          this.data.element(oddIndex).assign(even.sub(transformed));
        }, this.length / 2),
      );
    }
    return passes;
  }

  async transform(renderer: WebGPURenderer, inverse = false): Promise<void> {
    await renderer.computeAsync(this.transformKernels(inverse));
  }

  transformKernels(inverse = false): Kernel[] {
    const axes = inverse ? this.inverseAxes : this.forwardAxes;
    const kernels: Kernel[] = [];
    for (let axis = 0; axis < axes.length; axis++) {
      kernels.push(this.bitReverseAxes[axis], ...axes[axis]);
    }
    if (inverse) kernels.push(this.kNormalize);
    return kernels;
  }

  async read(renderer: WebGPURenderer): Promise<Float32Array> {
    return new Float32Array(await renderer.getArrayBufferAsync(this.data.value));
  }
}
