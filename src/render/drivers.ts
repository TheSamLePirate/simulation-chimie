import * as THREE from "three/webgpu";
import type { SurfaceTensionAnalysis } from "../core/experiments/surfaceTension";
import { demixingOrderParameter } from "../core/observables/demixing";
import { type RadialDistribution, radialDistribution } from "../core/observables/rdf";
import { type SpeedDistribution, speedDistribution } from "../core/observables/speedDistribution";
import type { Vec3 } from "../core/types";
import { CpuEngine } from "../engine/cpu/CpuEngine";
import { GpuEngine } from "../engine/gpu/GpuEngine";
import type { AccuracyLevel, Observables, SimConfig } from "../engine/types";
import type { Snapshot } from "../state/schema";
import { captureSnapshot } from "../state/snapshot";
import type { ColorMode } from "../state/store";
import { BondSystem } from "./BondSystem";
import { GpuParticleSystem } from "./GpuParticleSystem";
import { ParticleSystem } from "./ParticleSystem";

const ZERO_OBSERVABLES: Observables = {
  step: 0,
  time: 0,
  kineticEnergy: 0,
  potentialEnergy: 0,
  totalEnergy: 0,
  temperature: 0,
  pressure: 0,
};

/** Build the periodic-cell wireframe for a given cell size. */
function buildCell(lengths: Vec3): THREE.LineSegments {
  const [lx, ly, lz] = lengths;
  const box = new THREE.BoxGeometry(lx, ly, lz);
  const cell = new THREE.LineSegments(
    new THREE.EdgesGeometry(box),
    new THREE.LineBasicMaterial({
      color: 0xd6ac55,
      transparent: true,
      opacity: 0.42,
    }),
  );
  box.dispose();
  return cell;
}

function disposeCell(cell: THREE.LineSegments): void {
  cell.geometry.dispose();
  (cell.material as THREE.Material).dispose();
}

/**
 * A simulation backend bound to its renderable scene group. The renderer owns the
 * render loop and calls `advance` each frame; the driver hides whether stepping runs
 * on the CPU (with a per-frame mesh sync) or the GPU (rendered straight from buffers).
 */
export interface SimDriver {
  readonly group: THREE.Group;
  readonly boxLengths: Vec3;
  /** Async warm-up (GPU initial forces); resolves immediately for CPU. */
  ready(): Promise<void>;
  /** Advance one frame: steps the engine if `playing`, then syncs visuals. */
  advance(playing: boolean, substeps: number, colorMode: ColorMode): void;
  /** Advance one frame's worth of steps unconditionally (manual stepping). */
  stepOnce(substeps: number, colorMode: ColorMode): void;
  /** Latest measurements (synchronous; GPU energies update via background readback). */
  sample(): Observables;
  /** Radial distribution g(r), or null when positions aren't CPU-readable (GPU). */
  radialDistribution(): RadialDistribution | null;
  /** Speed distribution f(|v|) + MB theory, or null when velocities aren't CPU-readable (GPU). */
  speedDistribution(): SpeedDistribution | null;
  /** Demixing order parameter for binary mixtures, or null (single species / GPU). */
  demixing(): number | null;
  surfaceTensionAnalysis(): SurfaceTensionAnalysis | null;
  collectSurfaceTensionSample(relativeAreaStep?: number): SurfaceTensionAnalysis | null;
  /** Capture a restorable state snapshot, or null when state isn't CPU-readable (GPU). */
  snapshot(): Snapshot | null;
  setLevel(level: AccuracyLevel): void;
  setTimestep(dt: number): void;
  setTemperature(t: number): void;
  setThermostat(kind: SimConfig["thermostat"], tau: number): void;
  setBarostat(kind: SimConfig["barostat"], pressureTarget: number): void;
  setGravity(gravity: number): void;
  setElectricField(electricField: number): void;
  dispose(): void;
}

/** CPU reference driver: deterministic Float64 engine + per-frame instanced mesh sync. */
class CpuDriver implements SimDriver {
  readonly group = new THREE.Group();
  private readonly engine: CpuEngine;
  private readonly particles: ParticleSystem;
  private readonly bonds: BondSystem | null;
  private readonly cell: THREE.LineSegments;
  private readonly initialBoxLength: number;

