import type { ForceModel, ForceResult, SimState } from "../types";

/**
 * L0 — ideal gas. No interactions: particles translate ballistically and only
 * interact with the cell boundary. Energy is purely kinetic; virial is zero, so
 * pressure reduces to the ideal-gas law P = N·k_B·T / V.
 */
export const NoForce: ForceModel = {
  name: "Aucune (gaz parfait)",
  compute(state: SimState): ForceResult {
    state.forces.fill(0);
    return { potentialEnergy: 0, virial: 0 };
  },
};
