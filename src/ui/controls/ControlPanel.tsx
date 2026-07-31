import { hasRigidConstraints, isMolecularLevel } from "../../engine/scientificStatus";
import type { AccuracyLevel } from "../../engine/types";
import { ACCURACY_LEVELS } from "../../engine/types";
import { gpuSupportsConfig } from "../../render/drivers";
import { useAppStore } from "../../state/store";
import { Field, Segmented, Slider } from "./primitives";

const LEVEL_OPTIONS = (Object.keys(ACCURACY_LEVELS) as AccuracyLevel[]).map((id) => ({
  value: id,
  label: id,
  title: ACCURACY_LEVELS[id].description,
}));

export function ControlPanel() {
  const config = useAppStore((s) => s.config);
  const substeps = useAppStore((s) => s.substeps);
  const colorMode = useAppStore((s) => s.colorMode);
  const setColorMode = useAppStore((s) => s.setColorMode);
  const renderStyle = useAppStore((s) => s.renderStyle);
  const setRenderStyle = useAppStore((s) => s.setRenderStyle);

  const patchConfig = useAppStore((s) => s.patchConfig);
  const setLevel = useAppStore((s) => s.setLevel);
  const setEngineKind = useAppStore((s) => s.setEngineKind);
  const requestReset = useAppStore((s) => s.requestReset);
  const setSubsteps = useAppStore((s) => s.setSubsteps);

  const gpuOk = gpuSupportsConfig(config);
  const molecular = isMolecularLevel(config.level);
  const constrained = hasRigidConstraints(config.level);
  const setTemperature = (temperature: number) => {
    patchConfig({ temperature });
    // P64 containment: GPU temperature is constructor-bound, so rebuild instead of lying.
    if (config.engineKind === "gpu") requestReset();
  };

  return (
    <section className="panel">
      <h2 className="panel__title">Réglages</h2>
      <p className="panel__note">
        Modifier un réglage détache la configuration de sa scène : elle devient la vôtre.
      </p>

      <Field>
        <Segmented
          label="Moteur de calcul"
          value={config.engineKind}
          options={[
            {
              value: "cpu",
              label: "CPU",
              title: "Moteur de référence (Float64, déterministe)",
            },
            {
              value: "gpu",
              label: "GPU",
              title: gpuOk
                ? "WebGPU compute (rendu GPU-résident)"
                : "GPU non validé pour ce niveau ou ce barostat — repli sur l’oracle CPU",
              disabled: !gpuOk,
            },
          ]}
          onChange={(engineKind) => setEngineKind(engineKind)}
        />
        <Segmented
          label="Niveau de physique"
          value={config.level}
          options={LEVEL_OPTIONS}
          onChange={setLevel}
        />
        <Segmented
          label="Ensemble (thermostat)"
          value={config.thermostat}
          options={[
            {
              value: "none",
              label: "NVE",
              title: "Énergie constante (microcanonique)",
            },
            {
              value: "berendsen",
              label: "Berendsen",
              title: "NVT — couplage rapide",
            },
            {
              value: "csvr",
              label: "CSVR",
              title: "NVT — échantillonnage canonique correct",
            },
            {
              value: "langevin",
              label: "Langevin",
              title: constrained
                ? "Désactivé temporairement : la projection RATTLE après le bruit n'est pas certifiée"
                : "NVT stochastique — friction + bruit ⇒ mouvement brownien",
              disabled: constrained,
            },
          ]}
          onChange={(thermostat) => patchConfig({ thermostat })}
        />
        <Segmented
          label="Barostat (pression)"
          value={config.barostat}
          options={[
            {
              value: "none",
              label: "Volume fixe",
              title: "NVE / NVT (volume constant)",
            },
            {
              value: "berendsen",
              label: "NPT",
              title: molecular
                ? "Désactivé temporairement : le NPT moléculaire n'est pas certifié"
                : "Pression constante (Berendsen, CPU — équilibration)",
              disabled: molecular,
            },
          ]}
          onChange={(barostat) => patchConfig({ barostat })}
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
              title: "Parois réfléchissantes (CPU)",
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
        <Segmented
          label="Couleur des particules"
          value={colorMode}
          options={[
            { value: "species", label: "Espèce", title: "Couleur par espèce" },
            {
              value: "speed",
              label: "Vitesse",
              title: "Carte de vitesse (bleu lent → rouge rapide)",
            },
            {
              value: "coordination",
              label: "Structure",
              title: "Coordination locale : cœurs denses/ordonnés en chaud, surfaces/gaz en froid",
            },
          ]}
          onChange={setColorMode}
        />
        <Segmented
          label="Style de rendu"
          value={renderStyle}
          options={[
            {
              value: "spheres",
              label: "Sphères",
              title: "Sphères instanciées",
            },
            {
              value: "fluid",
              label: "Fluide",
              title: "Surface de fluide écran-espace (metaballs, CPU)",
            },
          ]}
          onChange={setRenderStyle}
        />
      </Field>

      <Field>
        <Slider
          label="Particules"
          value={config.particleCount}
          min={32}
          max={config.engineKind === "gpu" ? 20000 : 4000}
          step={1}
          onChange={(particleCount) => patchConfig({ particleCount })}
        />
        <Slider
          label={
            config.engineKind === "gpu"
              ? "Température cible (réinitialise GPU)"
              : "Température cible"
          }
          value={config.temperature}
          min={5}
          max={600}
          step={1}
          format={(v) => `${v.toFixed(0)} K`}
          onChange={setTemperature}
        />
        <Slider
          label="Pression cible (NPT)"
          value={config.pressureTarget}
          min={1}
          max={5000}
          step={10}
          format={(v) => `${v.toFixed(0)} bar`}
          disabled={config.barostat === "none"}
          onChange={(pressureTarget) => patchConfig({ pressureTarget })}
        />
        <Slider
          label="Gravité"
          value={config.gravity}
          min={0}
          max={0.3}
          step={0.005}
          format={(v) => (v === 0 ? "off" : v.toFixed(3))}
          onChange={(gravity) => patchConfig({ gravity })}
        />
        <Slider
          label="Champ électrique"
          value={config.electricField ?? 0}
          min={0}
          max={500}
          step={10}
          format={(v) => (v === 0 ? "off" : `${v.toFixed(0)} →`)}
          onChange={(electricField) => patchConfig({ electricField })}
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
