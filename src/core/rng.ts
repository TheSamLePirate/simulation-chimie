/**
 * Deterministic, seedable PRNG (mulberry32) plus a Gaussian sampler (Box-Muller).
 *
 * Determinism is a hard project requirement: identical seed ⇒ identical stream, so
 * runs and snapshots are reproducible. Not cryptographically secure — that is fine.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Avoid the degenerate all-zero state.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Next 32-bit unsigned integer. */
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Standard-normal sample, scaled/shifted to (mean, std). */
  gaussian(mean = 0, std = 1): number {
    // Box-Muller; guard u1 away from 0 so log() stays finite.
    let u1 = this.next();
    if (u1 < 1e-12) u1 = 1e-12;
    const u2 = this.next();
    const mag = std * Math.sqrt(-2 * Math.log(u1));
    return mean + mag * Math.cos(2 * Math.PI * u2);
  }
}
