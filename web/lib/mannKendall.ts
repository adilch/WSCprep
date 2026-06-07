/**
 * Mann-Kendall monotonic trend test + Sen's slope estimator.
 *
 * Reference: Mann (1945), Kendall (1975), Sen (1968).
 * Variance formula accounts for ties in the data series.
 */

export interface MannKendallResult {
  /** Mann-Kendall S statistic (sum of signs of all pairwise differences). */
  s: number;
  /** Kendall's τ (normalised S, in [-1, +1]). */
  tau: number;
  /** Standardised Z-score (continuity-corrected). */
  z: number;
  /** Two-tailed p-value (normal approximation). */
  pValue: number;
  /** Sen's slope in (units of y) per (units of x). */
  senSlope: number;
  trend: "increasing" | "decreasing" | "no trend";
  /** True when p < 0.05 (two-tailed). */
  significant: boolean;
  /** Number of data points used. */
  n: number;
}

// ── Normal CDF (Abramowitz & Stegun 26.2.17, max error 7.5×10⁻⁸) ──────────
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.39894228040 * Math.exp((-x * x) / 2);
  const poly =
    t *
    (0.3193815302 +
      t *
        (-0.3565637813 +
          t *
            (1.7814779372 +
              t * (-1.8212559978 + t * 1.3302744929))));
  const p = 1 - d * poly;
  return x >= 0 ? p : 1 - p;
}

// ── Main ────────────────────────────────────────────────────────────────────
/**
 * Run Mann-Kendall test on a time series.
 *
 * @param values  Observed values in chronological order.
 * @param times   Corresponding times (e.g. years).  If omitted, 0,1,2,… is used.
 *                Used only for Sen's slope; must be the same length as values.
 */
export function mannKendall(
  values: number[],
  times?: number[]
): MannKendallResult {
  const n = values.length;
  const t = times ?? values.map((_, i) => i);

  if (n < 4) {
    // Not enough data for a meaningful test.
    return {
      s: 0, tau: 0, z: 0, pValue: 1,
      senSlope: 0, trend: "no trend", significant: false, n,
    };
  }

  // ── S statistic ──────────────────────────────────────────────────────────
  let S = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const diff = values[j] - values[i];
      if (diff > 0) S++;
      else if (diff < 0) S--;
    }
  }

  // ── Variance (with ties correction) ────────────────────────────────────
  // Count repeated values.
  const counts = new Map<number, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  let tieSum = 0;
  counts.forEach((tp) => {
    if (tp > 1) tieSum += tp * (tp - 1) * (2 * tp + 5);
  });
  const varS = (n * (n - 1) * (2 * n + 5) - tieSum) / 18;

  // ── Z statistic (continuity correction) ────────────────────────────────
  let Z = 0;
  if (varS > 0) {
    if (S > 0) Z = (S - 1) / Math.sqrt(varS);
    else if (S < 0) Z = (S + 1) / Math.sqrt(varS);
  }

  const pValue = 2 * (1 - normCdf(Math.abs(Z)));
  const tau = S / (0.5 * n * (n - 1));

  // ── Sen's slope (median of all pairwise slopes) ─────────────────────────
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dt = t[j] - t[i];
      if (dt !== 0) slopes.push((values[j] - values[i]) / dt);
    }
  }
  slopes.sort((a, b) => a - b);
  const mid = Math.floor(slopes.length / 2);
  const senSlope =
    slopes.length % 2 === 1
      ? slopes[mid]
      : (slopes[mid - 1] + slopes[mid]) / 2;

  const significant = pValue < 0.05;
  const trend = S > 0 ? "increasing" : S < 0 ? "decreasing" : "no trend";

  return { s: S, tau, z: Z, pValue, senSlope, trend, significant, n };
}

// ── Sequential (Progressive) Mann-Kendall ───────────────────────────────────
/**
 * Sneyers (1990) sequential Mann-Kendall test.
 *
 * Returns the progressive forward statistic u(t) computed on x₁…xₜ and the
 * progressive backward statistic u′(t) computed on the reversed series, both
 * mapped to the original time axis.
 *
 * Plotting u(t) and u′(t) together lets you identify change-points: where the
 * two curves intersect — especially within the ±1.96 significance band — marks
 * the approximate onset of a trend shift.
 *
 * Also returns the cumulative departure from the mean (standardised), useful
 * for visualising sustained above/below-average periods.
 */
export interface SequentialMKPoint {
  t: number;   // time value (year)
  u: number;   // standardised MK statistic
}

export interface SequentialMKResult {
  /** Forward progressive u(t), length = n-1. */
  forward: SequentialMKPoint[];
  /** Backward progressive u′(t), same time axis, length = n-1. */
  backward: SequentialMKPoint[];
  /** Cumulative standardised departure from the series mean. Length = n. */
  cumulDep: SequentialMKPoint[];
  /** Critical value for α = 0.05 (two-tailed): ±1.96 */
  criticalValue: number;
}

export function sequentialMannKendall(
  values: number[],
  times?: number[]
): SequentialMKResult {
  const n = values.length;
  const t = times ?? values.map((_, i) => i);

  // Incrementally compute the progressive MK S statistic.
  // result[i] = u at the sub-series of length (i+2), i = 0…n-2.
  function progressive(vals: number[]): number[] {
    const result: number[] = [];
    let S = 0;
    for (let k = 1; k < vals.length; k++) {
      // Accumulate sign differences between vals[k] and all previous vals.
      for (let i = 0; i < k; i++) {
        const diff = vals[k] - vals[i];
        if (diff > 0) S++;
        else if (diff < 0) S--;
      }
      // Variance for sub-series of length m = k+1 (no ties correction for
      // the progressive series, which is standard practice).
      const m = k + 1;
      const varS = (m * (m - 1) * (2 * m + 5)) / 18;
      result.push(varS > 0 ? S / Math.sqrt(varS) : 0);
    }
    return result;
  }

  // Forward: u[i] corresponds to time t[i+1] (series length i+2).
  const fwdU  = progressive(values);
  const forward: SequentialMKPoint[] = fwdU.map((u, i) => ({ t: t[i + 1], u }));

  // Backward: compute on reversed series, then re-map to original time axis.
  // fwdU of reversed[i] covers reversed[0..i+1] = values[n-1..n-2-i],
  // so the "new" point at step i is values[n-2-i], at original time t[n-2-i].
  const bwdU  = progressive([...values].reverse());
  const backward: SequentialMKPoint[] = bwdU
    .map((u, i) => ({ t: t[n - 2 - i], u }))
    .sort((a, b) => a.t - b.t);

  // Cumulative standardised departure from the series mean.
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd   = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
  let cumul  = 0;
  const cumulDep: SequentialMKPoint[] = values.map((v, i) => {
    cumul += (v - mean) / sd;
    return { t: t[i], u: cumul };
  });

  return { forward, backward, cumulDep, criticalValue: 1.96 };
}
