/**
 * Synchronous capability probe: is the WebGPU API surface present at all?
 * A `true` result does not guarantee a usable adapter (see {@link requestAdapterOk}).
 */
export function isWebGPUAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * Asynchronous probe: can we actually acquire a GPU adapter? This is the
 * authoritative check, since a browser may expose `navigator.gpu` yet fail to
 * provide an adapter (headless environments, blocked GPUs, software fallback off).
 */
export async function requestAdapterOk(): Promise<boolean> {
  if (!isWebGPUAvailable()) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}
