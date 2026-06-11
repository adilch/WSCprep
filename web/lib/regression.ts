import type { DailyPoint, PeakPoint } from "./types";
import { computeLowFlow } from "./lowFlow";

/**
 * Regional regression of a flow parameter against drainage area.
 *
 * Fit is ordinary least squares in log10–log10 space, the standard form used
 * by provincial/USGS regional flood studies:
 *    log10(Q) = log10(a) + b·log10(A)   ⇔   Q = a·A^b
 */

export type RegressionParam =
  | "meanPeak" | "medianPeak" | "mad" | "unitRunoff" | "q7_10";

export interface RegressionParamInfo {
  label: string;
  unit: string;
  /** Which dataset the parameter is computed from. */
  needs: "peaks" | "daily";
}

export const REGRESSION_PARAMS: Record<RegressionParam, RegressionParamInfo> = {
  meanPeak:   { label: "Mean annual peak",       unit: "m³/s",     needs: "peaks" },
  medianPeak: { label: "Median annual peak",     unit: "m³/s",     needs: "peaks" },
  mad:        { label: "Mean annual discharge",  unit: "m³/s",     needs: "daily" },
  unitRunoff: { label: "Unit runoff (MAD/area)", unit: "L/s·km²",  needs: "daily" },
  q7_10:      { label: "7Q10 low flow",          unit: "m³/s",     needs: "daily" },
};

export interface StationFlowData {
  peaks?: PeakPoint[];
  daily?: DailyPoint[];
}

/** Compute the chosen Y value for one station; null when not computable. */
export function computeYValue(
  param: RegressionParam,
  data: StationFlowData,
  areaKm2: number
): number | null {
  switch (param) {
    case "meanPeak": {
      const v = data.peaks?.map((p) => p.value);
      if (!v?.length) return null;
      return v.reduce((a, b) => a + b, 0) / v.length;
    }
    case "medianPeak": {
      const v = data.peaks?.map((p) => p.value).sort((a, b) => a - b);
      if (!v?.length) return null;
      const mid = Math.floor(v.length / 2);
      return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
    }
    case "mad":
    case "unitRunoff": {
      const vals = data.daily?.filter((d) => d.value !== null).map((d) => d.value as number);
      if (!vals?.length) return null;
      const mad = vals.reduce((a, b) => a + b, 0) / vals.length;
      return param === "mad" ? mad : (mad / areaKm2) * 1000; // m³/s → L/s per km²
    }
    case "q7_10": {
      if (!data.daily?.length) return null;
      const r = computeLowFlow(data.daily, [7], [10]);
      return r.nqy[0]?.value ?? null;
    }
  }
}

export interface PowerLawFit {
  /** Exponent b in Q = a·A^b. */
  slope: number;
  /** Coefficient a in Q = a·A^b. */
  coefficient: number;
  r2: number;
  /** Standard error of estimate in log10 units. */
  seLog: number;
  n: number;
}

/** OLS in log10–log10 space. Points with non-positive x or y are ignored. */
export function fitPowerLaw(points: { x: number; y: number }[]): PowerLawFit | null {
  const pts = points.filter((p) => p.x > 0 && p.y > 0);
  const n = pts.length;
  if (n < 3) return null;

  const lx = pts.map((p) => Math.log10(p.x));
  const ly = pts.map((p) => Math.log10(p.y));
  const mx = lx.reduce((a, b) => a + b, 0) / n;
  const my = ly.reduce((a, b) => a + b, 0) / n;

  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (lx[i] - mx) ** 2;
    sxy += (lx[i] - mx) * (ly[i] - my);
    syy += (ly[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  let sse = 0;
  for (let i = 0; i < n; i++) {
    sse += (ly[i] - (intercept + slope * lx[i])) ** 2;
  }
  const r2 = 1 - sse / syy;
  const seLog = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;

  return { slope, coefficient: Math.pow(10, intercept), r2, seLog, n };
}

export function predictPowerLaw(fit: PowerLawFit, areaKm2: number): number {
  return fit.coefficient * Math.pow(areaKm2, fit.slope);
}

/**
 * Approximate 95% range for a prediction: multiplicative interval from the
 * standard error of estimate (ignores leverage — adequate for screening).
 */
export function predictionRange(
  fit: PowerLawFit, areaKm2: number
): { low: number; high: number } {
  const pred = predictPowerLaw(fit, areaKm2);
  const f = Math.pow(10, 1.96 * fit.seLog);
  return { low: pred / f, high: pred * f };
}
