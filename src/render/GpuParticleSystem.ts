import { instanceIndex, positionLocal } from "three/tsl";
import * as THREE from "three/webgpu";
import type { GpuEngine } from "../engine/gpu/GpuEngine";

/**
 * GPU-resident instanced rendering. The per-instance centre is read directly from
 * the engine's positions storage buffer in the vertex stage (`positionNode`), so the
 * GPU compute output is drawn with zero CPU readback and zero per-frame matrix writes.
 */
export class GpuParticleSystem {
  readonly mesh: THREE.InstancedMesh;

  constructor(engine: GpuEngine) {
    const sp = engine.species;
    const geometry = new THREE.IcosahedronGeometry(sp.radius, 2);
    const material = new THREE.MeshStandardNodeMaterial({
      roughness: 0.45,
      metalness: 0.05,
    });
    material.color = new THREE.Color(sp.color);
    // Local vertex position + per-instance centre fetched from the GPU buffer.
    material.positionNode = positionLocal.add(engine.positions.element(instanceIndex));

    const count = engine.config.particleCount;
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.frustumCulled = false;

    // Instance matrices stay identity; positionNode supplies the placement.
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
