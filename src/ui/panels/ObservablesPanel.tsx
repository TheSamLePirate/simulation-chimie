import { useState } from "react";
import { energyUnavailableReason, pressureUnavailableReason } from "../../engine/scientificStatus";
import { useAppStore } from "../../state/store";
import { GraphsPanel } from "../graphs/GraphsPanel";

interface Metric {
  id: string;
  label: string;
  value: string;
  note?: string | undefined;
}

/**
 * The readout, engraved on the plate rather than filed away in the console: the numbers
 * stay in view while you work the controls. A value the level cannot honestly report is
 * marked "n/d" and carries the reason.
 */
export function ObservablesPanel() {
  const observables = useAppStore((s) => s.observables);
  const fps = useAppStore((s) => s.fps);
  const demixing = useAppStore((s) => s.demixing);
  const config = useAppStore((s) => s.config);
  const { particleCount } = config;

  const [instrumentsOpen, setInstrumentsOpen] = useState(false);

  const pressureReason = pressureUnavailableReason(config);
  const energyReason = energyUnavailableReason(config);

  const metrics: Metric[] = [
    {
      id: "temperature",
      label: "Température",
      value: observables ? `${observables.temperature.toFixed(1)} K` : "—",
    },
    {
      id: "pressure",
      label: "Pression",
      value: pressureReason ? "n/d" : observables ? `${observables.pressure.toFixed(0)} bar` : "—",
      note: pressureReason ?? undefined,
    },
    {
      id: "demix",
      label: "Démixtion",
      value: demixing != null ? demixing.toFixed(2) : "—",
    },
    {
      id: "total",
      label: "É. totale",
      value: energyReason ? "n/d" : observables ? observables.totalEnergy.toFixed(1) : "—",
      note: energyReason ?? undefined,
    },
    {
      id: "ke",
      label: "É. cinétique",
      value: observables ? observables.kineticEnergy.toFixed(1) : "—",
    },
    {
      id: "pe",
      label: "É. potentielle",
      value: energyReason ? "n/d" : observables ? observables.potentialEnergy.toFixed(1) : "—",
      note: energyReason ?? undefined,
    },
    {
      id: "time",
      label: "Temps",
      value: observables ? `${observables.time.toFixed(2)} ps` : "—",
    },
    {
      id: "step",
      label: "Pas",
      value: observables ? String(observables.step) : "—",
    },
    { id: "count", label: "Particules", value: String(particleCount) },
  ];

  // One footnote per distinct reason, naming every metric it silences.
  const caveats = metrics.reduce<Array<{ note: string; labels: string[] }>>((acc, metric) => {
    if (!metric.note) return acc;
    const existing = acc.find((entry) => entry.note === metric.note);
    if (existing) existing.labels.push(metric.label);
    else acc.push({ note: metric.note, labels: [metric.label] });
    return acc;
  }, []);

  return (
    <section className="readout">
      <div className="readout__head">
        <h2>Relevé</h2>
        <hr />
        {/* Frame rate is instrument health, not a measurement — it sits with the heading. */}
        <span className="readout__fps" data-testid="metric-fps">
          {fps.toFixed(0)} FPS
        </span>
      </div>

      <dl className="metrics">
        {metrics.map((m) => (
          <div className="metric" key={m.id} data-unavailable={m.note ? "true" : undefined}>
            <dt className="metric__label">{m.label}</dt>
            <dd className="metric__value" data-testid={`metric-${m.id}`} title={m.note}>
              {m.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Reasons live under the grid, not inside it: a cell that grows to hold a sentence
          drags every other cell in its row out of alignment. */}
      {caveats.length > 0 && (
        <ul className="readout__caveats">
          {caveats.map(({ labels, note }) => (
            <li key={note}>
              <b>{labels.join(" · ")}</b> {note}
            </li>
          ))}
        </ul>
      )}

      {/*
        Mounted only while open. Left in the tree, the charts kept sampling and repainting
        five canvases every frame behind a closed drawer — enough to starve the main thread
        while the simulation itself was already using it.
      */}
      <details
        className="instruments"
        open={instrumentsOpen}
        onToggle={(e) => setInstrumentsOpen(e.currentTarget.open)}
      >
        <summary>Instruments</summary>
        {instrumentsOpen && (
          <div className="instruments__body">
            <GraphsPanel />
          </div>
        )}
      </details>
    </section>
  );
}
