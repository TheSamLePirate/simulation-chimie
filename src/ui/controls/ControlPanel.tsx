import type { AccuracyLevel } from "../../engine/types";
import { ACCURACY_LEVELS } from "../../engine/types";
import { useAppStore } from "../../state/store";
import { Field, Segmented, Slider } from "./primitives";

const LEVEL_OPTIONS = (Object.keys(ACCURACY_LEVELS) as AccuracyLevel[]).map((id) => ({
  value: id,
  label: id,
  title: ACCURACY_LEVELS[id].description,
}));

export function ControlPanel() {
  const config = useAppStore((s) => s.config);
  const playing = useAppStore((s) => s.playing);
  const substeps = useAppStore((s) => s.substeps);

  const patchConfig = useAppStore((s) => s.patchConfig);
  const setLevel = useAppStore((s) => s.setLevel);
  const togglePlay = useAppStore((s) => s.togglePlay);
  const stepOnce = useAppStore((s) => s.stepOnce);
  const reset = useAppStore((s) => s.reset);
  const setSubsteps = useAppStore((s) => s.setSubsteps);

  return (
    <section className="panel">
      <h2 className="panel__title">Simulation</h2>

      <div className="playback">
        <button type="button" className="btn btn--primary" onClick={togglePlay}>
          {playing ? "⏸ Pause" : "▶ Lecture"}
        </button>
        <button type="button" className="btn" onClick={stepOnce} disabled={playing}>
          ⏭ Pas
        </button>
        <button type="button" className="btn" onClick={reset}>
          ↺ Réinitialiser
        </button>
      </div>

      <Field>
        <Segmented
          label="Niveau de physique"
          value={config.level}
          options={LEVEL_OPTIONS}
          onChange={setLevel}
        />
        <Segmented
          label="Bord de la cellule"
          value={config.boundary}
          options={[
            {
              value: "periodic",
              label: "Périodique",
              title: "Conditions aux limites périodiques",
            },
            {
              value: "reflective",
              label: "Parois",
              title: "Parois réfléchissantes",
            },
          ]}
          onChange={(boundary) => patchConfig({ boundary })}
        />
        <Segmented
          label="Espèce"
          value={config.speciesName}
          options={[
            { value: "ARGON", label: "Argon" },
            { value: "NEON", label: "Néon" },
          ]}
          onChange={(speciesName) => patchConfig({ speciesName })}
        />
      </Field>

      <Field>
        <Slider
          label="Particules"
          value={config.particleCount}
          min={32}
          max={1024}
          step={1}
          onChange={(particleCount) => patchConfig({ particleCount })}
        />
        <Slider
          label="Température cible"
          value={config.temperature}
          min={5}
          max={600}
          step={1}
          format={(v) => `${v.toFixed(0)} K`}
          onChange={(temperature) => patchConfig({ temperature })}
        />
        <Slider
          label="Taille de cellule"
          value={config.boxLength}
          min={2}
          max={10}
          step={0.1}
          format={(v) => `${v.toFixed(1)} nm`}
          onChange={(boxLength) => patchConfig({ boxLength })}
        />
        <Slider
          label="Pas de temps"
          value={config.timestep}
          min={0.001}
          max={0.01}
          step={0.001}
          format={(v) => `${(v * 1000).toFixed(0)} fs`}
          onChange={(timestep) => patchConfig({ timestep })}
        />
        <Slider
          label="Pas par image"
          value={substeps}
          min={1}
          max={20}
          step={1}
          onChange={setSubsteps}
        />
      </Field>
    </section>
  );
}
