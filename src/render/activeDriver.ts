import type { SimDriver } from "./drivers";

/**
 * Module-level handle to the live driver, so React export/snapshot actions can read
 * the current simulation state synchronously without routing buffers through the store.
 */
let active: SimDriver | null = null;

export function setActiveDriver(driver: SimDriver | null): void {
  active = driver;
}

export function getActiveDriver(): SimDriver | null {
  return active;
}
