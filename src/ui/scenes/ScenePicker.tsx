import type { AccuracyLevel } from "../../engine/types";
import { ACCURACY_LEVELS } from "../../engine/types";
import { SCENES, type Scene } from "../../scenes/registry";
import { useAppStore } from "../../state/store";

const LEVEL_ORDER = Object.keys(ACCURACY_LEVELS) as AccuracyLevel[];

interface Rung {
  level: AccuracyLevel;
  scenes: Scene[];
}

/**
 * The accuracy ladder. Each rung is one level of the model — one more force term switched
 * on — and the scenes hanging off it are what that force makes possible. Ordered, because
 * the order is the physics: there is no demixing before Lennard-Jones.
 */
function buildLadder(): Rung[] {
  const byLevel = new Map<AccuracyLevel, Scene[]>();
  for (const scene of SCENES) {
    const bucket = byLevel.get(scene.config.level);
    if (bucket) bucket.push(scene);
    else byLevel.set(scene.config.level, [scene]);
  }
  return LEVEL_ORDER.filter((level) => byLevel.has(level)).map((level) => ({
    level,
    scenes: byLevel.get(level) ?? [],
  }));
}

const LADDER = buildLadder();

export function ScenePicker() {
  const replaceConfig = useAppStore((s) => s.replaceConfig);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const setColorMode = useAppStore((s) => s.setColorMode);
  const setSubsteps = useAppStore((s) => s.setSubsteps);
  const activeSceneId = useAppStore((s) => s.activeSceneId);
  const activeLevel = useAppStore((s) => s.config.level);

  return (
    <section className="panel">
      <h2 className="panel__title">L’échelle des interactions</h2>
      <p className="panel__note">
        Chaque échelon allume une force de plus. Choisissez une expérience : elle installe une
        configuration complète et démarre.
      </p>
      <ol className="ladder">
        {LADDER.map((rung) => (
          <li
            className="rung"
            key={rung.level}
            data-active={rung.level === activeLevel ? "true" : undefined}
          >
            <span className="rung__level" title={ACCURACY_LEVELS[rung.level].label}>
              {rung.level}
            </span>
            <div className="rung__scenes">
              {rung.scenes.map((scene) => (
                <button
                  key={scene.id}
                  type="button"
                  className="scene-btn"
                  // The blurb is described, not named: an accessible name is a label, and
                  // folding a paragraph into it makes every scene match every other one.
                  aria-label={scene.label}
                  aria-describedby={`scene-note-${scene.id}`}
                  aria-current={scene.id === activeSceneId ? "true" : undefined}
                  onClick={() => {
                    // A scene is a complete config: replace, so nothing leaks from the previous one.
                    replaceConfig(scene.config, scene.id);
                    setColorMode(scene.colorMode ?? "species");
                    if (scene.substeps) setSubsteps(scene.substeps);
                    setPlaying(true);
                  }}
                >
                  <strong>{scene.label}</strong>
                  <span id={`scene-note-${scene.id}`}>{scene.description}</span>
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
