import { useEffect, useRef } from "react";
import type { DensityProfile } from "../../core/observables/densityProfile";

interface Props {
  profile: DensityProfile | null;
  liquidThickness: number | null;
}

export function DensityProfileChart({ profile, liquidThickness }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.clientWidth;
    const height = 152;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(document.documentElement);
    const muted = styles.getPropertyValue("--muted").trim() || "#c0b59a";
    const accent = styles.getPropertyValue("--accent").trim() || "#d6ac55";
    context.font = '10px "IBM Plex Mono", ui-monospace, monospace';
    context.fillStyle = muted;
    if (!profile || profile.z.length < 2) {
      context.fillText("Profil disponible après initialisation", 12, 78);
      return;
    }
    const pad = { left: 38, right: 8, top: 10, bottom: 24 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const minZ = profile.z[0] - profile.binWidth / 2;
    const maxZ = profile.z[profile.z.length - 1] + profile.binWidth / 2;
    const smoothed = profile.density.map((_, index) => {
      const weights = [1, 4, 6, 4, 1];
      let sum = 0;
      let weight = 0;
      for (let offset = -2; offset <= 2; offset++) {
        const candidate = index + offset;
        if (candidate < 0 || candidate >= profile.density.length) continue;
        sum += weights[offset + 2] * profile.density[candidate];
        weight += weights[offset + 2];
      }
      return sum / weight;
    });
    const maxDensity = Math.max(1100, ...smoothed) * 1.05;
    const x = (z: number) => pad.left + ((z - minZ) / (maxZ - minZ)) * plotW;
    const y = (density: number) => pad.top + plotH - (density / maxDensity) * plotH;
    context.strokeStyle = "rgba(244,236,216,.12)";
    context.lineWidth = 1;
    for (const density of [0, 500, 1000]) {
      context.beginPath();
      context.moveTo(pad.left, y(density));
      context.lineTo(width - pad.right, y(density));
      context.stroke();
      context.fillStyle = muted;
      context.fillText(String(density), 4, y(density) + 3);
    }
    if (liquidThickness) {
      context.fillStyle = "rgba(214,172,85,.09)";
      context.fillRect(
        x(-liquidThickness / 2),
        pad.top,
        x(liquidThickness / 2) - x(-liquidThickness / 2),
        plotH,
      );
    }
    context.beginPath();
    smoothed.forEach((density, index) => {
      const px = x(profile.z[index]);
      const py = y(density);
      if (index === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    });
    context.strokeStyle = accent;
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = muted;
    context.fillText(`${minZ.toFixed(1)} nm`, pad.left, height - 6);
    const rightLabel = `${maxZ.toFixed(1)} nm`;
    context.fillText(
      rightLabel,
      width - pad.right - context.measureText(rightLabel).width,
      height - 6,
    );
    context.fillText("ρ (kg·m⁻³)", pad.left, 9);
  }, [profile, liquidThickness]);

  return (
    <canvas
      ref={canvasRef}
      className="lab-profile__canvas"
      role="img"
      aria-label="Profil de densité massique suivant l’axe normal z"
    />
  );
}
