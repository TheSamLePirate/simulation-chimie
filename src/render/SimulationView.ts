import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as THREE from "three/webgpu";
import type { SimConfig } from "../engine/types";
import { type AppState, appStore } from "../state/store";
import { setActiveDriver } from "./activeDriver";
import { createDriver, type SimDriver } from "./drivers";

const SAMPLE_INTERVAL_MS = 100;
const RDF_INTERVAL_MS = 500;

/** Config keys whose change requires a full driver rebuild. */
const STRUCTURAL_KEYS: ReadonlyArray<keyof SimConfig> = [
  "particleCount",
  "boxLength",
  "boundary",
  "seed",
  "speciesName",
  "secondSpeciesName",
  "engineKind",
  // Level is structural: L4 (water) changes atom count + topology, so rebuild on any change.
  "level",
];

interface AppliedState {
  config: SimConfig;
  stepNonce: number;
  resetNonce: number;
}

/**
 * Imperative Three.js view. Owns the WebGPU renderer and the active simulation driver
 * (CPU or GPU), runs the render loop, and bridges the React store imperatively so the
 * hot path never re-renders the component tree. Rebuilds the driver when the topology
 * or backend changes.
 */
export class SimulationView {
  private readonly container: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGPURenderer | null = null;
  private controls: OrbitControls | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private unsubscribe: (() => void) | null = null;

  private driver: SimDriver | null = null;
  private applied: AppliedState;
  private rebuildToken = 0;
  private disposed = false;

  fps = 0;
  private fpsWindowStart = 0;
  private framesInWindow = 0;
  private lastSampleAt = 0;
  private lastRdfAt = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.applied = {
      config: appStore.getState().config,
      stepNonce: appStore.getState().stepNonce,
      resetNonce: appStore.getState().resetNonce,
    };

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    // Sky/ground hemisphere ambient gives volume; key + cool fill shape the spheres.
    this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x202830, 0.7));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(1, 1.2, 0.8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.45);
    fill.position.set(-1, -0.5, -1);
    this.scene.add(fill);
  }

  async init(): Promise<void> {
    const renderer = new THREE.WebGPURenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0a0e14, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.renderer = renderer;
    this.container.appendChild(renderer.domElement);
    this.resize();

    await renderer.init();
    if (this.disposed) return;

    // Expose the live renderer for the GPU validation harness (window.__md).
    (window as unknown as { __mdRenderer?: THREE.WebGPURenderer }).__mdRenderer = renderer;

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    await this.rebuildDriver();
    if (this.disposed) return;

    this.unsubscribe = appStore.subscribe((state) => this.onStoreChange(state));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);

    this.fpsWindowStart = performance.now();
    renderer.setAnimationLoop(() => this.tick());
  }

  private onStoreChange(state: AppState): void {
    if (!this.driver) return;
    const prev = this.applied;
    const structural = STRUCTURAL_KEYS.some((k) => state.config[k] !== prev.config[k]);
    const rebuild = structural || state.resetNonce !== prev.resetNonce;

    this.applied = {
      config: state.config,
      stepNonce: state.stepNonce,
      resetNonce: state.resetNonce,
    };

    if (rebuild) {
      void this.rebuildDriver();
      return;
    }
    if (state.config.timestep !== prev.config.timestep) {
      this.driver.setTimestep(state.config.timestep);
    }
    if (state.config.temperature !== prev.config.temperature) {
      this.driver.setTemperature(state.config.temperature);
    }
    if (
      state.config.thermostat !== prev.config.thermostat ||
      state.config.thermostatTau !== prev.config.thermostatTau
    ) {
      this.driver.setThermostat(state.config.thermostat, state.config.thermostatTau);
    }
    if (
      state.config.barostat !== prev.config.barostat ||
      state.config.pressureTarget !== prev.config.pressureTarget
    ) {
      this.driver.setBarostat(state.config.barostat, state.config.pressureTarget);
    }
    if (state.config.gravity !== prev.config.gravity) {
      this.driver.setGravity(state.config.gravity);
    }
    if (state.stepNonce !== prev.stepNonce) this.driver.stepOnce(state.substeps, state.colorMode);
  }

  private async rebuildDriver(): Promise<void> {
    const renderer = this.renderer;
    if (!renderer) return;
    const token = ++this.rebuildToken;

    const driver = createDriver(appStore.getState().config, renderer);
    await driver.ready();
    if (this.disposed || token !== this.rebuildToken) {
      driver.dispose();
      return;
    }

    if (this.driver) {
      this.scene.remove(this.driver.group);
      this.driver.dispose();
    }
    this.driver = driver;
    setActiveDriver(driver);
    this.scene.add(driver.group);
    this.frameCamera(Math.max(...driver.boxLengths));
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
    const renderer = this.renderer;
    if (!renderer) return;

    const state = appStore.getState();
    this.driver?.advance(state.playing, state.substeps, state.colorMode);

    this.controls?.update();
    renderer.render(this.scene, this.camera);

    this.framesInWindow += 1;
    const now = performance.now();
    const windowElapsed = now - this.fpsWindowStart;
    if (windowElapsed >= 500) {
      this.fps = (this.framesInWindow * 1000) / windowElapsed;
      this.framesInWindow = 0;
      this.fpsWindowStart = now;
    }

    if (this.driver && now - this.lastSampleAt >= SAMPLE_INTERVAL_MS) {
      this.lastSampleAt = now;
      appStore.getState().publishSample(this.driver.sample(), this.fps);
    }

    if (this.driver && now - this.lastRdfAt >= RDF_INTERVAL_MS) {
      this.lastRdfAt = now;
      appStore.getState().publishAnalysis(this.driver.radialDistribution(), this.driver.demixing());
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.unsubscribe?.();
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    setActiveDriver(null);
    if (this.driver) {
      this.scene.remove(this.driver.group);
      this.driver.dispose();
      this.driver = null;
    }

    const renderer = this.renderer;
    if (renderer) {
      renderer.setAnimationLoop(null);
      renderer.domElement.parentElement?.removeChild(renderer.domElement);
      renderer.dispose();
      this.renderer = null;
    }
  }
}
