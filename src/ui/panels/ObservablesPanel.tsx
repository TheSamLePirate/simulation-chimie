import { useAppStore } from "../../state/store";

interface Metric {
  id: string;
  label: string;
  value: string;
}

export function ObservablesPanel() {
  const observables = useAppStore((s) => s.observables);
  const fps = useAppStore((s) => s.fps);
  const demixing = useAppStore((s) => s.demixing);
  const particleCount = useAppStore((s) => s.config.particleCount);

  const metrics: Metric[] = [
    { id: "fps", label: "FPS", value: fps.toFixed(0) },
    { id: "count", label: "Particules", value: String(particleCount) },
    {
      id: "step",
      label: "Pas",
      value: observables ? String(observables.step) : "—",
    },
    {
      id: "time",
      label: "Temps",
      value: observables ? `${observables.time.toFixed(2)} ps` : "—",
    },
    {
      id: "temperature",
      label: "Température",
      value: observables ? `${observables.temperature.toFixed(1)} K` : "—",
    },
    {
      id: "pressure",
      label: "Pression",
      value: observables ? `${observables.pressure.toFixed(0)} bar` : "—",
    },
    {
      id: "ke",
      label: "É. cinétique",
      value: observables ? `${observables.kineticEnergy.toFixed(1)} kJ/mol` : "—",
    },
    {
      id: "pe",
      label: "É. potentielle",
      value: observables ? `${observables.potentialEnergy.toFixed(1)} kJ/mol` : "—",
    },
    {
      id: "total",
      label: "É. totale",
      value: observables ? `${observables.totalEnergy.toFixed(1)} kJ/mol` : "—",
    },
    {
      id: "demix",
      label: "Démixtion",
      value: demixing != null ? demixing.toFixed(2) : "—",
    },
  ];

  return (
    <section className="panel">
      <h2 className="panel__title">État</h2>
      <dl className="metrics">
        {metrics.map((m) => (
          <div className="metric" key={m.id}>
            <dt className="metric__label">{m.label}</dt>
            <dd className="metric__value" data-testid={`metric-${m.id}`}>
              {m.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
