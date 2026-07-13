import {
  abs,
  atomicAdd,
  atomicLoad,
  atomicStore,
  compute,
  Fn,
  float,
  floor,
  If,
  instancedArray,
  instanceIndex,
  Loop,
  max,
  sign,
  uint,
  vec2,
  vec3,
} from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";

const WORKGROUP = [64];
const vec2Array = (data: Float32Array) => instancedArray(data, "vec2");
const vec3Array = (data: Float32Array) => instancedArray(data, "vec3");
const uintArray = (data: Uint32Array) => instancedArray(data, "uint");
export type TailVec2Storage = ReturnType<typeof vec2Array>;
export type TailVec3Storage = ReturnType<typeof vec3Array>;
type Kernel = ReturnType<typeof compute>;
// biome-ignore lint/suspicious/noExplicitAny: TSL node arithmetic is intentionally loosely typed.
type Node = any;
const fl = (value: unknown) => float(value as never);
const uv = (value: unknown) => uint(value as never);
const kernel = (body: () => void, count: number): Kernel =>
  compute(Fn(body)() as never, count, WORKGROUP);

export interface GpuPlanarDispersionTailInput {
  readonly molecules: number;
  readonly atomicPositions: TailVec3Storage;
  readonly targetForces: TailVec3Storage;
  readonly targetEnergyVirial: TailVec2Storage;
  readonly boxLengths: readonly [number, number, number];
  readonly sigma: number;
  readonly epsilon: number;
  readonly cutoff: number;
  readonly bins?: number;
  readonly imageLayers?: number;
}

/** Janeček planar density-profile LJ tail, evaluated entirely on WebGPU. */
export class GpuPlanarDispersionTail {
  private readonly kernelsList: readonly Kernel[];
  private readonly tailForceEnergyVirial: TailVec3Storage;
  private readonly molecules: number;

  constructor(input: GpuPlanarDispersionTailInput) {
    const {
      molecules,
      atomicPositions,
      targetForces,
      targetEnergyVirial,
      boxLengths: [lx, ly, lz],
      sigma,
      epsilon,
      cutoff,
    } = input;
    const bins = input.bins ?? 80;
    const imageLayers = input.imageLayers ?? 8;
    if (!Number.isInteger(molecules) || molecules < 1) {
      throw new RangeError("GPU Janecek molecule count must be positive");
    }
    if (!Number.isInteger(bins) || bins < 2) throw new RangeError("GPU Janecek bins must be >= 2");
    if (!Number.isInteger(imageLayers) || imageLayers < 1) {
      throw new RangeError("GPU Janecek image layers must be positive");
    }
    const binWidth = lz / bins;
    const inverseBinVolume = 1 / (lx * ly * binWidth);
    const sigma6 = sigma ** 6;
    const sigma12 = sigma6 * sigma6;
    const potentialAtCutoff = 4 * epsilon * (sigma12 / cutoff ** 12 - sigma6 / cutoff ** 6);
    const counts = uintArray(new Uint32Array(bins)).toAtomic();
    const particleBins = uintArray(new Uint32Array(molecules));
    this.molecules = molecules;
    this.tailForceEnergyVirial = vec3Array(new Float32Array(3 * molecules));

    const kClear = kernel(() => {
      atomicStore(counts.element(instanceIndex), uint(0));
    }, bins);
    const kBin = kernel(() => {
      const oxygen = uint(instanceIndex).mul(3);
      const z = atomicPositions.element(oxygen).z;
      const wrapped = z.sub(float(lz).mul(floor(z.add(lz / 2).div(lz))));
      const bin = uv(floor(wrapped.add(lz / 2).div(binWidth)));
      particleBins.element(instanceIndex).assign(bin);
      atomicAdd(counts.element(bin), uint(1));
    }, molecules);
    const kEvaluate = kernel(() => {
      const oxygen = uint(instanceIndex).mul(3);
      const rawZ = atomicPositions.element(oxygen).z;
      const z1 = rawZ.sub(float(lz).mul(floor(rawZ.add(lz / 2).div(lz))));
      const ownBin = particleBins.element(instanceIndex);
      const potential = float(0).toVar();
      const force = float(0).toVar();
      for (let image = -imageLayers; image <= imageLayers; image++) {
        Loop(bins, ({ i }: { i: Node }) => {
          const bin = uv(i);
          const density = fl(atomicLoad(counts.element(bin)))
            .mul(inverseBinVolume)
            .toVar();
          if (image === 0) {
            If(bin.equal(ownBin), () => density.subAssign(inverseBinVolume));
          }
          const z2 = fl(bin)
            .add(0.5)
            .mul(binWidth)
            .sub(lz / 2)
            .add(image * lz);
          const separation = z2.sub(z1);
          const absolute = abs(separation);
          const radius = max(float(cutoff), absolute);
          const inverse = float(1).div(radius);
          const inverse2 = inverse.mul(inverse);
          const inverse4 = inverse2.mul(inverse2);
          const inverse5 = inverse4.mul(inverse);
          const inverse10 = inverse5.mul(inverse5);
          const inverse11 = inverse10.mul(inverse);
          potential.addAssign(
            density.mul(binWidth * 8 * Math.PI * epsilon).mul(
              float(sigma12 / 10)
                .mul(inverse10)
                .sub(float(sigma6 / 4).mul(inverse4)),
            ),
          );
          If(absolute.greaterThan(cutoff), () => {
            force.addAssign(
              density
                .mul(binWidth * -8 * Math.PI * epsilon)
                .mul(sign(separation))
                .mul(float(sigma12).mul(inverse11).sub(float(sigma6).mul(inverse5))),
            );
          }).Else(() => {
            force.addAssign(
              density.mul(binWidth * -2 * Math.PI * potentialAtCutoff).mul(separation),
            );
          });
        });
      }
      this.tailForceEnergyVirial
        .element(instanceIndex)
        .assign(vec3(force, potential.mul(0.5), z1.mul(force)));
    }, molecules);
    const kApply = kernel(() => {
      const oxygen = uint(instanceIndex).mul(3);
      const correction = this.tailForceEnergyVirial.element(instanceIndex);
      targetForces.element(oxygen).addAssign(vec3(0, 0, correction.x));
      targetEnergyVirial.element(oxygen).addAssign(vec2(correction.y, correction.z));
    }, molecules);
    this.kernelsList = [kClear, kBin, kEvaluate, kApply];
  }

  kernels(): Kernel[] {
    return [...this.kernelsList];
  }

  async read(renderer: WebGPURenderer): Promise<{
    potentialEnergy: number;
    forcesZ: Float32Array;
    virial: number;
  }> {
    const raw = new Float32Array(
      await renderer.getArrayBufferAsync(this.tailForceEnergyVirial.value),
    );
    const stride = raw.length === 4 * this.molecules ? 4 : 3;
    const forcesZ = new Float32Array(this.molecules);
    let potentialEnergy = 0;
    let virial = 0;
    for (let molecule = 0; molecule < this.molecules; molecule++) {
      forcesZ[molecule] = raw[stride * molecule];
      potentialEnergy += raw[stride * molecule + 1];
      virial += raw[stride * molecule + 2];
    }
    return { potentialEnergy, forcesZ, virial };
  }
}
