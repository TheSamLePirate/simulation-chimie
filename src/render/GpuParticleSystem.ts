import { instancedArray, instanceIndex, positionLocal } from "three/tsl";
import * as THREE from "three/webgpu";
import type { GpuEngine } from "../engine/gpu/GpuEngine";

/**
 * GPU-resident instanced rendering. The per-instance centre is read directly from the
 * engine's positions storage buffer in the vertex stage (`positionNode`), so the GPU
 * compute output is drawn with zero CPU readback. Per-atom colour and radius come from
 * the engine's render arrays ⇒ multi-species systems (e.g. Na⁺/Cl⁻) are distinct.
 */
export class GpuParticleSystem {
  readonly mesh: THREE.InstancedMesh;

  constructor(engine: GpuEngine) {
    const count = engine.config.particleCount;
    const geometry = new THREE.IcosahedronGeometry(1, 2); // unit sphere, scaled per instance
    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.32,
      metalness: 0.0,
    });

    const colors = instancedArray(engine.renderColors, "vec3");
    const radii = instancedArray(engine.renderRadii, "float");
    material.positionNode = positionLocal
      .mul(radii.element(instanceIndex))
      .add(engine.positions.element(instanceIndex));
    material.colorNode = colors.element(instanceIndex);

    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.frustumCulled = false;

    // Instance matrices stay identity; positionNode supplies placement + scale.
    const identity = new THREE.Matrix4();
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, identity);
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
