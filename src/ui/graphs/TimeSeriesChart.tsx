import { useEffect, useRef } from "react";

export interface ChartSeries {
  color: string;
  values: number[];
}

interface TimeSeriesChartProps {
  title: string;
  series: ChartSeries[];
  height?: number;
  /** Force the y-axis to include zero. */
  includeZero?: boolean;
  /** Optional formatter for the latest-value readout. */
  format?: (value: number) => string;
}

/**
 * Dependency-free real-time line chart drawn straight to a canvas from rolling
 * arrays. All series share the same x-index; the y-range auto-fits the data.
 */
export function TimeSeriesChart({
  title,
  series,
  height = 96,
  includeZero,
  format,
}: TimeSeriesChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let maxLen = 0;
    for (const s of series) {
      maxLen = Math.max(maxLen, s.values.length);
      for (const v of s.values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    if (includeZero) {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    }
    if (max - min < 1e-9) {
      max += 1;
      min -= 1;
    }
    const pad = (max - min) * 0.1;
    min -= pad;
    max += pad;

    const padX = 4;
    const padY = 6;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;
    const toX = (i: number) => padX + (maxLen <= 1 ? 0 : (i / (maxLen - 1)) * plotW);
    const toY = (v: number) => padY + plotH - ((v - min) / (max - min)) * plotH;

    for (const s of series) {
      if (s.values.length === 0) continue;
      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = s.color;
      s.values.forEach((v, i) => {
        const x = toX(i);
        const y = toY(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [series, height, includeZero]);

  const latest = series[0]?.values.at(-1);
  return (
    <div className="chart">
      <div className="chart__head">
        <span className="chart__title">{title}</span>
        {latest !== undefined && (
          <span className="chart__latest">{format ? format(latest) : latest.toFixed(2)}</span>
        )}
      </div>
      <canvas ref={canvasRef} className="chart__canvas" style={{ height }} />
    </div>
  );
}
