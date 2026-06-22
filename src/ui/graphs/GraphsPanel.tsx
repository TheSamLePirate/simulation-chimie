import { useEffect, useReducer, useRef } from "react";
import { useAppStore } from "../../state/store";
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
        series={[{ color: "#f59e0b", values: h.temperature }]}
        includeZero
        format={(v) => `${v.toFixed(1)} K`}
      />
      <TimeSeriesChart
        title="Énergies (kJ/mol)"
        series={[
          { color: "#22c55e", values: h.total },
          { color: "#3b82f6", values: h.kinetic },
          { color: "#ef4444", values: h.potential },
        ]}
        format={(v) => v.toFixed(1)}
      />
      <p className="chart__legend">
        <span style={{ color: "#22c55e" }}>● Totale</span>{" "}
        <span style={{ color: "#3b82f6" }}>● Cinétique</span>{" "}
        <span style={{ color: "#ef4444" }}>● Potentielle</span>
      </p>
      <TimeSeriesChart
        title="Pression (bar)"
        series={[{ color: "#a78bfa", values: h.pressure }]}
        includeZero
        format={(v) => `${v.toFixed(0)} bar`}
      />
    </section>
  );
}
