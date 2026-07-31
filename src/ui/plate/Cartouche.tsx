import {
  SCIENTIFIC_STATUS_BY_LEVEL,
  SCIENTIFIC_STATUS_LABELS,
} from "../../engine/scientificStatus";
import { ACCURACY_LEVELS } from "../../engine/types";
import { useAppStore } from "../../state/store";

const THERMOSTAT_LABELS: Record<string, string> = {
  berendsen: "Thermostat Berendsen",
  csvr: "Thermostat CSVR",
  langevin: "Thermostat Langevin (brownien)",
};

/**
 * The plate's legend: which rung of the ladder is running, which force terms are switched
 * on, and whether the result is a validated reference or a preview. Reads as the caption
 * of an engraved figure, and is the one place the physics is stated in full.
 */
export function Cartouche() {
  const config = useAppStore((s) => s.config);
  const { level, thermostat, barostat, gravity, electricField } = config;

  const levelInfo = ACCURACY_LEVELS[level];
  const status = SCIENTIFIC_STATUS_BY_LEVEL[level];
  const title = levelInfo.label.replace(/^L\d+\s·\s/, "");

  const forces: string[] = [...levelInfo.forces];
  if (gravity > 0) forces.push("Gravité (−y)");
  if (electricField) forces.push("Champ électrique (+x)");
  const thermostatLabel = THERMOSTAT_LABELS[thermostat];
  if (thermostatLabel) forces.push(thermostatLabel);
  if (barostat === "berendsen") forces.push("Barostat Berendsen (NPT)");

  return (
    <div className="cartouche">
      <div className="cartouche__head">
        <span className="cartouche__level">{level}</span>
        <h2 className="cartouche__title">{title}</h2>
      </div>
      <ul className="cartouche__forces" data-testid="physics-forces">
        {forces.map((force) => (
          <li className="cartouche__force" key={force}>
            {force}
          </li>
        ))}
      </ul>
      <p className="stamp" data-status={status} data-testid="scientific-status">
        {SCIENTIFIC_STATUS_LABELS[status]}
      </p>
    </div>
  );
}
