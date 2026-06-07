/**
 * Low-flow frequency analysis utilities.
 *
 * Implements the standard nQy approach:
 *  1. Compute n-day moving average of the daily discharge series.
 *  2. Extract the annual minimum of that moving average (calendar year).
 *  3. Fit a Log-Normal distribution to the annual minima.
 *  4. Report quantiles for specified return periods T.
 *
 * For minimum-flow (drought) analysis the non-exceedance probability is
 * p = 1/T: the T-year low flow is equalled or exceeded on average once in T years
 * FROM BELOW (i.e. P(X ≤ xT) = 1/T).
 *
 * Reference: Bulletin 17C (2019), HYDAT analysis practices.
 */

import type { DailyPoint } from "./types";

// ── Normal quantile (Acklam rational approximation, max error 3×10⁻⁹) ──────
function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return +Infinity;

  const a = [
    -3.969683028665376e+01, 2.209460984245205e+02,
    -2.759285104469687e+02, 1.383577518672690e+02,
    -3.066479806614716e+01, 2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01, 1.615858368580409e+02,
    -1.556989798598866e+02, 6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03, -3.223964580411365e-01,
    -2.400758277161838e+00, -2.549732539343734e+00,
     4.374664141464968e+00,  2.938163982698783e+00,
  ];
  const d = [
    7.784695709041462e-03,  3.224671290700398e-01,
     2.445134137142996e+00,  3.754408661907416e+00,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// ── n-day rolling mean (requires at least minFrac of window to be non-null) ─
function rollingMean(
  arr: (number | null)[],
  n: number,
  minFrac = 0.75
): (number | null)[] {
  const result: (number | null)[] = new Array(arr.length).fill(null);
  for (let i = n - 1; i < arr.length; i++) {
    let sum = 0, count = 0;
    for (let k = i - n + 1; k <= i; k++) {
      if (arr[k] !== null) { sum += arr[k] as number; count++; }
    }
    if (count / n >= minFrac) result[i] = sum / count;
  }
  return result;
}

// ── Public types ─────────────────────────────────────────────────────────────

export interface AnnualMinimum {
  year: number;
  value: number; // minimum n-day average discharge (m³/s)
}

export interface NQyStat {
  n: number;            // window length (days)
  T: number;            // return period (years)
  label: string;        // e.g. "7Q10"
  value: number | null; // m³/s
}

export interface LowFlowWindowResult {
  n: number;
  annualMinima: AnnualMinimum[];
  /** Log-Normal fit parameters (null when < 5 years of data). */
  fit: { muLog: number; sigmaLog: number; nYears: number } | null;
}

export interface LowFlowAnalysis {
  nValues: number[];
  returnPeriods: number[];
  windows: LowFlowWindowResult[];
  nqy: NQyStat[];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Compute low-flow (nQy) statistics from a daily discharge series.
 *
 * @param series        Daily discharge data (chronological order, nulls allowed).
 * @param nValues       Moving-average window sizes in days. Default [1, 7, 30].
 * @param returnPeriods Return periods in years. Default [2, 5, 10].
 * @param minDaysPerYear Minimum valid n-day windows in a year to include it. Default 200.
 */
export function computeLowFlow(
  series: DailyPoint[],
  nValues: number[] = [1, 7, 30],
  returnPeriods: number[] = [2, 5, 10],
  minDaysPerYear = 200
): LowFlowAnalysis {
  // Build parallel arrays: value and calendar year, sorted by date.
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const values: (number | null)[] = sorted.map((d) =>
    d.value !== null && (d.value as number) >= 0 ? (d.value as number) : null
  );
  const years: number[] = sorted.map((d) => parseInt(d.date.slice(0, 4), 10));

  const windows: LowFlowWindowResult[] = [];
  const nqy: NQyStat[] = [];

  for (const n of nValues) {
    const rm = rollingMean(values, n);

    // Group n-day means by calendar year → find annual minimum.
    const byYear = new Map<number, number[]>();
    rm.forEach((v, i) => {
      if (v === null || isNaN(years[i])) return;
      const y = years[i];
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y)!.push(v);
    });

    const annualMinima: AnnualMinimum[] = [];
    byYear.forEach((vals, year) => {
      if (vals.length < minDaysPerYear) return; // skip incomplete years
      annualMinima.push({ year, value: Math.min(...vals) });
    });
    annualMinima.sort((a, b) => a.year - b.year);

    // Fit Log-Normal distribution to positive annual minima.
    const positiveMinima = annualMinima.filter((m) => m.value > 0);
    let fit: LowFlowWindowResult["fit"] = null;

    if (positiveMinima.length >= 5) {
      const logVals = positiveMinima.map((m) => Math.log(m.value));
      const muLog = logVals.reduce((a, b) => a + b, 0) / logVals.length;
      const variance =
        logVals.reduce((a, b) => a + (b - muLog) ** 2, 0) /
        (logVals.length - 1);
      fit = { muLog, sigmaLog: Math.sqrt(variance), nYears: positiveMinima.length };
    }

    windows.push({ n, annualMinima, fit });

    // Compute nQy quantiles.
    for (const T of returnPeriods) {
      const p = 1 / T; // non-exceedance probability
      let value: number | null = null;
      if (fit) {
        const xT = Math.exp(fit.muLog + normInv(p) * fit.sigmaLog);
        value = xT > 0 ? xT : 0;
      }
      nqy.push({ n, T, label: `${n}Q${T}`, value });
    }
  }

  return { nValues, returnPeriods, windows, nqy };
}
