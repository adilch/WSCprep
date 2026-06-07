/**
 * Shared hydrological data-transformation helpers.
 *
 * Pure functions (no side effects, no framework dependencies) used by
 * both HistoricDataView and ReportView.
 */

import type { DailyPoint } from "./types";

export type HydroVariable = "discharge" | "level";

// ── Flow-Duration Curve ───────────────────────────────────────────────────────

export function computeFdc(series: DailyPoint[]): { x: number[]; y: number[] } {
  const vals = series
    .filter((d) => d.value !== null && (d.value as number) > 0)
    .map((d) => d.value as number)
    .sort((a, b) => b - a);
  if (!vals.length) return { x: [], y: [] };
  return { x: vals.map((_, i) => ((i + 1) / vals.length) * 100), y: vals };
}

// ── Annual Regime ─────────────────────────────────────────────────────────────

function quantile(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface RegimeData {
  x:      number[];
  mean:   number[];
  median: number[];
  min:    number[];
  max:    number[];
  q10:    number[];
  q25:    number[];
  q75:    number[];
  q90:    number[];
}

export function computeRegime(series: DailyPoint[]): RegimeData {
  const byDoy: number[][] = Array.from({ length: 366 }, () => []);
  series.forEach((d) => {
    if (d.value === null) return;
    const date = new Date(d.date + "T00:00:00");
    const doy  = Math.floor(
      (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000
    );
    if (doy >= 1 && doy <= 366) byDoy[doy - 1].push(d.value as number);
  });

  const x: number[] = [], mean: number[] = [], median: number[] = [];
  const min: number[] = [], max: number[] = [];
  const q10: number[] = [], q25: number[] = [], q75: number[] = [], q90: number[] = [];

  byDoy.forEach((vals, i) => {
    if (vals.length < 2) return;
    vals.sort((a, b) => a - b);
    x.push(i + 1);
    mean.push(vals.reduce((a, b) => a + b) / vals.length);
    median.push(quantile(vals, 0.5));
    min.push(vals[0]);
    max.push(vals[vals.length - 1]);
    q10.push(quantile(vals, 0.1));
    q25.push(quantile(vals, 0.25));
    q75.push(quantile(vals, 0.75));
    q90.push(quantile(vals, 0.9));
  });

  return { x, mean, median, min, max, q10, q25, q75, q90 };
}

// ── Annual Statistics ─────────────────────────────────────────────────────────

export interface AnnualStat {
  year:    number;
  n:       number;
  mean:    number;
  max:     number;
  maxDate: string;
  min:     number;
  minDate: string;
  volume:  number | null;  // Mm³ (discharge only)
}

export function computeAnnualStats(
  series:   DailyPoint[],
  variable: HydroVariable,
): AnnualStat[] {
  const byYear = new Map<number, { vals: { v: number; date: string }[] }>();
  series.forEach((d) => {
    if (d.value === null) return;
    const y = parseInt(d.date.slice(0, 4), 10);
    if (isNaN(y)) return;
    if (!byYear.has(y)) byYear.set(y, { vals: [] });
    byYear.get(y)!.vals.push({ v: d.value as number, date: d.date });
  });
  return Array.from(byYear.entries())
    .map(([year, { vals }]) => {
      const ns   = vals.map((x) => x.v).sort((a, b) => a - b);
      const mean = ns.reduce((a, b) => a + b) / ns.length;
      const max  = ns[ns.length - 1];
      const min  = ns[0];
      return {
        year, n: vals.length, mean,
        max, maxDate: vals.find((x) => x.v === max)?.date ?? "",
        min, minDate: vals.find((x) => x.v === min)?.date ?? "",
        volume: variable === "discharge" ? (mean * vals.length * 86_400) / 1e6 : null,
      };
    })
    .sort((a, b) => a.year - b.year);
}

// ── Descriptive Statistics ────────────────────────────────────────────────────

export interface DescStats {
  mean:    number;
  median:  number;
  min:     number;
  minDate: string | undefined;
  max:     number;
  maxDate: string | undefined;
  q5:      number;
  q10:     number;
  q90:     number;
  q95:     number;
  count:   number;
}

export function computeStats(series: DailyPoint[]): DescStats | null {
  const valid = series.filter((d) => d.value !== null);
  if (!valid.length) return null;
  const vals   = valid.map((d) => d.value as number);
  const sorted = [...vals].sort((a, b) => a - b);
  const pct    = (p: number) => sorted[Math.floor((p / 100) * (sorted.length - 1))];
  const byVal  = [...valid].sort((a, b) => (a.value as number) - (b.value as number));
  return {
    mean:    vals.reduce((a, b) => a + b, 0) / vals.length,
    median:  pct(50),
    min:     sorted[0],
    minDate: byVal[0]?.date,
    max:     sorted[sorted.length - 1],
    maxDate: byVal[byVal.length - 1]?.date,
    q5: pct(5), q10: pct(10), q90: pct(90), q95: pct(95),
    count: vals.length,
  };
}
