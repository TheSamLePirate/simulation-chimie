import { useRef, useState } from "react";
import { getActiveDriver } from "../../render/activeDriver";
import {
  describeConfigError,
  exportConfigEnvelope,
  parseConfigEnvelope,
} from "../../state/canonicalConfig";
import { useAppStore } from "../../state/store";
import { downloadJSON, downloadText, rdfToCsv } from "./download";

/**
 * Save / load and export panel — the practical "edit mode": a scene is fully described
 * by its serialisable, Zod-validated config. Also exports a CPU state snapshot and g(r).
 * Exact stochastic snapshot continuation and snapshot import are delivered by AAA P70.
 */
export function Exporter() {
  const config = useAppStore((s) => s.config);
  const rdf = useAppStore((s) => s.rdf);
  const replaceConfig = useAppStore((s) => s.replaceConfig);
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>("");

  const exportConfig = () => downloadJSON("scene-config.json", exportConfigEnvelope(config));

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
      // Replace, never merge: a merged import would inherit optional fields (electric field,
      // clump start…) from whatever scene happened to be loaded.
      const parsed = parseConfigEnvelope(JSON.parse(await file.text()));
      replaceConfig(parsed);
      setMessage("Config importée.");
    } catch (error) {
      setMessage(`Import refusé : ${describeConfigError(error)}`);
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
