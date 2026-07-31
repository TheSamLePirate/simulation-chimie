import { useAppStore } from "../../state/store";

/**
 * Playback lives on the plate, not in the console: it stays reachable whichever console
 * tab is open, and it is the one control you touch on every single run.
 */
export function TransportDock() {
  const playing = useAppStore((s) => s.playing);
  const togglePlay = useAppStore((s) => s.togglePlay);
  const requestStep = useAppStore((s) => s.requestStep);
  const requestReset = useAppStore((s) => s.requestReset);

  return (
    <div className="dock">
      <div className="dock__inner">
        <button type="button" className="btn btn--primary" onClick={togglePlay}>
          {playing ? "Pause" : "Lecture"}
        </button>
        <button type="button" className="btn" onClick={requestStep} disabled={playing}>
          Pas
        </button>
        <button type="button" className="btn" onClick={requestReset}>
          Réinitialiser
        </button>
        <p className="dock__hint">
          <kbd>Espace</kbd>&nbsp;·&nbsp;<kbd>N</kbd>&nbsp;·&nbsp;<kbd>R</kbd>
        </p>
      </div>
    </div>
  );
}
