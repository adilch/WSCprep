/**
 * Peaks-Over-Threshold (POT) / Partial Duration Series analysis.
 *
 * Peak extraction uses a two-stage approach:
 *  1. Identify continuous above-threshold events; pick the day-maximum of each.
 *  2. Apply a minimum-separation-gap filter to ensure independence.
 *
 * Distribution: Generalized Pareto (GPD) fitted by the method of L-moments
 * (Hosking & Wallis 1987) — closed-form, no iteration required.
 *
 * Return-period conversion (Poisson process assumption):
 *   x_T = u + σ/ξ · ((λT)^ξ − 1)   if |ξ| > ε  (GPD general case)
 *   x_T = u + σ · ln(λT)            if |ξ| ≤ ε  (exponential special case)
 * where λ = mean POT events per year.
 *
 * References:
 *   Davison & Smith (1990), J. Roy. Statist. Soc. B 52(3), 393–442.
 *   Hosking & Wallis (1987), Technometrics 29(3), 339–349.
 */

import type { DailyPoint } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Minimum POT peaks required for a reliable GPD fit. */
const MIN_PEAKS = 15;

/** Default return periods for quantile table. */
export const DEFAULT_POT_RETURN_PERIODS = [2, 5, 10, 20, 25, 50, 100, 200, 500];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PotPeak {
  date:  string;   // ISO date of the peak day within its event
  value: number;   // discharge (m³/s)
}

export interface GpdParams {
  shape:     number;   // ξ (xi)  — shape parameter
  scale:     number;   // σ (sigma) — scale parameter
  threshold: number;   // u — exceedance threshold (m³/s)
  lambda:    number;   // mean POT events per year
  nPeaks:    number;
  nYears:    number;
}

export interface PotQuantile {
  returnPeriod: number;
  aep:          number;
  quantile:     number | null;
}

export interface PotResult {
  peaks:     PotPeak[];
  params:    GpdParams | null;    // null when fewer than MIN_PEAKS peaks
  quantiles: PotQuantile[];
  warning:   string | null;
}

// ── Peak extraction ───────────────────────────────────────────────────────────

/**
 * Extract independent POT peaks from a daily discharge series.
 *
 * For each run of consecutive days with Q > threshold, the day with the
 * maximum discharge is selected as a candidate peak.  A minimum-separation-
 * gap filter then ensures independence between consecutive peaks.
 *
 * @param series              Daily discharge series (chronological).
 * @param threshold           Exceedance threshold u (m³/s).
 * @param minSeparationDays   Minimum gap between accepted peaks (default 7).
 */
export function extractPotPeaks(
  series:             DailyPoint[],
  threshold:          number,
  minSeparationDays = 7,
): PotPeak[] {
  // ── Step 1: event detection ───────────────────────────────────────────────
  const candidates: PotPeak[] = [];
  let inEvent  = false;
  let evtPeak: PotPeak | null = null;

  for (const d of series) {
    if (d.value === null) {
      if (inEvent && evtPeak) { candidates.push(evtPeak); inEvent = false; evtPeak = null; }
      continue;
    }
    if (d.value > threshold) {
      if (!inEvent) {
        inEvent  = true;
        evtPeak  = { date: d.date, value: d.value };
      } else if (d.value > evtPeak!.value) {
        evtPeak  = { date: d.date, value: d.value };
      }
    } else {
      if (inEvent && evtPeak) { candidates.push(evtPeak); inEvent = false; evtPeak = null; }
    }
  }
  if (inEvent && evtPeak) candidates.push(evtPeak);

  // ── Step 2: separation-gap filter ────────────────────────────────────────
  const accepted: PotPeak[] = [];
  let lastTime: number | null = null;

  for (const c of candidates) {
    const t = new Date(c.date + "T00:00:00").getTime();
    if (lastTime !== null && (t - lastTime) / 86_400_000 < minSeparationDays) continue;
    accepted.push(c);
    lastTime = t;
  }
  return accepted;
}

// ── GPD L-moments fit ─────────────────────────────────────────────────────────

/**
 * Compute sample L-moments of exceedances and return GPD parameters.
 *
 * L-moment estimators for GPD (Hosking & Wallis 1987):
 *   λ₁ = sample mean,
 *   λ₂ = L-scale  (via the order-statistic formula on the sorted sample),
 *   ξ = λ₁/λ₂ − 2,
 *   σ = λ₁(1 − ξ).
 */
