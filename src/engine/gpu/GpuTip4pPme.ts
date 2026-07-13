import {
  compute,
  exp,
  Fn,
  float,
  instancedArray,
  instanceIndex,
  round,
  sqrt,
  uint,
  vec2,
  vec3,
} from "three/tsl";
import type { WebGPURenderer } from "three/webgpu";
import { TIP4P_2005_VIRTUAL_GAMMA } from "../../core/tip4p2005";
import { COULOMB_CONSTANT } from "../../core/units";
import { GpuPmeReciprocal, type GpuPmeReciprocalInput } from "./GpuPmeReciprocal";

const WORKGROUP = [64];
const vec2Array = (data: Float32Array) => instancedArray(data, "vec2");
const vec3Array = (data: Float32Array) => instancedArray(data, "vec3");
export type GpuVec3Storage = ReturnType<typeof vec3Array>;
export const gpuVec3Storage = vec3Array;
type Kernel = ReturnType<typeof compute>;
// biome-ignore lint/suspicious/noExplicitAny: TSL node arithmetic is intentionally loosely typed.
type Node = any;
const kernel = (body: () => void, count: number): Kernel =>
  compute(Fn(body)() as never, count, WORKGROUP);
const roundVec = (value: Node) => vec3(round(value.x), round(value.y), round(value.z));
const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);

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

export interface GpuTip4pPmeInput extends Omit<GpuPmeReciprocalInput, "count" | "exclusionGroups"> {
  readonly molecules: number;
  /** Optional live O,H1,H2 atom buffer; charge sites are rebuilt before each solve. */
  readonly atomicPositionStorage?: GpuVec3Storage;
}

/** TIP4P/2005 electrostatics layered on the validated raw smooth-PME charge-site path. */
export class GpuTip4pPme {
  readonly molecules: number;
  readonly pme: GpuPmeReciprocal;

  get atomicForceStorage() {
    return this.atomicForces;
  }

  private readonly atomicForces: ReturnType<typeof vec3Array>;
  private readonly excludedEnergyVirial: ReturnType<typeof vec2Array>;
  private readonly kBuildChargeSites: Kernel | null;
  private readonly kExcludeAndRedistribute: Kernel;

