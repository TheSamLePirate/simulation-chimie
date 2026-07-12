import { ACCURACY_LEVELS } from "../../engine/types";
import { useAppStore } from "../../state/store";

interface Metric {
  id: string;
  label: string;
  value: string;
}

const THERMOSTAT_LABELS: Record<string, string> = {
  berendsen: "Thermostat Berendsen",
  csvr: "Thermostat CSVR",
  langevin: "Thermostat Langevin (brownien)",
};

export function ObservablesPanel() {
  const observables = useAppStore((s) => s.observables);
  const fps = useAppStore((s) => s.fps);
  const demixing = useAppStore((s) => s.demixing);
  const particleCount = useAppStore((s) => s.config.particleCount);
  const level = useAppStore((s) => s.config.level);
  const thermostat = useAppStore((s) => s.config.thermostat);
  const barostat = useAppStore((s) => s.config.barostat);
  const gravity = useAppStore((s) => s.config.gravity);
  const electricField = useAppStore((s) => s.config.electricField);

  // Forces intrinsèques au niveau + champs/ensembles actifs dans la config courante.
  const levelInfo = ACCURACY_LEVELS[level];
  const forces: string[] = [...levelInfo.forces];
  if (gravity > 0) forces.push("Gravité (−y)");
  if (electricField) forces.push("Champ électrique (+x)");
  const thermostatLabel = THERMOSTAT_LABELS[thermostat];
  if (thermostatLabel) forces.push(thermostatLabel);
  if (barostat === "berendsen") forces.push("Barostat Berendsen (NPT)");

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
      <div className="physics">
        <h3 className="physics__title">Physique · {levelInfo.label}</h3>
        <ul className="physics__forces" data-testid="physics-forces">
          {forces.map((f) => (
            <li className="physics__force" key={f}>
              {f}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
