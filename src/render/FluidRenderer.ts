import {
  Fn,
  float,
  max,
  mix,
  normalize,
  normalView,
  pow,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

/**
 * Screen-space fluid surface ("metaballs"), three passes:
 *  1. render the scene normally into an offscreen colour target;
 *  2. render the particles additively as soft round splats into a density field (camera-facing
 *     dome falloff ⇒ overlapping particles merge into a smooth field);
 *  3. a full-screen composite reconstructs a fake surface normal from the field gradient and
 *     shades a translucent water surface (diffuse + Fresnel rim) over the scene where the field
 *     exceeds a threshold.
 *
 * Approximate but real (no per-particle raymarch). Works with the CPU instanced-mesh particles;
 * the GPU path keeps the GPU-resident sphere rendering (its vertex position node can't be
 * overridden by the field material).
 */
export class FluidRenderer {
  private readonly rtScene = new THREE.RenderTarget(2, 2, {
    depthBuffer: true,
    type: THREE.HalfFloatType,
  });
  private readonly rtField = new THREE.RenderTarget(2, 2, {
    depthBuffer: false,
    type: THREE.HalfFloatType,
  });
  private readonly uTexel = uniform(new THREE.Vector2(0.5, 0.5));
  private readonly fieldMaterial: THREE.MeshBasicNodeMaterial;
  private readonly quad: THREE.QuadMesh;

  constructor() {
    // Soft camera-facing dome per particle ⇒ additive blend builds a smooth density field.
    this.fieldMaterial = new THREE.MeshBasicNodeMaterial();
    this.fieldMaterial.colorNode = vec3(pow(max(normalView.z, float(0)), float(1.5)));
    this.fieldMaterial.transparent = true;
    this.fieldMaterial.blending = THREE.AdditiveBlending;
    this.fieldMaterial.depthWrite = false;
    this.fieldMaterial.depthTest = false;

    const fieldTex = this.rtField.texture;
    const sceneTex = this.rtScene.texture;
    const composite = Fn(() => {
      const uv = screenUV;
      const tx = this.uTexel.x;
      const ty = this.uTexel.y;
      const f = texture(fieldTex, uv).r;
      // Screen-space gradient ⇒ fake surface normal.
      const fx = texture(fieldTex, uv.add(vec2(tx, 0))).r.sub(
        texture(fieldTex, uv.sub(vec2(tx, 0))).r,
      );
      const fy = texture(fieldTex, uv.add(vec2(0, ty))).r.sub(
        texture(fieldTex, uv.sub(vec2(0, ty))).r,
      );
      const n = normalize(vec3(fx.mul(8), fy.mul(8), float(1)));
      const facing = max(n.z, float(0));
      const fresnel = pow(float(1).sub(facing), float(3));
      const water = vec3(0.05, 0.32, 0.72);
      const lit = water
        .mul(float(0.35).add(facing.mul(0.65)))
        .add(vec3(0.55, 0.75, 1.0).mul(fresnel.mul(0.6)));
      const mask = smoothstep(float(0.5), float(1.1), f);
      const scene = texture(sceneTex, uv).rgb;
      return vec3(mix(scene, lit, mask));
    });
    const compositeMaterial = new THREE.MeshBasicNodeMaterial();
    compositeMaterial.colorNode = composite();
    this.quad = new THREE.QuadMesh(compositeMaterial);
  }

  setSize(width: number, height: number): void {
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    this.rtScene.setSize(w, h);
    this.rtField.setSize(w, h);
    this.uTexel.value.set(1 / w, 1 / h);
  }

  /** Render `scene`/`camera` with a screen-space fluid surface for the particle splats. */
  render(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    clearColor: THREE.ColorRepresentation,
  ): void {
    // Pass 1 — scene as usual.
    renderer.setRenderTarget(this.rtScene);
    renderer.setClearColor(clearColor, 1);
    renderer.clear();
    renderer.render(scene, camera);

    // Pass 2 — density field (particles only; hide line/wireframe objects).
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if ((o as THREE.LineSegments).isLineSegments && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
    scene.overrideMaterial = this.fieldMaterial;
    renderer.setRenderTarget(this.rtField);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    scene.overrideMaterial = null;
    for (const o of hidden) o.visible = true;

    // Pass 3 — composite to the screen.
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.rtScene.dispose();
    this.rtField.dispose();
    this.fieldMaterial.dispose();
    (this.quad.material as THREE.Material).dispose();
  }
}
