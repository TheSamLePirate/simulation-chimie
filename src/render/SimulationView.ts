import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three/webgpu'

/** Edge length of the (placeholder) simulation cell, in nm. */
const CELL_SIZE_NM = 4

/**
 * Imperative Three.js scene manager for the simulation viewport.
 *
 * Owns the WebGPU renderer, camera, controls and render loop. Kept free of React
 * so the hot path never re-renders through the component tree. Phase 0 renders an
 * empty periodic cell; later phases attach GPU-resident particle buffers here.
 */
export class SimulationView {
  private readonly container: HTMLElement
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGPURenderer | null = null
  private controls: OrbitControls | null = null
  private resizeObserver: ResizeObserver | null = null
  private disposed = false

  /** Total frames rendered since init (exposed for HUD / tests). */
  frameCount = 0
  /** Smoothed frames-per-second, refreshed roughly twice a second. */
  fps = 0
  private fpsWindowStart = 0
  private framesInWindow = 0

  constructor(container: HTMLElement) {
    this.container = container
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000)
    this.camera.position.set(CELL_SIZE_NM, CELL_SIZE_NM * 0.8, CELL_SIZE_NM * 1.6)
    this.buildScene()
  }

  /** Boot the WebGPU device and start the render loop. Rejects if WebGPU is unusable. */
  async init(): Promise<void> {
    const renderer = new THREE.WebGPURenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x0a0e14, 1)
    this.renderer = renderer
    this.container.appendChild(renderer.domElement)
    this.resize()

    await renderer.init()
    if (this.disposed) return

    this.controls = new OrbitControls(this.camera, renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 0, 0)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(this.container)

    this.fpsWindowStart = performance.now()
    renderer.setAnimationLoop(() => this.tick())
  }

  private buildScene(): void {
    const { scene } = this

    // Periodic simulation cell drawn as a wireframe box.
    const boxGeometry = new THREE.BoxGeometry(CELL_SIZE_NM, CELL_SIZE_NM, CELL_SIZE_NM)
    const cell = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeometry),
      new THREE.LineBasicMaterial({ color: 0x3b82f6 }),
    )
    scene.add(cell)
    boxGeometry.dispose()

    scene.add(new THREE.AxesHelper(CELL_SIZE_NM * 0.6))

    // Lights are unused by the wireframe but ready for upcoming particle meshes.
    scene.add(new THREE.AmbientLight(0xffffff, 0.4))
    const key = new THREE.DirectionalLight(0xffffff, 1.2)
    key.position.set(1, 1, 1)
    scene.add(key)
  }

  private resize(): void {
    const { renderer, container, camera } = this
    if (!renderer) return
    const width = container.clientWidth || window.innerWidth
    const height = container.clientHeight || window.innerHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }

  private tick(): void {
    const { renderer, controls, scene, camera } = this
    if (!renderer) return

    controls?.update()
    renderer.render(scene, camera)

    this.frameCount += 1
    this.framesInWindow += 1
    const now = performance.now()
    const elapsed = now - this.fpsWindowStart
    if (elapsed >= 500) {
      this.fps = (this.framesInWindow * 1000) / elapsed
      this.framesInWindow = 0
      this.fpsWindowStart = now
    }
  }

  /** Stop the loop and release all GPU/DOM resources. Safe to call more than once. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.controls?.dispose()
    this.controls = null

    this.scene.traverse((object) => {
      const mesh = object as Partial<THREE.Mesh>
      mesh.geometry?.dispose()
      const material = mesh.material
      if (Array.isArray(material)) {
        for (const m of material) m.dispose()
      } else {
        material?.dispose()
      }
    })

    const renderer = this.renderer
    if (renderer) {
      renderer.setAnimationLoop(null)
      renderer.domElement.parentElement?.removeChild(renderer.domElement)
      renderer.dispose()
      this.renderer = null
    }
  }
}
