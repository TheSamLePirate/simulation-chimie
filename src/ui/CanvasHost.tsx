import { useEffect, useRef } from "react";
import { SimulationView } from "../render/SimulationView";
import { isWebGPUAvailable } from "../render/webgpu";
import type { EngineStatus } from "./engineStatus";

interface CanvasHostProps {
  onStatus: (status: EngineStatus) => void;
}

/**
 * Mounts the imperative {@link SimulationView} into a DOM container and reports engine
 * lifecycle. Tolerant of React StrictMode's double-mount: a view created during a
 * cancelled mount is disposed.
 */
export function CanvasHost({ onStatus }: CanvasHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  useEffect(() => {
    const report = (status: EngineStatus) => onStatusRef.current(status);

    if (!isWebGPUAvailable()) {
      report("unsupported");
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const view = new SimulationView(container);
    let cancelled = false;
    report("initializing");

    view
      .init()
      .then(() => {
        if (cancelled) {
          view.dispose();
          return;
        }
        report("running");
      })
      .catch((error: unknown) => {
        console.error("Échec d’initialisation WebGPU", error);
        view.dispose();
        if (!cancelled) report("error");
      });

    return () => {
      cancelled = true;
      view.dispose();
    };
  }, []);

  return <div ref={containerRef} className="canvas-host" />;
}
