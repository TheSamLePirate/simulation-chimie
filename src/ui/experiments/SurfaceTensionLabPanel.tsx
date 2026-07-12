import { useEffect, useRef, useState } from "react";
import { iapwsSurfaceTension } from "../../core/observables/referenceSurfaceTension";
import { getActiveDriver } from "../../render/activeDriver";
import { useAppStore } from "../../state/store";
import { TimeSeriesChart } from "../graphs/TimeSeriesChart";
import { DensityProfileChart } from "./DensityProfileChart";

const HISTORY_CAPACITY = 180;

export function SurfaceTensionLabPanel() {
  const config = useAppStore((state) => state.config);
  const observables = useAppStore((state) => state.observables);
  const analysis = useAppStore((state) => state.surfaceTension);
  const playing = useAppStore((state) => state.playing);
  const togglePlay = useAppStore((state) => state.togglePlay);
  const setPlaying = useAppStore((state) => state.setPlaying);
  const requestStep = useAppStore((state) => state.requestStep);
  const requestReset = useAppStore((state) => state.requestReset);
  const patchConfig = useAppStore((state) => state.patchConfig);
  const setSubsteps = useAppStore((state) => state.setSubsteps);
  const publishSurfaceTension = useAppStore((state) => state.publishSurfaceTension);
  const temperatures = useRef<number[]>([]);
  const gammaHistory = useRef<number[]>([]);
  const [collecting, setCollecting] = useState(false);

  useEffect(() => {
    if (!observables || !Number.isFinite(observables.temperature)) return;
    temperatures.current.push(observables.temperature);
    if (temperatures.current.length > HISTORY_CAPACITY) temperatures.current.shift();
  }, [observables]);

  useEffect(() => {
    const gamma = analysis?.gammaMilliNewtonPerMeter;
    if (gamma == null || gammaHistory.current.at(-1) === gamma) return;
    gammaHistory.current.push(gamma);
  }, [analysis]);

  const time = observables?.time ?? 0;
  const equilibrationProgress = Math.min(1, time / 200);
  const production = time >= 200;
  const reference = iapwsSurfaceTension(config.temperature);
  const gamma = analysis?.gammaMilliNewtonPerMeter;
  const error = analysis?.standardErrorMilliNewtonPerMeter;
  const preview = config.particleCount < 1024;

  const collect = () => {
    setCollecting(true);
    window.setTimeout(() => {
      const next = getActiveDriver()?.collectSurfaceTensionSample(5e-4) ?? null;
      publishSurfaceTension(next);
      setCollecting(false);
    }, 0);
  };

  const loadSize = (molecules: 256 | 1024) => {
    setPlaying(false);
    setSubsteps(1);
    patchConfig({ particleCount: molecules, boxLength: molecules === 1024 ? 3.2 : 1.8 });
  };

  return (
    <section className="lab" data-testid="surface-tension-lab">
      <header className="lab-hero">
        <div>
          <p className="lab-hero__eyebrow">L11 · EXPÉRIENCE QUANTITATIVE</p>
          <h2 className="lab-hero__title">Interface eau ↔ vapeur</h2>
          <p className="lab-hero__copy">TIP4P/2005 · smooth PME · deux interfaces planes</p>
        </div>
        <span className={`lab-badge ${preview ? "lab-badge--preview" : "lab-badge--reference"}`}>
          {preview ? "APERÇU" : "ORACLE 1 024"}
        </span>
      </header>

      <div className="lab-toolbar">
        <button type="button" className="btn btn--primary" onClick={togglePlay}>
          {playing ? "Pause" : "Lancer"}
        </button>
        <button type="button" className="btn" onClick={requestStep} disabled={playing}>
          + 1 pas
        </button>
        <button type="button" className="btn" onClick={requestReset}>
          Repartir
        </button>
      </div>

      <fieldset className="lab-presets">
        <legend className="sr-only">Température de l’expérience</legend>
        {[280, 300, 320, 340].map((temperature) => (
          <button
            type="button"
            key={temperature}
            className="lab-preset"
            data-active={config.temperature === temperature || undefined}
            onClick={() => patchConfig({ temperature })}
          >
            {temperature} K
          </button>
        ))}
      </fieldset>

      <div className="lab-phase">
        <div className="lab-phase__head">
          <span>{production ? "Production" : "Équilibration"}</span>
          <span>{time.toFixed(2)} / 200 ps</span>
        </div>
        <div
          className="lab-phase__track"
          role="progressbar"
          aria-label="Progression de l’équilibration"
          aria-valuemin={0}
          aria-valuemax={200}
          aria-valuenow={Math.min(200, time)}
        >
          <span style={{ width: `${equilibrationProgress * 100}%` }} />
        </div>
        <p className="lab-phase__note">
          {production
            ? "Fenêtre de collecte ouverte · objectif 2–5 ns"
            : "Les mesures restent exploratoires avant 200 ps."}
        </p>
      </div>

      <dl className="lab-metrics">
        <div>
          <dt>Température</dt>
          <dd data-testid="lab-temperature">
            {observables ? `${observables.temperature.toFixed(1)} K` : "—"}
          </dd>
        </div>
        <div>
          <dt>γ test-area</dt>
          <dd>{gamma == null ? "—" : `${gamma.toFixed(2)} ± ${(error ?? 0).toFixed(2)}`}</dd>
          <small>mN·m⁻¹</small>
        </div>
        <div>
          <dt>γ mécanique</dt>
          <dd>
            {analysis?.mechanicalGammaMilliNewtonPerMeter == null
              ? "—"
              : `${analysis.mechanicalGammaMilliNewtonPerMeter.toFixed(2)} ± ${(analysis.mechanicalStandardErrorMilliNewtonPerMeter ?? 0).toFixed(2)}`}
          </dd>
          <small>
            {analysis?.routeDifferenceMilliNewtonPerMeter == null
              ? "dérivée de strain"
              : `écart ${analysis.routeDifferenceMilliNewtonPerMeter.toFixed(2)}`}
          </small>
        </div>
        <div>
          <dt>Référence IAPWS</dt>
          <dd>{reference.toFixed(2)}</dd>
          <small>mN·m⁻¹ à {config.temperature} K</small>
        </div>
      </dl>

      <div
        className="lab-equation"
        role="math"
        aria-label="Gamma égale delta F plus moins delta F moins, divisé par quatre delta A"
      >
        <span>γ</span>
        <strong>=</strong>
        <span className="lab-fraction">
          <span>ΔF₊ − ΔF₋</span>
          <span>4 δA</span>
        </span>
      </div>

      <div className="lab-chart-block">
        <div className="lab-section-head">
          <h3>Profil de densité ρ(z)</h3>
          <span>liquide · interfaces · vapeur</span>
        </div>
        <DensityProfileChart
          profile={analysis?.densityProfile ?? null}
          liquidThickness={analysis?.liquidThickness ?? null}
        />
      </div>

      <div className="lab-chart-grid">
        <TimeSeriesChart
          title="Température (K)"
          series={[{ color: "#38bdf8", values: temperatures.current }]}
          format={(value) => `${value.toFixed(1)} K`}
        />
        <TimeSeriesChart
          title="Convergence γ (mN/m)"
          series={[{ color: "#22c55e", values: gammaHistory.current }]}
          format={(value) => value.toFixed(2)}
        />
      </div>

      <div className="lab-sampling">
        <div>
          <strong data-testid="lab-sample-count">
            {analysis?.sampleCount ?? 0} configurations
          </strong>
          <span>εA = 5×10⁻⁴ · moyenne exponentielle</span>
        </div>
        <button type="button" className="btn" onClick={collect} disabled={collecting}>
          {collecting ? "Calcul ΔU±…" : "Échantillon exploratoire"}
        </button>
      </div>

      <div className="lab-size-switch">
        <button type="button" onClick={() => loadSize(256)} data-active={preview || undefined}>
          <strong>256</strong>
          <span>Aperçu réduit</span>
        </button>
        <button type="button" onClick={() => loadSize(1024)} data-active={!preview || undefined}>
          <strong>1 024</strong>
          <span>Oracle CPU lent</span>
        </button>
      </div>

      <p className="lab-integrity">
        Une valeur publiable exige 5 graines, 2–5 ns, blocs de 100–200 ps et convergence 512/1 024/2
        048.
      </p>
    </section>
  );
}