  constructor(input: GpuTip4pPmeInput) {
    const { molecules, atomicPositionStorage, ...pmeInput } = input;
    if (!Number.isInteger(molecules) || molecules < 1) {
      throw new RangeError("GPU TIP4P molecule count must be positive");
    }
    if (pmeInput.positions.length !== 9 * molecules || pmeInput.charges.length !== 3 * molecules) {
      throw new RangeError("GPU TIP4P requires H1,H2,M charge-site triples");
    }
    this.molecules = molecules;
    this.pme = new GpuPmeReciprocal({
      count: 3 * molecules,
      ...pmeInput,
      exclusionGroups: Uint32Array.from({ length: 3 * molecules }, (_, site) =>
        Math.floor(site / 3),
      ),
    });
    this.atomicForces = vec3Array(new Float32Array(9 * molecules));
    this.excludedEnergyVirial = vec2Array(new Float32Array(2 * molecules));
    const gamma = TIP4P_2005_VIRTUAL_GAMMA;
    const halfGamma = 0.5 * gamma;
    const boxVector = vec3(...pmeInput.box.lengths);

    this.kBuildChargeSites = atomicPositionStorage
      ? kernel(() => {
          const atomBase = uint(instanceIndex).mul(3);
          const oxygen = atomicPositionStorage.element(atomBase);
          const d1 = atomicPositionStorage.element(atomBase.add(1)).sub(oxygen).toVar();
          const d2 = atomicPositionStorage.element(atomBase.add(2)).sub(oxygen).toVar();
          d1.assign(d1.sub(boxVector.mul(roundVec(d1.div(boxVector)))));
          d2.assign(d2.sub(boxVector.mul(roundVec(d2.div(boxVector)))));
          const siteBase = uint(instanceIndex).mul(3);
          this.pme.positionStorage.element(siteBase).assign(oxygen.add(d1));
          this.pme.positionStorage.element(siteBase.add(1)).assign(oxygen.add(d2));
          this.pme.positionStorage
            .element(siteBase.add(2))
            .assign(oxygen.add(d1.add(d2).mul(halfGamma)));
        }, molecules)
      : null;

    this.kExcludeAndRedistribute = kernel(() => {
      const base = uint(instanceIndex).mul(3);
      const p0 = this.pme.positionStorage.element(base);
      const p1 = this.pme.positionStorage.element(base.add(1));
      const p2 = this.pme.positionStorage.element(base.add(2));
      const q0 = this.pme.chargeStorage.element(base).x;
      const q1 = this.pme.chargeStorage.element(base.add(1)).x;
      const q2 = this.pme.chargeStorage.element(base.add(2)).x;
      const f0 = this.pme.forceStorage.element(base).toVar();
      const f1 = this.pme.forceStorage.element(base.add(1)).toVar();
      const f2 = this.pme.forceStorage.element(base.add(2)).toVar();
      const excludedEnergy = float(0).toVar();
      const excludedVirial = float(0).toVar();

      const subtractPair = (pa: Node, pb: Node, qa: Node, qb: Node, fa: Node, fb: Node) => {
        const delta = pa.sub(pb).toVar();
        delta.assign(delta.sub(boxVector.mul(roundVec(delta.div(boxVector)))));
        const r2 = delta.dot(delta);
        const r = sqrt(r2);
        const qqKe = qa.mul(qb).mul(COULOMB_CONSTANT);
        const erfR = float(1).sub(erfcApprox(r.mul(pmeInput.alpha)));
        const expR = exp(r2.mul(-pmeInput.alpha * pmeInput.alpha));
        const energy = qqKe.mul(erfR).div(r);
        const fOverR = qqKe.mul(
          erfR.div(r2.mul(r)).sub(
            float(TWO_OVER_SQRT_PI * pmeInput.alpha)
              .mul(expR)
              .div(r2),
          ),
        );
        const force = delta.mul(fOverR);
        fa.subAssign(force);
        fb.addAssign(force);
        excludedEnergy.addAssign(energy);
        excludedVirial.addAssign(fOverR.mul(r2));
      };
      subtractPair(p0, p1, q0, q1, f0, f1);
      subtractPair(p0, p2, q0, q2, f0, f2);
      subtractPair(p1, p2, q1, q2, f1, f2);

      this.pme.forceStorage.element(base).assign(f0);
      this.pme.forceStorage.element(base.add(1)).assign(f1);
      this.pme.forceStorage.element(base.add(2)).assign(f2);
      this.excludedEnergyVirial.element(instanceIndex).assign(vec2(excludedEnergy, excludedVirial));
      this.atomicForces.element(base).assign(f2.mul(1 - gamma));
      this.atomicForces.element(base.add(1)).assign(f0.add(f2.mul(halfGamma)));
      this.atomicForces.element(base.add(2)).assign(f1.add(f2.mul(halfGamma)));
    }, molecules);
  }

  async compute(renderer: WebGPURenderer): Promise<void> {
    if (this.kBuildChargeSites) await renderer.computeAsync(this.kBuildChargeSites);
    await this.pme.computeFull(renderer);
    await renderer.computeAsync(this.kExcludeAndRedistribute);
  }

  private async readVec3(renderer: WebGPURenderer, storage: ReturnType<typeof vec3Array>) {
    const raw = new Float32Array(await renderer.getArrayBufferAsync(storage.value));
    if (raw.length === 9 * this.molecules) return raw;
    const packed = new Float32Array(9 * this.molecules);
    for (let i = 0; i < 3 * this.molecules; i++) {
      packed[3 * i] = raw[4 * i];
      packed[3 * i + 1] = raw[4 * i + 1];
      packed[3 * i + 2] = raw[4 * i + 2];
    }
    return packed;
  }

  async readSiteForces(renderer: WebGPURenderer): Promise<Float32Array> {
    return this.pme.readForces(renderer);
  }

  async readAtomicForces(renderer: WebGPURenderer): Promise<Float32Array> {
    return this.readVec3(renderer, this.atomicForces);
  }

  async readEnergyVirial(renderer: WebGPURenderer): Promise<{ energy: number; virial: number }> {
    const raw = await this.pme.readFullEnergyVirial(renderer);
    const excluded = new Float32Array(
      await renderer.getArrayBufferAsync(this.excludedEnergyVirial.value),
    );
    let energy = raw.energy;
    let virial = raw.virial;
    for (let i = 0; i < excluded.length; i += 2) {
      energy -= excluded[i];
      virial -= excluded[i + 1];
    }
    return { energy, virial };
  }
}