  constructor(config: SimConfig) {
    this.engine = new CpuEngine(config);
    // Ball-and-stick scale for molecular systems (so bonds show); smaller monatomic spheres
    // so liquid/vapour surfaces and crystal order are visible (not one solid mass).
    const radiusScale = this.engine.bonds ? 0.42 : 0.78;
    this.particles = new ParticleSystem(this.engine.state, this.engine.species, radiusScale);
    this.bonds = this.engine.bonds ? new BondSystem(this.engine.bonds) : null;
    this.cell = buildCell(this.engine.box.lengths);
    this.initialBoxLength = this.engine.box.lengths[0];
    this.group.add(this.particles.mesh, this.cell);
    if (this.bonds) this.group.add(this.bonds.mesh);
  }

  /** Keep the cell wireframe in sync with the (possibly NPT-rescaled) box. */
  private syncCell(): void {
    this.cell.scale.setScalar(this.engine.box.lengths[0] / this.initialBoxLength);
  }

  get boxLengths(): Vec3 {
    return this.engine.box.lengths;
  }

  async ready(): Promise<void> {}

  advance(playing: boolean, substeps: number, colorMode: ColorMode): void {
    if (playing) this.engine.step(substeps);
    this.particles.update(this.engine.state, colorMode);
    this.bonds?.update(this.engine.state);
    this.syncCell();
  }

  stepOnce(substeps: number, colorMode: ColorMode): void {
    this.engine.step(substeps);
    this.particles.update(this.engine.state, colorMode);
    this.bonds?.update(this.engine.state);
    this.syncCell();
  }

  sample(): Observables {
    return this.engine.observables();
  }

  radialDistribution(): RadialDistribution {
    const rMax = 0.5 * this.engine.box.lengths[0];
    return radialDistribution(this.engine.state, this.engine.box, {
      bins: 60,
      rMax,
    });
  }

  speedDistribution(): SpeedDistribution {
    const t = this.engine.observables().temperature;
    return speedDistribution(this.engine.state, this.engine.species, t, {
      bins: 48,
    });
  }

  demixing(): number | null {
    const species = this.engine.species;
    if (species.length < 2) return null;
    const cutoff = 1.5 * Math.max(...species.map((s) => s.sigma));
    return demixingOrderParameter(this.engine.state, this.engine.box, cutoff);
  }

  surfaceTensionAnalysis(): SurfaceTensionAnalysis | null {
    return this.engine.surfaceTensionAnalysis();
  }

  collectSurfaceTensionSample(relativeAreaStep = 5e-4): SurfaceTensionAnalysis | null {
    return this.engine.collectSurfaceTensionSample(relativeAreaStep);
  }

  snapshot(): Snapshot {
    return captureSnapshot(this.engine);
  }

  setLevel(level: AccuracyLevel): void {
    this.engine.setLevel(level);
  }
  setTimestep(dt: number): void {
    this.engine.setTimestep(dt);
  }
  setTemperature(t: number): void {
    this.engine.rescaleToTemperature(t);
  }
  setThermostat(kind: SimConfig["thermostat"], tau: number): void {
    this.engine.setThermostat(kind, tau);
  }
  setBarostat(kind: SimConfig["barostat"], pressureTarget: number): void {
    this.engine.setBarostat(kind, pressureTarget);
  }
  setGravity(gravity: number): void {
    this.engine.setGravity(gravity);
  }
  setElectricField(electricField: number): void {
    this.engine.setElectricField(electricField);
  }

  dispose(): void {
    this.particles.dispose();
    this.bonds?.dispose();
    disposeCell(this.cell);
  }
}

/**
 * WebGPU driver: positions live on the GPU and are rendered directly from the storage
 * buffer (no readback). Step counters are synchronous; energy observables are refreshed
 * by a single-flight async readback (a no-op in headless WebGPU, live in real browsers).
 */
class GpuDriver implements SimDriver {
  readonly group = new THREE.Group();
  private readonly engine: GpuEngine;
  private readonly particles: GpuParticleSystem;
  private readonly cell: THREE.LineSegments;
  private last: Observables = ZERO_OBSERVABLES;
  private sampling = false;

  constructor(config: SimConfig, renderer: THREE.WebGPURenderer) {
    this.engine = new GpuEngine(config);
    this.engine.attach(renderer);
    this.particles = new GpuParticleSystem(this.engine);
    this.cell = buildCell(this.engine.boxLengths.toArray() as Vec3); // actual (possibly tall) box
    this.group.add(this.particles.mesh, this.cell);
  }

  get boxLengths(): Vec3 {
    return this.engine.boxLengths.toArray() as Vec3;
  }

  async ready(): Promise<void> {
    await this.engine.warmup();
  }

  advance(playing: boolean, substeps: number, _colorMode: ColorMode): void {
    if (playing) this.engine.step(substeps);
  }

