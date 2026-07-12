import { useEffect, useRef } from "react";

interface HistogramChartProps {
  title: string;
  /** Bin-centre x values (uniform spacing). */
  x: number[];
  /** Observed density per bin (drawn as bars). */
  density: number[];
  /** Optional analytic curve on the same bins (drawn as a line). */
  theory?: number[];
  /** Right-hand readout, e.g. the mean value. */
  readout?: string;
  height?: number;
  barColor?: string;
  lineColor?: string;
}

/**
 * Dependency-free histogram (bars) with an optional analytic overlay (line),
 * drawn straight to a canvas — same conventions as TimeSeriesChart.
 */
export function HistogramChart({
  title,
  x,
  density,
  theory,
  readout,
  height = 96,
  barColor = "#38bdf8",
  lineColor = "#f59e0b",
}: HistogramChartProps) {
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

    const bins = x.length;
    if (bins === 0) return;
    let max = 0;
    for (const f of density) max = Math.max(max, f);
    if (theory) for (const f of theory) max = Math.max(max, f);
    if (max <= 0) return;
    max *= 1.1;

    const padX = 4;
    const padY = 6;
    const plotW = width - padX * 2;
    const plotH = height - padY * 2;
    const barW = plotW / bins;
    const toY = (f: number) => padY + plotH - (f / max) * plotH;

    ctx.fillStyle = barColor;
    ctx.globalAlpha = 0.55;
    for (let b = 0; b < bins; b++) {
      const h = (density[b] / max) * plotH;
      ctx.fillRect(padX + b * barW, padY + plotH - h, Math.max(1, barW - 1), h);
    }
    ctx.globalAlpha = 1;

    if (theory) {
      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = lineColor;
      theory.forEach((f, b) => {
        const px = padX + (b + 0.5) * barW;
        const py = toY(f);
        if (b === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }, [x, density, theory, height, barColor, lineColor]);

  return (
    <div className="chart">
      <div className="chart__head">
        <span className="chart__title">{title}</span>
        {readout && <span className="chart__latest">{readout}</span>}
      </div>
      <canvas ref={canvasRef} className="chart__canvas" style={{ height }} />
    </div>
  );
}
