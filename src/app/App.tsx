import { useEffect, useState } from "react";
import { appStore } from "../state/store";
import { CanvasHost } from "../ui/CanvasHost";
import { ControlPanel } from "../ui/controls/ControlPanel";
import { EngineStatusBadge } from "../ui/EngineStatusBadge";
import type { EngineStatus } from "../ui/engineStatus";
import { Exporter } from "../ui/export/Exporter";
import { GraphsPanel } from "../ui/graphs/GraphsPanel";
import { ObservablesPanel } from "../ui/panels/ObservablesPanel";
import { ScenePicker } from "../ui/scenes/ScenePicker";

export function App() {
  const [status, setStatus] = useState<EngineStatus>("initializing");

  // Keyboard shortcuts: Space = play/pause, R = reset, N = single step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const store = appStore.getState();
      if (e.code === "Space") {
        e.preventDefault();
        store.togglePlay();
      } else if (e.key === "r" || e.key === "R") {
        store.requestReset();
      } else if (e.key === "n" || e.key === "N") {
        store.requestStep();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <CanvasHost onStatus={setStatus} />

      <header className="app__header">
        <h1 className="app__title">Dynamique-Chimie</h1>
        <p className="app__subtitle">Simulateur de dynamique moléculaire — temps réel</p>
      </header>

      <aside className="sidebar">
        <ScenePicker />
        <ControlPanel />
        <ObservablesPanel />
        <GraphsPanel />
        <Exporter />
      </aside>

      <EngineStatusBadge status={status} />
    </div>
  );
}
