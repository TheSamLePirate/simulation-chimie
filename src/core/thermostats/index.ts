import type { Rng } from "../rng";
import { BOLTZMANN_KJ_PER_MOL_K } from "../units";

/** Available thermostats. `none` = NVE; others target a temperature (NVT). */
export type ThermostatKind = "none" | "berendsen" | "csvr" | "langevin";

/**
 * Langevin (Ornstein-Uhlenbeck) per-atom velocity update — the "O" step of BAOAB. Each atom
 * gets friction + a random kick that together sample the canonical ensemble AND produce
 * Brownian motion: v ← c₁·v + c₂·η, with c₁ = e^(−Δt/τ), c₂ = √[(1−c₁²)·k_B·T/m], η ~ N(0,1).
 * Unlike Berendsen/CSVR this is per-atom (mass-dependent), so it returns the two scale factors.
 */
export function langevinFactors(
  dt: number,
  tau: number,
  targetT: number,
  mass: number,
): { c1: number; c2: number } {
  const c1 = Math.exp(-dt / tau);
  const c2 = Math.sqrt(Math.max(0, (1 - c1 * c1) * BOLTZMANN_KJ_PER_MOL_K * targetT) / mass);
  return { c1, c2 };
}

/**
 * Berendsen velocity-rescale factor toward `targetT` with coupling time `tau` (ps).
 * λ = √[1 + (Δt/τ)(T_target/T − 1)]. Fast and robust for equilibration, but does not
 * sample the exact canonical ensemble (the "flying ice cube" caveat).
 */
export function berendsenLambda(
  currentT: number,
  targetT: number,
  dt: number,
  tau: number,
): number {
  if (currentT <= 1e-9) return 1;
  const lambdaSq = 1 + (dt / tau) * (targetT / currentT - 1);
  // Clamp to avoid blow-ups when far from target / tiny τ.
  return Math.sqrt(Math.min(1.5, Math.max(0.5, lambdaSq)));
}

/**
 * CSVR / Bussi-Donadio-Parrinello stochastic velocity rescaling — samples the correct
 * canonical ensemble. Returns the velocity scale factor from current/target kinetic
 * energy, degrees of freedom and an RNG (for reproducibility).
 *
 * K'/K = 1 + (1−c)[(R₁² + ΣR²)·K̄/(N_f·K) − 1] + 2·R₁·√[c(1−c)·K̄/(N_f·K)]
 * with c = exp(−Δt/τ), R₁ ~ N(0,1), ΣR² = Σ_{i=2}^{N_f} R_i².
 */
export function csvrLambda(
  currentKE: number,
  targetKE: number,
  dof: number,
  dt: number,
  tau: number,
  rng: Rng,
): number {
  if (currentKE <= 1e-12 || dof < 1) return 1;
  const c = Math.exp(-dt / tau);
  const r1 = rng.gaussian();
  let sumSq = 0;
  for (let i = 1; i < dof; i++) {
    const g = rng.gaussian();
    sumSq += g * g;
  }
  const ratio = targetKE / (dof * currentKE);
  const newOverOld =
    1 + (1 - c) * ((r1 * r1 + sumSq) * ratio - 1) + 2 * r1 * Math.sqrt(c * (1 - c) * ratio);
  return Math.sqrt(Math.max(0, newOverOld));
}
