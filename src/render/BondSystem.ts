import * as THREE from "three/webgpu";
import type { SimState } from "../core/types";

const UP = new THREE.Vector3(0, 1, 0);
/** Hide bonds longer than this (nm) — i.e. molecules split across a periodic boundary. */
const MAX_BOND = 0.25;

/**
 * Instanced cylinder rendering of intramolecular bonds, so molecules read as molecules
 * (e.g. H–O–H water) rather than loose spheres. One InstancedMesh, re-posed each frame
 * from the live atom positions; bonds stretched across a periodic image are hidden.
 */
export class BondSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly bondI: Int32Array;
  private readonly bondJ: Int32Array;

  constructor(bonds: { i: Int32Array; j: Int32Array }, radius = 0.028) {
    this.bondI = bonds.i;
    this.bondJ = bonds.j;
    const geometry = new THREE.CylinderGeometry(radius, radius, 1, 8, 1, true);
    const material = new THREE.MeshStandardNodeMaterial({
      color: 0xdfe6ee,
      roughness: 0.5,
      metalness: 0.0,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.bondI.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
  }

  update(state: SimState): void {
    const p = state.positions;
    const dummy = this.dummy;
    for (let k = 0; k < this.bondI.length; k++) {
      const i = this.bondI[k];
      const j = this.bondJ[k];
      this.a.set(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
      this.b.set(p[3 * j], p[3 * j + 1], p[3 * j + 2]);
      this.dir.subVectors(this.b, this.a);
      const len = this.dir.length();
      if (len > MAX_BOND || len < 1e-6) {
        // Collapse to a zero-scale (invisible) instance.
        dummy.position.copy(this.a);
        dummy.scale.set(0, 0, 0);
        dummy.quaternion.identity();
      } else {
        dummy.position.addVectors(this.a, this.b).multiplyScalar(0.5);
        dummy.quaternion.setFromUnitVectors(UP, this.dir.divideScalar(len));
        dummy.scale.set(1, len, 1);
      }
      dummy.updateMatrix();
      this.mesh.setMatrixAt(k, dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
