/**
 * Digital baseflow separation filters.
 *
 * Two industry-standard recursive filters are implemented:
 *
 * 1. Lyne-Hollick (1979) — one-parameter filter run in three passes
 *    (forward → backward → forward) to remove phase lag.
 *
 *    Each pass applies:
 *      qf[t] = α·qf[t-1] + (1-α)/2·(B[t]+B[t-1])   (quickflow separation)
 *      b[t]  = B[t] - qf[t]                           (refined baseflow)
 *    where B is the current baseflow estimate (Q on the first pass).
 *
 *    Typical α = 0.925 for Canadian rivers.
 *
 * 2. Eckhardt (2005) — two-parameter filter.
 *    b[t] = ((1-BFImax)·a·b[t-1] + (1-a)·BFImax·Q[t]) / (1 - a·BFImax)
 *    b[t] = min(b[t], Q[t])
 *    Typical: a = 0.98 (recession constant), BFImax = 0.80 (perennial streams).
 *
 * Null values (missing data) are handled by operating on compact non-null
 * sub-arrays and scattering results back to their original positions.
 *
 * References:
 *   Lyne & Hollick (1979), Proc. Hydrology and Water Resources Symp., Perth.
 *   Eckhardt (2005), Hydrological Processes 19(3), 507–515.
 *   Nathan & McMahon (1990), Water Resour. Res. 26(7), 1465–1473. (3-pass standard)
 */

import type { DailyPoint } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

export type BaseflowMethod = "lyne-hollick" | "eckhardt";

export interface BaseflowParams {
  method:  BaseflowMethod;
  alpha?:  number;   // Lyne-Hollick recession parameter α (default 0.925)
  passes?: number;   // Number of filter passes (default 3: fwd → bwd → fwd)
  a?:      number;   // Eckhardt recession constant (default 0.98)
  bfiMax?: number;   // Eckhardt BFImax (default 0.80)
}

export interface BaseflowResult {
  baseflow:  (number | null)[];  // parallel to input; null where Q is null
  quickflow: (number | null)[];  // Q - baseflow
  bfi:       number;             // baseflow index = Σb / ΣQ over non-null values
  method:    BaseflowMethod;
  params:    Required<BaseflowParams>;
}

// ── Lyne-Hollick ──────────────────────────────────────────────────────────────

/**
 * One forward-direction pass of the Lyne-Hollick filter.
 *
 * @param B     Current baseflow estimate (compact non-null array).
 * @param alpha Recession parameter α.
 * @returns     Refined baseflow after this pass.
 */
function lhSinglePass(B: number[], alpha: number): number[] {
  if (B.length === 0) return [];
  const qf = new Array<number>(B.length).fill(0);
  // Initialise first quickflow to zero (assume all first-day flow is baseflow).
  for (let t = 1; t < B.length; t++) {
    qf[t] = alpha * qf[t - 1] + ((1 - alpha) / 2) * (B[t] + B[t - 1]);
    if (qf[t] < 0)    qf[t] = 0;
    if (qf[t] > B[t]) qf[t] = B[t];
  }
  return B.map((v, i) => Math.max(0, v - qf[i]));
}

/**
 * Multi-pass Lyne-Hollick baseflow filter (Nathan & McMahon 1990 convention).
 *
 * Pass 1 (forward), pass 2 (backward on pass-1 result),
 * pass 3 (forward on pass-2 result), and so on.
 * Each pass further refines the baseflow estimate.
 */
export function lyneHollick(
  Q:      (number | null)[],
  alpha = 0.925,
  passes = 3,
): (number | null)[] {
  // Separate non-null values, keeping track of their original indices.
  const vals: number[]   = [];
  const idxMap: number[] = [];
  for (let i = 0; i < Q.length; i++) {
    if (Q[i] !== null) { vals.push(Q[i] as number); idxMap.push(i); }
  }
  if (!vals.length) return Q.map(() => null);

  let bf = vals;   // initial estimate = full discharge
  for (let p = 0; p < passes; p++) {
    const forward = p % 2 === 0;
    const inp     = forward ? bf : [...bf].reverse();
    const out     = lhSinglePass(inp, alpha);
    bf            = forward ? out : out.reverse();
  }

  // Scatter back into null-padded output array.
  const result: (number | null)[] = Q.map(() => null);
  for (let i = 0; i < idxMap.length; i++) {
    result[idxMap[i]] = Math.max(0, Math.min(vals[i], bf[i]));
  }
  return result;
}

// ── Eckhardt ──────────────────────────────────────────────────────────────────

/**
 * Eckhardt two-parameter recursive digital filter.
 */
export function eckhardtFilter(
  Q:       (number | null)[],
  a      = 0.98,
  bfiMax = 0.80,
): (number | null)[] {
  const vals: number[]   = [];
  const idxMap: number[] = [];
  for (let i = 0; i < Q.length; i++) {
    if (Q[i] !== null) { vals.push(Q[i] as number); idxMap.push(i); }
  }
  if (!vals.length) return Q.map(() => null);

  const denom = 1 - a * bfiMax;
  const bf    = new Array<number>(vals.length);
  bf[0]       = vals[0] * bfiMax;   // initialise at BFImax fraction of first discharge

  for (let t = 1; t < vals.length; t++) {
    bf[t] = ((1 - bfiMax) * a * bf[t - 1] + (1 - a) * bfiMax * vals[t]) / denom;
    bf[t] = Math.min(bf[t], vals[t]);
    bf[t] = Math.max(bf[t], 0);
  }

  const result: (number | null)[] = Q.map(() => null);
  for (let i = 0; i < idxMap.length; i++) {
    result[idxMap[i]] = bf[i];
  }
  return result;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Compute baseflow separation and return a full `BaseflowResult`.
 *
 * @param series  Daily discharge series (DailyPoint[]).
 * @param method  "lyne-hollick" or "eckhardt".
 * @param params  Method-specific parameters (partial; defaults are applied).
 */
export function computeBaseflow(
  series: DailyPoint[],
  method: BaseflowMethod,
  params: Partial<BaseflowParams>,
): BaseflowResult {
  const Q = series.map((d) => d.value);

  const resolved: Required<BaseflowParams> = {
    method,
    alpha:  params.alpha  ?? 0.925,
    passes: params.passes ?? 3,
    a:      params.a      ?? 0.98,
    bfiMax: params.bfiMax ?? 0.80,
  };

  const baseflow: (number | null)[] =
    method === "lyne-hollick"
      ? lyneHollick(Q, resolved.alpha, resolved.passes)
      : eckhardtFilter(Q, resolved.a, resolved.bfiMax);

  const quickflow: (number | null)[] = Q.map((q, i) => {
    if (q === null || baseflow[i] === null) return null;
    return Math.max(0, (q as number) - (baseflow[i] as number));
  });

  // Baseflow index: Σb / ΣQ (over non-null pairs only).
  let sumB = 0, sumQ = 0;
  for (let i = 0; i < Q.length; i++) {
    if (Q[i] !== null && baseflow[i] !== null) {
      sumQ += Q[i] as number;
      sumB += baseflow[i] as number;
    }
  }
  const bfi = sumQ > 0 ? Math.min(1, Math.max(0, sumB / sumQ)) : 0;

  return { baseflow, quickflow, bfi, method, params: resolved };
}
