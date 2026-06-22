import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as THREE from "three/webgpu";
import type { Observables } from "../engine/types";
import type { Simulation } from "../sim/Simulation";
import { ParticleSystem } from "./ParticleSystem";

/** Invoked (throttled) with the latest measurements and frame rate for the HUD. */
export type SampleListener = (observables: Observables, fps: number) => void;

const SAMPLE_INTERVAL_MS = 100;

/**
 * Imperative Three.js view: owns the WebGPU renderer and drives the simulation in the
 * render loop. Free of React so the hot path never re-renders the component tree.
 * Rebuilds its visuals when the simulation topology changes (particle count / box).
 */
export class SimulationView {
  private readonly container: HTMLElement;
  private readonly simulation: Simulation;
  private readonly onSample: SampleListener | undefined;

  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGPURenderer | null = null;
  private controls: OrbitControls | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribeStructural: (() => void) | null = null;

  private cell: THREE.LineSegments | null = null;
  private particles: ParticleSystem | null = null;
  private disposed = false;

  fps = 0;
  private fpsWindowStart = 0;
  private framesInWindow = 0;
  private lastSampleAt = 0;

  constructor(container: HTMLElement, simulation: Simulation, onSample?: SampleListener) {
    this.container = container;
    this.simulation = simulation;
    this.onSample = onSample;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.2, 0.8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
    fill.position.set(-1, -0.5, -1);
    this.scene.add(fill);
  }

  async init(): Promise<void> {
    const renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0e14, 1);
    this.renderer = renderer;
    this.container.appendChild(renderer.domElement);
    this.resize();

    await renderer.init();
    if (this.disposed) return;

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.buildVisuals();
    this.unsubscribeStructural = this.simulation.onStructuralChange(() => this.buildVisuals());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    this.fpsWindowStart = performance.now();
    renderer.setAnimationLoop(() => this.tick());
  }

  /** (Re)build the cell wireframe + particle instances for the current topology. */
  private buildVisuals(): void {
    if (this.cell) {
      this.scene.remove(this.cell);
      this.cell.geometry.dispose();
      (this.cell.material as THREE.Material).dispose();
      this.cell = null;
    }
    if (this.particles) {
      this.scene.remove(this.particles.mesh);
      this.particles.dispose();
      this.particles = null;
    }

    const [lx, ly, lz] = this.simulation.box.lengths;
    const boxGeometry = new THREE.BoxGeometry(lx, ly, lz);
    this.cell = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeometry),
      new THREE.LineBasicMaterial({
        color: 0x3b82f6,
        transparent: true,
        opacity: 0.6,
      }),
    );
    boxGeometry.dispose();
    this.scene.add(this.cell);

    this.particles = new ParticleSystem(this.simulation.state, this.simulation.species);
    this.scene.add(this.particles.mesh);

    this.frameCamera(Math.max(lx, ly, lz));
  }

  private frameCamera(extent: number): void {
    const d = extent * 1.7;
    this.camera.position.set(d * 0.6, d * 0.5, d);
    this.camera.near = extent * 0.01;
    this.camera.far = extent * 20;
    this.camera.updateProjectionMatrix();
    this.controls?.target.set(0, 0, 0);
    this.controls?.update();
  }

  private resize(): void {
    const { renderer, container, camera } = this;
    if (!renderer) return;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  private tick(): void {
    const { renderer, controls } = this;
    if (!renderer) return;

    this.simulation.advance();
    this.particles?.update(this.simulation.state);

    controls?.update();
    renderer.render(this.scene, this.camera);

    // Frame-rate tracking.
    this.framesInWindow += 1;
    const now = performance.now();
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 500) {
      this.fps = (this.framesInWindow * 1000) / elapsed;
      this.framesInWindow = 0;
      this.fpsWindowStart = now;
    }

    // Throttled observable sampling for the HUD.
    if (this.onSample && now - this.lastSampleAt >= SAMPLE_INTERVAL_MS) {
      this.lastSampleAt = now;
      this.onSample(this.simulation.observables(), this.fps);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unsubscribeStructural?.();
    this.resizeObserver?.disconnect();
    this.controls?.dispose();

    if (this.cell) {
      this.cell.geometry.dispose();
      (this.cell.material as THREE.Material).dispose();
    }
    this.particles?.dispose();

    const renderer = this.renderer;
    if (renderer) {
      renderer.setAnimationLoop(null);
      renderer.domElement.parentElement?.removeChild(renderer.domElement);
      renderer.dispose();
      this.renderer = null;
    }
  }
}
