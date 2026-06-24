import { SCENES } from "../../scenes/registry";
import { useAppStore } from "../../state/store";

/** Gallery of ready-made scenes; selecting one loads its full config and plays. */
export function ScenePicker() {
  const patchConfig = useAppStore((s) => s.patchConfig);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const setColorMode = useAppStore((s) => s.setColorMode);
  const activeSeed = useAppStore((s) => s.config.seed);
  const activeSpecies = useAppStore((s) => s.config.speciesName);

  return (
    <section className="panel">
      <h2 className="panel__title">Scènes</h2>
      <div className="scenes">
        {SCENES.map((scene) => {
          const active =
            scene.config.speciesName === activeSpecies && scene.config.seed === activeSeed;
          return (
            <button
              key={scene.id}
              type="button"
              className="scene-btn"
              data-active={active ? "true" : undefined}
              title={scene.description}
              onClick={() => {
                patchConfig(scene.config);
                setColorMode(scene.colorMode ?? "species");
                setPlaying(true);
              }}
            >
              {scene.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
