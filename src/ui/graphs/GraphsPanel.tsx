import { useEffect, useReducer, useRef } from "react";
import { useAppStore } from "../../state/store";
import { HistogramChart } from "./HistogramChart";
import { TimeSeriesChart } from "./TimeSeriesChart";

const CAPACITY = 240;

interface History {
  temperature: number[];
  kinetic: number[];
  potential: number[];
  total: number[];
  pressure: number[];
}

function pushCapped(array: number[], value: number): void {
  array.push(value);
  if (array.length > CAPACITY) array.shift();
}

/** Rolling real-time charts of the key observables. */
export function GraphsPanel() {
  const observables = useAppStore((s) => s.observables);
  const rdf = useAppStore((s) => s.rdf);
  const speeds = useAppStore((s) => s.speeds);
  const historyRef = useRef<History>({
    temperature: [],
    kinetic: [],
    potential: [],
    total: [],
    pressure: [],
  });
  const [, redraw] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!observables) return;
    const h = historyRef.current;
    pushCapped(h.temperature, observables.temperature);
    pushCapped(h.kinetic, observables.kineticEnergy);
    pushCapped(h.potential, observables.potentialEnergy);
    pushCapped(h.total, observables.totalEnergy);
    pushCapped(h.pressure, observables.pressure);
    redraw();
  }, [observables]);

  const h = historyRef.current;

  return (
    <section className="panel">
      <h2 className="panel__title">Mesures en temps réel</h2>
      <TimeSeriesChart
        title="Température (K)"
        series={[{ color: "#f3d98a", values: h.temperature }]}
        includeZero
        format={(v) => `${v.toFixed(1)} K`}
      />
      <TimeSeriesChart
        title="Énergies (kJ/mol)"
        series={[
          { color: "#e7dcc1", values: h.total },
          { color: "#d6ac55", values: h.kinetic },
          { color: "#6fc7bb", values: h.potential },
        ]}
        format={(v) => v.toFixed(1)}
      />
      <p className="chart__legend">
        <span style={{ color: "#e7dcc1" }}>● Totale</span>{" "}
        <span style={{ color: "#d6ac55" }}>● Cinétique</span>{" "}
        <span style={{ color: "#6fc7bb" }}>● Potentielle</span>
      </p>
      <TimeSeriesChart
        title="Pression (bar)"
        series={[{ color: "#e08a5f", values: h.pressure }]}
        includeZero
        format={(v) => `${v.toFixed(0)} bar`}
      />
      {speeds && speeds.v.length > 0 && (
        <>
          <HistogramChart
            title="Distribution des vitesses |v| (nm/ps)"
            x={speeds.v}
            density={speeds.density}
            theory={speeds.theory}
            readout={`⟨|v|⟩ ${speeds.meanSpeed.toFixed(2)} nm/ps`}
          />
          <p className="chart__legend">
            <span style={{ color: "#d6ac55" }}>■ Mesurée</span>{" "}
            <span style={{ color: "#6fc7bb" }}>— Maxwell-Boltzmann (T courante)</span>
          </p>
        </>
      )}
      {rdf && rdf.g.length > 0 && (
        <TimeSeriesChart
          title="g(r) — structure (× r croissant)"
          series={[{ color: "#e7dcc1", values: rdf.g }]}
          includeZero
          format={(v) => v.toFixed(2)}
        />
      )}
    </section>
  );
}
