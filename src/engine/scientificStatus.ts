import type { AccuracyLevel, SimConfig } from "./types";

/** Temporary P64 status vocabulary; P72 will promote this into the complete capability catalog. */
export type ScientificStatus = "demo" | "kernel-validated" | "cross-engine-validated" | "accepted";

export const SCIENTIFIC_STATUS_BY_LEVEL: Record<AccuracyLevel, ScientificStatus> = {
  L0: "kernel-validated",
  L1: "kernel-validated",
  L2: "kernel-validated",
  L3: "kernel-validated",
  L4: "demo",
  L5: "demo",
  L6: "demo",
  L7: "demo",
  L8: "demo",
  L9: "demo",
  L10: "demo",
  L11: "kernel-validated",
};

export const SCIENTIFIC_STATUS_LABELS: Record<ScientificStatus, string> = {
  demo: "Démonstration qualitative",
  "kernel-validated": "Noyaux validés · protocole incomplet",
  "cross-engine-validated": "Validé CPU ↔ GPU",
  accepted: "Accepté quantitativement",
};

const MOLECULAR_LEVELS = new Set<AccuracyLevel>(["L4", "L5", "L6", "L7", "L8", "L9", "L10", "L11"]);

const CONSTRAINED_LEVELS = new Set<AccuracyLevel>(["L5", "L6", "L7", "L8", "L11"]);

export function isMolecularLevel(level: AccuracyLevel): boolean {
  return MOLECULAR_LEVELS.has(level);
}

export function hasRigidConstraints(level: AccuracyLevel): boolean {
  return CONSTRAINED_LEVELS.has(level);
}

export interface ScientificSafetyIssue {
  readonly code: "molecular-npt-uncertified" | "constrained-langevin-uncertified";
  readonly message: string;
}

/** Known-invalid combinations temporarily blocked until their dedicated AAA phases land. */
export function scientificSafetyIssues(config: SimConfig): ScientificSafetyIssue[] {
  const issues: ScientificSafetyIssue[] = [];
  if (isMolecularLevel(config.level) && config.barostat === "berendsen") {
    issues.push({
      code: "molecular-npt-uncertified",
      message:
        "Le NPT moléculaire est désactivé : le barostat actuel ne préserve pas encore la géométrie et le viriel sous contraintes.",
    });
  }
  if (hasRigidConstraints(config.level) && config.thermostat === "langevin") {
    issues.push({
      code: "constrained-langevin-uncertified",
      message:
        "Langevin sous contraintes est désactivé : la projection RATTLE après le bruit stochastique n'est pas encore certifiée.",
    });
  }
  return issues;
}

/**
 * Last-resort runtime containment for internal UI patches. Imported configs are rejected instead,
 * so external input never changes scientific meaning silently.
 */
export function containUnsafeScientificConfig(config: SimConfig): SimConfig {
  let thermostat = config.thermostat;
  let barostat = config.barostat;
  if (hasRigidConstraints(config.level) && thermostat === "langevin") thermostat = "csvr";
  if (isMolecularLevel(config.level) && barostat === "berendsen") barostat = "none";
  if (thermostat === config.thermostat && barostat === config.barostat) return config;
  return { ...config, thermostat, barostat };
}

/** Why pressure must not be shown as a certified value for this active configuration. */
export function pressureUnavailableReason(config: SimConfig): string | null {
  if (config.level === "L11") {
    return "Pression scalaire indisponible pour L11 : le tenseur complet est en cours de certification.";
  }
  if (hasRigidConstraints(config.level)) {
    return "Pression non certifiée : le viriel des contraintes moléculaires n'est pas encore inclus.";
  }
  if (config.engineKind === "gpu" && (config.level === "L4" || config.level === "L6")) {
    return "Pression GPU non certifiée : les contributions liées au viriel sont incomplètes.";
  }
  return null;
}

/** Why potential and total energy must not be shown as complete for this active configuration. */
export function energyUnavailableReason(config: SimConfig): string | null {
  if (config.engineKind === "gpu" && (config.level === "L4" || config.level === "L6")) {
    return "Énergie GPU incomplète : les termes liés (liaisons/angles) ne sont pas encore réduits.";
  }
  return null;
}
