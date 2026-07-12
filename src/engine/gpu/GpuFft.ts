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
    await renderer.computeAsync(this.kBitReverse);
    for (const pass of inverse ? this.inversePasses : this.forwardPasses) {
      await renderer.computeAsync(pass);
    }
    if (inverse) await renderer.computeAsync(this.kNormalize);
  }

  async read(renderer: WebGPURenderer): Promise<Float32Array> {
    return new Float32Array(await renderer.getArrayBufferAsync(this.data.value));
  }
}
