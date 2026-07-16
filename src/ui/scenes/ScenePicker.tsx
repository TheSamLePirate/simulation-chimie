import { SCENES } from "../../scenes/registry";
import { useAppStore } from "../../state/store";

/** Gallery of ready-made scenes; selecting one loads its full config and plays. */
export function ScenePicker() {
  const replaceConfig = useAppStore((s) => s.replaceConfig);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const setColorMode = useAppStore((s) => s.setColorMode);
  const setSubsteps = useAppStore((s) => s.setSubsteps);
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
                // A scene is a complete config: replace, so nothing leaks from the previous one.
                replaceConfig(scene.config);
                setColorMode(scene.colorMode ?? "species");
                if (scene.substeps) setSubsteps(scene.substeps);
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
