import * as THREE from "three/webgpu";
import type { SimState, Species } from "../core/types";
import type { ColorMode } from "../state/store";

/**
 * Instanced sphere rendering of the particle ensemble. One InstancedMesh, updated in
 * place each frame from the SoA buffers — no per-frame allocation, no scene-graph churn.
 *
 * Colour modes: `species` (fixed per type) or `speed` (a blue→red kinetic-energy map,
 * i.e. an instantaneous "temperature" view), recoloured each frame.
 */
export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly radii: Float32Array;
  private readonly species: readonly Species[];
  private lastMode: ColorMode | null = null;

  constructor(state: SimState, species: readonly Species[]) {
    this.species = species;
    const geometry = new THREE.IcosahedronGeometry(1, 3);
    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.45,
      metalness: 0.05,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, state.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    this.radii = new Float32Array(state.count);
    for (let i = 0; i < state.count; i++) this.radii[i] = species[state.typeIds[i]].radius;

    this.applySpeciesColors(state);
    this.update(state, "species");
  }

  /** Push positions into the instance matrices and refresh colours for the mode. */
  update(state: SimState, colorMode: ColorMode): void {
    const { positions } = state;
    const dummy = this.dummy;
    for (let i = 0; i < state.count; i++) {
      dummy.position.set(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
      dummy.scale.setScalar(this.radii[i]);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;

    if (colorMode === "speed") {
      this.applySpeedColors(state);
    } else if (this.lastMode !== "species") {
      this.applySpeciesColors(state);
    }
    this.lastMode = colorMode;
  }

  private applySpeciesColors(state: SimState): void {
    for (let i = 0; i < state.count; i++) {
      this.color.setHex(this.species[state.typeIds[i]].color);
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private applySpeedColors(state: SimState): void {
    const { velocities, count } = state;
    let meanSpeed = 0;
    for (let i = 0; i < count; i++) {
      meanSpeed += Math.hypot(velocities[3 * i], velocities[3 * i + 1], velocities[3 * i + 2]);
    }
    meanSpeed = count > 0 ? meanSpeed / count : 1;
    const scale = meanSpeed > 1e-9 ? 1 / (2 * meanSpeed) : 0;

    for (let i = 0; i < count; i++) {
      const speed = Math.hypot(velocities[3 * i], velocities[3 * i + 1], velocities[3 * i + 2]);
      const t = Math.min(1, speed * scale);
      // Hue 0.66 (blue, slow) → 0 (red, fast).
      this.color.setHSL((1 - t) * 0.66, 0.9, 0.55);
      this.mesh.setColorAt(i, this.color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material;
    if (Array.isArray(material)) {
      for (const m of material) m.dispose();
    } else {
      material.dispose();
    }
    this.mesh.dispose();
  }
}
