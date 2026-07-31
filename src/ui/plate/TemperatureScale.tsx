import { useAppStore } from "../../state/store";

/**
 * The master scale across the top of the plate: measured temperature read against the
 * setpoint. Half-scale is the setpoint, so "on target" is a landmark you can see rather
 * than a number you have to compare — and the colour says which way it is drifting.
 */
export function TemperatureScale() {
  const target = useAppStore((s) => s.config.temperature);
  const measured = useAppStore((s) => s.observables?.temperature ?? null);

  const ratio = measured == null || target <= 0 ? 0 : measured / target;
  const fill = Math.min(1, Math.max(0, ratio / 2));
  const state = measured == null ? "idle" : ratio > 1.1 ? "hot" : ratio < 0.9 ? "cold" : "onTarget";

  return (
    // biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot carry the setpoint notch or the drift colouring; the role exposes the same semantics to assistive tech.
    <div
      className="thread"
      data-state={state}
      role="meter"
      aria-label="Température mesurée rapportée à la consigne"
      aria-valuemin={0}
      aria-valuemax={2 * target}
      aria-valuenow={measured ?? 0}
      aria-valuetext={measured == null ? "en attente" : `${measured.toFixed(1)} K sur ${target} K`}
    >
      <div className="thread__fill" style={{ width: `${fill * 100}%` }} />
      <span className="thread__notch" data-label={`consigne ${target} K`} />
    </div>
  );
}
