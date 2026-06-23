import type { RadialDistribution } from "../../core/observables/rdf";

/** Trigger a browser download of `text` as `filename`. */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadJSON(filename: string, value: unknown): void {
  downloadText(filename, JSON.stringify(value, null, 2), "application/json");
}

/** Two-column CSV of the radial distribution function. */
export function rdfToCsv(rdf: RadialDistribution): string {
  const lines = ["r_nm,g_of_r"];
  for (let i = 0; i < rdf.r.length; i++) {
    lines.push(`${rdf.r[i].toFixed(5)},${rdf.g[i].toFixed(5)}`);
  }
  return lines.join("\n");
}
