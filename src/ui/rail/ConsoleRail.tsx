import { useId, useState } from "react";
import { useAppStore } from "../../state/store";
import { ControlPanel } from "../controls/ControlPanel";
import { EngineStatusBadge } from "../EngineStatusBadge";
import type { EngineStatus } from "../engineStatus";
import { SurfaceTensionLabPanel } from "../experiments/SurfaceTensionLabPanel";
import { Exporter } from "../export/Exporter";
import { ScenePicker } from "../scenes/ScenePicker";

type TabId = "lab" | "scenes" | "settings" | "files";

const TAB_LABELS: Record<TabId, string> = {
  lab: "Laboratoire",
  scenes: "Scènes",
  settings: "Réglages",
  files: "Fichier",
};

interface ConsoleRailProps {
  status: EngineStatus;
  /** L11 puts its own instrument in the console and leads with it. */
  lab: boolean;
}

/**
 * The console. Tabs rather than one endless column: you pick an experiment, then you tune
 * it, then you save it — never all three at once. Live measurements stay on the plate, so
 * they remain visible while you turn a knob in here.
 *
 * Remounted (via `key`) when the lab opens or closes, so the leading tab is always the one
 * that matches what is loaded.
 */
export function ConsoleRail({ status, lab }: ConsoleRailProps) {
  const tabs: TabId[] = lab ? ["lab", "scenes", "files"] : ["scenes", "settings", "files"];
  const [tab, setTab] = useState<TabId>(tabs[0] as TabId);
  const engineKind = useAppStore((s) => s.config.engineKind);
  const panelId = useId();

  return (
    <aside className="rail">
      <div className="rail__head">
        <h2>Régie</h2>
        <hr />
      </div>

      <div className="tabs" role="tablist" aria-label="Sections de la régie">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${panelId}-tab-${id}`}
            className="tab"
            aria-selected={tab === id}
            aria-controls={`${panelId}-panel`}
            onClick={() => setTab(id)}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      <div
        className="rail__body"
        id={`${panelId}-panel`}
        role="tabpanel"
        aria-labelledby={`${panelId}-tab-${tab}`}
      >
        {tab === "lab" && <SurfaceTensionLabPanel />}
        {tab === "scenes" && <ScenePicker />}
        {tab === "settings" && <ControlPanel />}
        {tab === "files" && <Exporter />}
      </div>

      <div className="rail__foot">
        <EngineStatusBadge status={status} />
        <span className="rail__engine">{engineKind === "gpu" ? "Moteur GPU" : "Moteur CPU"}</span>
        {/* The atlas is published beside the app; BASE_URL keeps the sub-path right on Pages. */}
        <a
          className="rail__atlas"
          href={`${import.meta.env.BASE_URL}doc/`}
          target="_blank"
          rel="noreferrer"
        >
          Atlas ↗
        </a>
      </div>
    </aside>
  );
}
