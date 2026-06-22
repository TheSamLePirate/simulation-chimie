import * as THREE from "three/webgpu";
import type { SimState, Species } from "../core/types";

/**
 * Instanced sphere rendering of the particle ensemble. One InstancedMesh, updated
 * in place each frame from the SoA position buffer — no per-frame allocation, no
 * scene-graph churn. Colours/radii come from the species table (set once).
 */
export class ParticleSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly radii: Float32Array;

  constructor(state: SimState, species: readonly Species[]) {
    const geometry = new THREE.IcosahedronGeometry(1, 3);
    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.45,
      metalness: 0.05,
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, state.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;

    this.radii = new Float32Array(state.count);
    const color = new THREE.Color();
    for (let i = 0; i < state.count; i++) {
      const sp = species[state.typeIds[i]];
      this.radii[i] = sp.radius;
      color.setHex(sp.color);
      this.mesh.setColorAt(i, color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    this.update(state);
  }

  /** Push current positions into the instance matrices. */
  update(state: SimState): void {
    const { positions } = state;
    const dummy = this.dummy;
    for (let i = 0; i < state.count; i++) {
      dummy.position.set(positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]);
      dummy.scale.setScalar(this.radii[i]);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
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
