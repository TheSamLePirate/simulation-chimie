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

  constructor(state: SimState, species: readonly Species[], radiusScale = 1) {
    this.species = species;
    const geometry = new THREE.IcosahedronGeometry(1, 3);
    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.32,
      metalness: 0.0,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, state.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    this.radii = new Float32Array(state.count);
    for (let i = 0; i < state.count; i++) {
      this.radii[i] = species[state.typeIds[i]].radius * radiusScale;
    }

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
    } else if (colorMode === "coordination") {
      this.applyCoordinationColors(state);
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

  /**
   * Colour by local coordination (number of intermolecular neighbours within ~1.3σ). Dense /
   * ordered regions (liquid + solid cores, ~12 neighbours) glow warm; surfaces and gas (few
   * neighbours) stay cool — so droplets, condensation and freezing read at a glance.
   */
  private applyCoordinationColors(state: SimState): void {
    const { positions, count, typeIds, moleculeId } = state;
    const cutoffs = new Float32Array(count);
    for (let i = 0; i < count; i++) cutoffs[i] = 1.3 * this.species[typeIds[i]].sigma;
    const coord = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const ix = positions[3 * i];
      const iy = positions[3 * i + 1];
      const iz = positions[3 * i + 2];
      const ci = cutoffs[i];
      const mi = moleculeId[i];
      for (let j = i + 1; j < count; j++) {
        if (moleculeId[j] === mi) continue;
        const dx = ix - positions[3 * j];
        const dy = iy - positions[3 * j + 1];
        const dz = iz - positions[3 * j + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        const rc = Math.max(ci, cutoffs[j]);
        if (r2 < rc * rc) {
          coord[i]++;
          coord[j]++;
        }
      }
    }
    for (let i = 0; i < count; i++) {
      const t = Math.min(1, coord[i] / 12); // 12 ≈ close-packed
      this.color.setHSL((1 - t) * 0.66, 0.85, 0.55); // blue (isolated) → red (dense core)
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