function lmomGpd(exceedances: number[]): { shape: number; scale: number } | null {
  const n = exceedances.length;
  if (n < MIN_PEAKS) return null;

  const sorted = [...exceedances].sort((a, b) => a - b);

  const lambda1 = sorted.reduce((s, v) => s + v, 0) / n;

  // L-scale: λ₂ = (2/n(n-1)) · Σᵢ xᵢ·(i − (n-1)/2)   [0-indexed sorted array]
  let lambda2 = 0;
  for (let i = 0; i < n; i++) {
    lambda2 += sorted[i] * (i - (n - 1) / 2);
  }
  lambda2 = (2 / (n * (n - 1))) * lambda2;

  if (lambda2 <= 0 || lambda1 <= 0) return null;  // degenerate sample

  const shape = lambda1 / lambda2 - 2;
  const scale = lambda1 * (1 - shape);

  if (scale <= 0) return null;   // inadmissible parameter set
  return { shape, scale };
}

// ── Parameter estimation ──────────────────────────────────────────────────────

/**
 * Estimate GPD parameters from a set of POT peaks.
 * Returns null when fewer than MIN_PEAKS peaks are available, or when
 * the L-moment estimator produces inadmissible parameters.
 */
export function fitGpdLmom(
  peaks:     PotPeak[],
  threshold: number,
  nYears:    number,
): GpdParams | null {
  if (peaks.length < MIN_PEAKS) return null;

  const exceedances = peaks.map((p) => p.value - threshold);
  const fit = lmomGpd(exceedances);
  if (!fit) return null;

  return {
    ...fit,
    threshold,
    lambda: peaks.length / nYears,
    nPeaks: peaks.length,
    nYears,
  };
}

// ── Quantile estimation ───────────────────────────────────────────────────────

/**
 * Compute POT design discharge at each return period.
 *
 * The T-year event in a Poisson POT model corresponds to the
 * (1 − 1/λT) quantile of the GPD:
 *   x_T = u + σ/ξ · ((λT)^ξ − 1)   if |ξ| > ε
 *   x_T = u + σ · ln(λT)            if |ξ| ≤ ε
 */
export function computePotQuantiles(
  params:        GpdParams,
  returnPeriods: number[],
): PotQuantile[] {
  const { shape, scale, threshold, lambda } = params;
  const EPS = 1e-8;

  return returnPeriods.map((T) => {
    const lT = lambda * T;
    let q: number;
    if (Math.abs(shape) > EPS) {
      q = threshold + (scale / shape) * (Math.pow(lT, shape) - 1);
    } else {
      q = threshold + scale * Math.log(lT);
    }
    return { returnPeriod: T, aep: 1 / T, quantile: q >= threshold ? q : null };
  });
}

// ── Threshold percentile helper ───────────────────────────────────────────────

/**
 * Return the discharge value at the given percentile of the non-zero daily
 * series.  Used to seed the threshold slider from a percentile.
 */
export function dischargePercentile(series: DailyPoint[], pct: number): number {
  const vals = series
    .map((d) => d.value)
    .filter((v): v is number => v !== null && v > 0)
    .sort((a, b) => a - b);
  if (!vals.length) return 0;
  const idx = Math.max(0, Math.min(vals.length - 1,
    Math.floor((pct / 100) * (vals.length - 1))));
  return vals[idx];
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Full POT analysis pipeline:
 *   extractPotPeaks → fitGpdLmom → computePotQuantiles
 */
export function computePot(
  series:           DailyPoint[],
  threshold:        number,
  minSeparationDays: number,
  returnPeriods:    number[],
): PotResult {
  const validDates = series.filter((d) => d.value !== null);
  if (!validDates.length) {
    return { peaks: [], params: null, quantiles: [], warning: "No valid daily data." };
  }

  const firstYear = parseInt(validDates[0].date.slice(0, 4), 10);
  const lastYear  = parseInt(validDates[validDates.length - 1].date.slice(0, 4), 10);
  const nYears    = Math.max(lastYear - firstYear + 1, 1);

  const peaks    = extractPotPeaks(series, threshold, minSeparationDays);
  const params   = fitGpdLmom(peaks, threshold, nYears);
  const quantiles = params ? computePotQuantiles(params, returnPeriods) : [];

  const warning = peaks.length < MIN_PEAKS
    ? `Only ${peaks.length} peak${peaks.length !== 1 ? "s" : ""} above threshold — `
      + `GPD fit requires at least ${MIN_PEAKS}. `
      + `Try lowering the threshold or reducing the separation gap.`
    : null;

  return { peaks, params, quantiles, warning };
}
