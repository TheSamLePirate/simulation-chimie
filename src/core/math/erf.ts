const TWO_OVER_SQRT_PI = 2 / Math.sqrt(Math.PI);
const LOG_GAMMA_HALF = 0.5 * Math.log(Math.PI);

function erfSeries(x: number): number {
  let term = x;
  let sum = x;
  for (let n = 1; n < 100; n++) {
    term *= (-x * x) / n;
    const contribution = term / (2 * n + 1);
    sum += contribution;
    if (Math.abs(contribution) <= Number.EPSILON * Math.abs(sum)) break;
  }
  return TWO_OVER_SQRT_PI * sum;
}

/** Regularized upper incomplete gamma Q(1/2,x), evaluated by Lentz's continued fraction. */
function gammaQHalf(x: number): number {
  const tiny = 1e-300;
  let b = x + 0.5;
  let c = 1 / tiny;
  let d = 1 / b;
  let fraction = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - 0.5);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) <= 4 * Number.EPSILON) break;
  }
  return Math.exp(-x + 0.5 * Math.log(x) - LOG_GAMMA_HALF) * fraction;
}

/**
 * Complementary error function at near machine precision. A convergent Taylor series is used
 * near zero and the Q(1/2,x²) continued fraction in the tail. The energy value is therefore
 * consistent with the analytic derivative used by Ewald/Wolf forces.
 */
export function erfcAccurate(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === Infinity) return 0;
  if (x === -Infinity) return 2;
  const z = Math.abs(x);
  const positive = z < 1.5 ? 1 - erfSeries(z) : gammaQHalf(z * z);
  return x >= 0 ? positive : 2 - positive;
}

/** Fast ≈1.2×10⁻⁷ approximation used by the real-time Wolf DSF path. */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? ans : 2 - ans;
}
