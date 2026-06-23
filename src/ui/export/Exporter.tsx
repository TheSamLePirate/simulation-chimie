import { useRef, useState } from "react";
import { getActiveDriver } from "../../render/activeDriver";
import { parseConfig } from "../../state/schema";
import { useAppStore } from "../../state/store";
import { downloadJSON, downloadText, rdfToCsv } from "./download";

/**
 * Save / load and export panel — the practical "edit mode": a scene is fully described
 * by its (serialisable, Zod-validated) config, so exporting/importing it round-trips a
 * scene. Also exports a full state snapshot and the g(r) data (CPU mode).
 */
export function Exporter() {
  const config = useAppStore((s) => s.config);
  const rdf = useAppStore((s) => s.rdf);
  const patchConfig = useAppStore((s) => s.patchConfig);
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>("");

  const exportConfig = () => downloadJSON("scene-config.json", config);

  const exportSnapshot = () => {
    const snapshot = getActiveDriver()?.snapshot();
    if (!snapshot) {
      setMessage("Instantané indisponible (mode GPU).");
      return;
    }
    downloadJSON("snapshot.json", snapshot);
    setMessage("Instantané exporté.");
  };

  const exportRdf = () => {
    if (!rdf) {
      setMessage("g(r) indisponible (mode GPU).");
      return;
    }
    downloadText("rdf.csv", rdfToCsv(rdf), "text/csv");
    setMessage("g(r) exporté (CSV).");
  };

  const onImportFile = async (file: File) => {
    try {
      const parsed = parseConfig(JSON.parse(await file.text()));
      patchConfig(parsed);
      setMessage("Config importée.");
    } catch (error) {
      setMessage(`Import invalide : ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <section className="panel">
      <h2 className="panel__title">Sauvegarde / Export</h2>
      <div className="export">
        <button type="button" className="btn" onClick={exportConfig}>
          ⬇ Config
        </button>
        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
          ⬆ Importer
        </button>
        <button type="button" className="btn" onClick={exportSnapshot}>
          ⬇ Instantané
        </button>
        <button type="button" className="btn" onClick={exportRdf}>
          ⬇ g(r) CSV
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onImportFile(file);
          e.target.value = "";
        }}
      />
      {message && <p className="export__msg">{message}</p>}
    </section>
  );
}