  stepOnce(substeps: number, _colorMode: ColorMode): void {
    this.engine.step(substeps);
  }

  sample(): Observables {
    if (!this.sampling) {
      this.sampling = true;
      this.engine
        .observables()
        .then((o) => {
          this.last = o;
        })
        .catch(() => {})
        .finally(() => {
          this.sampling = false;
        });
    }
    // Step/time come from synchronous counters so they update even if readback stalls.
    return {
      ...this.last,
      step: this.engine.steps,
      time: this.engine.elapsedPs,
    };
  }

  radialDistribution(): RadialDistribution | null {
    // Positions are GPU-resident; g(r) would need a (headless-blocked) readback.
    return null;
  }

  speedDistribution(): SpeedDistribution | null {
    // Velocities are GPU-resident; the histogram would need a readback.
    return null;
  }

  demixing(): number | null {
    return null;
  }

  surfaceTensionAnalysis(): SurfaceTensionAnalysis | null {
    return null;
  }

  collectSurfaceTensionSample(_relativeAreaStep = 5e-4): SurfaceTensionAnalysis | null {
    return null;
  }

  snapshot(): Snapshot | null {
    // GPU state lives on the device; capturing it needs a (headless-blocked) readback.
    return null;
  }

  setLevel(level: AccuracyLevel): void {
    this.engine.setLevel(level);
  }
  setTimestep(dt: number): void {
    this.engine.setTimestep(dt);
  }
  setTemperature(_t: number): void {
    // GPU live re-thermalisation is not implemented; reset to apply a new temperature.
  }
  setThermostat(kind: SimConfig["thermostat"], tau: number): void {
    // GPU Berendsen: λ is recomputed from the readback KE in engine.observables().
    this.engine.setThermostat(kind, tau);
  }
  setBarostat(_kind: SimConfig["barostat"], _pressureTarget: number): void {
    // GPU barostat needs a virial reduction on device; CPU engine only for now.
  }
  setGravity(gravity: number): void {
    this.engine.setGravity(gravity);
  }
  setElectricField(electricField: number): void {
    this.engine.setElectricField(electricField);
  }

  dispose(): void {
    this.particles.dispose();
    this.engine.dispose();
    disposeCell(this.cell);
  }
}

/**
 * The GPU engine only implements single-species monatomic Lennard-Jones / WCA with periodic
 * boundaries (no charges, no molecules, no walls). Every other scene must run on the CPU.
 */
export function gpuSupportsConfig(config: SimConfig): boolean {
  // The GPU runs what it reproduces faithfully against the CPU oracle:
  //  • Monatomic L0–L3 (LJ/WCA/Coulomb): forces match to float32, the O(N) cell list scales it to
  //    ~16k atoms.
  //  • Molecular L4–L8 (atomistic water/oil/ions): forces match to float32 AND the dynamics now
  //    track the CPU — the droplet coheres, dissolution dissolves, T sits within ~10% of the CPU
  //    (thermostat-controlled). Three fixes unlocked this: enable Wolf-DSF Coulomb for molecular
  //    (H-bond cohesion), keep molecular on the brute O(N²) nonbonded path (the molecular cell-list
  //    variant dropped neighbours ⇒ zero forces), and run SHAKE/RATTLE to convergence (50/30 iters,
  //    not 6/4 — water's coupled H–H constraint converges slowly; under-convergence injects energy).
  //  • L11 quantitative surface tension: TIP4P/2005 virtual sites, smooth PME, slab correction,
  //    raw O–O LJ and Janecek's inhomogeneous dispersion tail all match the Float64 CPU oracle.
  // L9/L10 (alkane dihedrals, Morse dissociation) stay CPU-only — no GPU dihedral/Morse kernels.
  // Barostat (NPT) needs a device-side virial reduction ⇒ still CPU-only.
  const supported =
    config.level === "L0" ||
    config.level === "L1" ||
    config.level === "L2" ||
    config.level === "L3" ||
    config.level === "L4" ||
    config.level === "L5" ||
    config.level === "L6" ||
    config.level === "L7" ||
    config.level === "L8" ||
    config.level === "L11";
  return supported && config.barostat === "none";
}

/** Build the driver for the configured backend; GPU falls back to CPU when unsupported. */
export function createDriver(config: SimConfig, renderer: THREE.WebGPURenderer): SimDriver {
  if (config.engineKind === "gpu" && gpuSupportsConfig(config)) {
    return new GpuDriver(config, renderer);
  }
  return new CpuDriver(config);
}
