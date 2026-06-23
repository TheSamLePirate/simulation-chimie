import { useState } from "react";
import { CanvasHost } from "../ui/CanvasHost";
import { ControlPanel } from "../ui/controls/ControlPanel";
import { EngineStatusBadge } from "../ui/EngineStatusBadge";
import type { EngineStatus } from "../ui/engineStatus";
import { GraphsPanel } from "../ui/graphs/GraphsPanel";
import { ObservablesPanel } from "../ui/panels/ObservablesPanel";
import { ScenePicker } from "../ui/scenes/ScenePicker";

export function App() {
  const [status, setStatus] = useState<EngineStatus>("initializing");

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
      </aside>

      <EngineStatusBadge status={status} />
    </div>
  );
}
