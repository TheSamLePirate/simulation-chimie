import { useEffect, useState } from "react";
import { appStore, useAppStore } from "../state/store";
import { CanvasHost } from "../ui/CanvasHost";
import type { EngineStatus } from "../ui/engineStatus";
import { ObservablesPanel } from "../ui/panels/ObservablesPanel";
import { Masthead } from "../ui/plate/Masthead";
import { TemperatureScale } from "../ui/plate/TemperatureScale";
import { TransportDock } from "../ui/plate/TransportDock";
import { ConsoleRail } from "../ui/rail/ConsoleRail";

export function App() {
  const [status, setStatus] = useState<EngineStatus>("initializing");
  const isSurfaceTensionLab = useAppStore((state) => state.config.level === "L11");

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
    <div className={`app${isSurfaceTensionLab ? " app--lab" : ""}`}>
      <CanvasHost onStatus={setStatus} />
      <div className="atmos" aria-hidden="true" />

      <TemperatureScale />
      <Masthead />
      <ObservablesPanel />
      <TransportDock />

      <ConsoleRail
        key={isSurfaceTensionLab ? "lab" : "standard"}
        status={status}
        lab={isSurfaceTensionLab}
      />

      <div className="frame" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
