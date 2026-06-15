"use client";
import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import type {
  Station, DailyPoint, PeakPoint,
} from "@/lib/types";
import type { FrequencyResponse, FrequencyRequest } from "@/lib/types";
import { computeFdc, computeRegime, computeAnnualStats, computeStats } from "@/lib/hydro";
import { mannKendall } from "@/lib/mannKendall";
import { fmtDischarge, fmtArea } from "@/lib/format";
import { Badge } from "./Badge";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => (
    <div className="h-48 flex items-center justify-center text-gray-300 text-sm">
      Rendering chart…
    </div>
  ),
});

// ── Constants ──────────────────────────────────────────────────────────────────
const REPORT_RETURN_PERIODS = [2, 5, 10, 20, 25, 50, 100, 200, 500];
const REPORT_DISTRIBUTIONS  = ["gev", "gumbel", "lp3"];
const DIST_COLORS: Record<string, string> = {
  gev: "#2563eb", gumbel: "#dc2626", lp3: "#9333ea",
};

// ── Selectable report sections ─────────────────────────────────────────────────
type SectionId =
  | "summary" | "hydrograph" | "fdc" | "regime"
  | "peaks" | "design" | "annual" | "trend";

const SECTION_INFO: Record<SectionId, { label: string; description: string }> = {
  summary: {
    label: "Summary statistics",
    description:
      "Key descriptive statistics summarising the full daily discharge record — central tendency, extremes, and data completeness.",
  },
  hydrograph: {
    label: "Hydrograph",
    description:
      "The complete daily mean discharge time series over the period of record, revealing seasonal cycles, flood events, and low-flow periods at a glance.",
  },
  fdc: {
    label: "Flow duration curve",
    description:
      "Ranks every daily discharge from highest to lowest to show the percentage of time each flow is equalled or exceeded. A steep curve indicates a flashy, rainfall-driven river; a flat curve indicates a well-buffered, groundwater- or lake-fed system.",
  },
  regime: {
    label: "Annual regime",
    description:
      "Mean and median discharge for each day of the year, averaged across all years of record, with the Q10–Q90 band showing year-to-year variability. Reveals the seasonal flow signature — for example, the spring snowmelt freshet and summer recession.",
  },
  peaks: {
    label: "Annual peaks & frequency curve",
    description:
      "Annual maximum peak discharges plotted by year, alongside the fitted flood frequency curve relating flood magnitude to return period. Points are empirical (plotting-position) estimates; lines are fitted probability distributions.",
  },
  design: {
    label: "Design flood estimates",
    description:
      "Design flood magnitudes (quantiles) for standard return periods, fitted to the annual maximum series by the method of L-moments. The best-fitting distribution by the Akaike Information Criterion (AIC) is marked with a star.",
  },
  annual: {
    label: "Annual statistics table",
    description:
      "Year-by-year summary: days of record, mean and maximum discharge (with date of maximum), minimum, and total annual runoff volume.",
  },
  trend: {
    label: "Trend analysis",
    description:
      "The non-parametric Mann-Kendall test assesses whether annual peak flows exhibit a statistically significant monotonic trend, and Sen's slope estimates its magnitude. A significant trend indicates non-stationarity, which can undermine the assumptions of standard flood frequency analysis.",
  },
};

const SECTION_ORDER: SectionId[] = [
  "summary", "hydrograph", "fdc", "regime", "peaks", "design", "annual", "trend",
];

// Small heading + plain-language description shown atop each section.
function SectionHeader({ id }: { id: SectionId }) {
  return (
    <>
      <h2 className="text-base font-semibold text-gray-800 mb-1 border-b border-gray-200 pb-1">
        {SECTION_INFO[id].label}
      </h2>
      <p className="text-xs text-gray-500 leading-relaxed mb-3">
        {SECTION_INFO[id].description}
      </p>
    </>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  stationId: string;
  station:   Station;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (v: number | null | undefined, dp = 0): string =>
  v == null || !isFinite(v) ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: dp });

// ── Component ─────────────────────────────────────────────────────────────────
export function ReportView({ stationId, station }: Props) {
  // Data state
  const [daily,  setDaily]  = useState<DailyPoint[]  | null>(null);
  const [peaks,  setPeaks]  = useState<PeakPoint[]   | null>(null);
  const [ffaRes, setFfaRes] = useState<FrequencyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  // Which sections to include — all on by default.
  const [selected, setSelected] = useState<Set<SectionId>>(
    () => new Set(SECTION_ORDER)
  );
  const toggleSection = (id: SectionId) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Fetch all data in parallel on mount
  useEffect(() => {
    setLoading(true);
    setError(null);

    const ffaBody: FrequencyRequest = {
      distributions:    REPORT_DISTRIBUTIONS,
      estimation_method: "lmoments",
      plotting_position: "cunnane",
      return_periods:    REPORT_RETURN_PERIODS,
      exclude_estimated: true,
      confidence_level:  0.9,
      ci_method:         "bootstrap",
      bootstrap_samples: 1000,
    };

    Promise.all([
      fetch(`/api/stations/${stationId}/daily?variable=discharge`)
        .then((r) => { if (!r.ok) throw new Error(`daily HTTP ${r.status}`); return r.json(); }),
      fetch(`/api/stations/${stationId}/peaks`)
        .then((r) => { if (!r.ok) throw new Error(`peaks HTTP ${r.status}`); return r.json(); }),
      fetch(`/api/stations/${stationId}/frequency`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ffaBody),
      }).then((r) => { if (!r.ok) throw new Error(`FFA HTTP ${r.status}`); return r.json(); }),
    ])
      .then(([dailyResp, peaksResp, ffaResp]) => {
        setDaily(dailyResp.series);
        setPeaks(peaksResp.peaks);
        setFfaRes(ffaResp);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Data load failed"))
      .finally(() => setLoading(false));
  }, [stationId]);

  // ── Derived statistics ────────────────────────────────────────────────────
  const fdc      = useMemo(() => daily ? computeFdc(daily) : null, [daily]);
  const regime   = useMemo(() => daily ? computeRegime(daily) : null, [daily]);
  const annStats = useMemo(
    () => daily ? computeAnnualStats(daily, "discharge") : null,
    [daily]
  );
  const descStats = useMemo(() => daily ? computeStats(daily) : null, [daily]);

  const mkResult = useMemo(() => {
    if (!peaks || peaks.length < 5) return null;
    const sorted = [...peaks].sort((a, b) => a.year - b.year);
    return mannKendall(sorted.map((p) => p.value), sorted.map((p) => p.year));
  }, [peaks]);

  const peaksSorted = useMemo(
    () => peaks ? [...peaks].sort((a, b) => a.year - b.year) : null,
    [peaks]
  );

  const bestDist = ffaRes?.best_fit;
  const fittedDists = ffaRes?.distributions.filter((d) => !d.fit_error) ?? [];
  const bestDistData = fittedDists.find((d) => d.key === bestDist);

  // Which sections actually have data to show.
  const available = useMemo<Record<SectionId, boolean>>(() => ({
    summary:    !!descStats,
    hydrograph: !!daily && daily.length > 0,
    fdc:        !!fdc && fdc.x.length > 0,
    regime:     !!regime && regime.x.length > 0,
    peaks:      !!peaksSorted && peaksSorted.length >= 5,
    design:     !!ffaRes && !ffaRes.too_few_years && fittedDists.length > 0,
    annual:     !!annStats && annStats.length > 0,
    trend:      !!mkResult && !!peaksSorted,
  }), [descStats, daily, fdc, regime, peaksSorted, ffaRes, fittedDists.length, annStats, mkResult]);

  // A section renders only when both selected AND data-backed.
  const show = (id: SectionId) => selected.has(id) && available[id];
  const includedCount = SECTION_ORDER.filter(show).length;

  const senIntercept = useMemo(() => {
    if (!mkResult || !peaksSorted) return null;
    const bs = peaksSorted
      .map((p) => p.value - mkResult.senSlope * p.year)
      .sort((a, b) => a - b);
    const mid = Math.floor(bs.length / 2);
    return bs.length % 2 === 1 ? bs[mid] : (bs[mid - 1] + bs[mid]) / 2;
  }, [mkResult, peaksSorted]);

  // ── Record info ───────────────────────────────────────────────────────────
  const flowRange = station.data_ranges.flow;
  const maxRecord = Math.max(
    station.data_ranges.flow?.record_length ?? 0,
    station.data_ranges.level?.record_length ?? 0
  );

  // ── Config shared across all print charts ─────────────────────────────────
  const printConfig = { staticPlot: true };

  const chartMargin = { l: 65, r: 20, t: 45, b: 50 };
  const chartHeight  = 240;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white min-h-screen" id="report-root">
      {/* Print button — hidden in @media print via .report-print-btn */}
      <div className="report-print-btn fixed top-4 right-4 z-50 flex gap-2 print-hide">
        <button
          onClick={() => window.print()}
          className="bg-blue-600 text-white px-4 py-2 rounded shadow text-sm font-medium hover:bg-blue-700">
          🖨 Print / Save PDF
        </button>
        <button
          onClick={() => history.back()}
          className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded shadow text-sm hover:bg-gray-50">
          ← Back
        </button>
      </div>

      {/* Main report container */}
      <div className="max-w-screen-lg mx-auto px-6 py-8 space-y-8">

        {/* ── Section 1: Header ────────────────────────────────────────────── */}
        <div className="border-b-2 border-gray-800 pb-4">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs text-gray-500 font-mono mb-0.5">{stationId}</p>
              <h1 className="text-2xl font-bold text-gray-900">{station.name}</h1>
              <p className="text-gray-600 mt-1">{station.province}</p>
            </div>
            <div className="text-right text-sm text-gray-500">
              <p className="font-medium text-gray-700">Hydrometric Analysis Report</p>
              <p>Generated: {new Date().toLocaleDateString("en-CA", {
                year: "numeric", month: "long", day: "numeric" })}</p>
              <p className="mt-1 text-xs">Source: Water Survey of Canada / HYDAT</p>
            </div>
          </div>

          {/* Station metadata grid */}
          <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Status</p>
              <p className="font-medium mt-0.5">
                {station.status === "active" ? "✅ Active" : "⏹ Discontinued"}
              </p>
            </div>
            {station.drainage_area_gross_km2 && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Drainage Area</p>
                <p className="font-medium mt-0.5">{fmtArea(station.drainage_area_gross_km2)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Record Length</p>
              <p className="font-medium mt-0.5">{maxRecord > 0 ? `${maxRecord} yr` : "—"}</p>
            </div>
            {flowRange && (
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">Flow Record</p>
                <p className="font-medium mt-0.5">{flowRange.year_from}–{flowRange.year_to}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Latitude / Longitude</p>
              <p className="font-medium mt-0.5">{station.latitude.toFixed(4)}° N, {station.longitude.toFixed(4)}° W</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Regulation</p>
              <p className="font-medium mt-0.5">
                {station.regulated === true ? "⚠ Regulated" : station.regulated === false ? "Natural" : "Unknown"}
              </p>
            </div>
          </div>

          {station.regulated === true && (
            <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
              ⚠ Regulated station — flood frequency results assume natural, stationary flow.
              Interpret design floods with caution.
            </p>
          )}
        </div>

        {/* Loading / error states */}
        {loading && (
          <div className="flex items-center justify-center h-32 text-gray-400">
            Loading analysis data — this may take 10–30 seconds…
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-300 text-red-700 rounded px-4 py-3 text-sm">
            ⚠ Data load error: {error}
          </div>
        )}

        {!loading && !error && daily && (
          <>
            {/* ── Report Builder (screen only) ────────────────────────────── */}
            <div className="print-hide bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <h2 className="text-sm font-semibold text-blue-900">
                  Build your report — choose what to include
                </h2>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    onClick={() => setSelected(new Set(SECTION_ORDER.filter((id) => available[id])))}
                    className="text-blue-700 hover:underline">
                    Select all
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="text-blue-700 hover:underline">
                    Clear all
                  </button>
                  <span className="text-blue-500">·</span>
                  <span className="text-blue-700 font-medium">
                    {includedCount} section{includedCount !== 1 ? "s" : ""} selected
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5">
                {SECTION_ORDER.map((id) => {
                  const ok = available[id];
                  return (
                    <label key={id}
                      className={`flex items-center gap-2 text-sm select-none ${
                        ok ? "cursor-pointer text-gray-700" : "text-gray-400 cursor-not-allowed"}`}
                      title={ok ? SECTION_INFO[id].description : "No data available for this station"}>
                      <input type="checkbox" disabled={!ok}
                        checked={ok && selected.has(id)}
                        onChange={() => toggleSection(id)} />
                      <span>{SECTION_INFO[id].label}{!ok && " (n/a)"}</span>
                    </label>
                  );
                })}
              </div>
              {includedCount === 0 && (
                <p className="mt-2 text-xs text-amber-700">
                  Select at least one section to include in the printed report.
                </p>
              )}
            </div>

            {/* ── Descriptive stats strip ─────────────────────────────────── */}
            {show("summary") && descStats && (
              <div className="grid grid-cols-5 gap-3 text-sm">
                {[
                  ["Mean Q", `${fmt(descStats.mean, 1)} m³/s`],
                  ["Median Q", `${fmt(descStats.median, 1)} m³/s`],
                  ["Max Q", `${fmt(descStats.max, 0)} m³/s`],
                  ["Min Q (non-0)", `${fmt(descStats.min, 2)} m³/s`],
                  ["Valid days", fmt(descStats.count, 0)],
                ].map(([label, value]) => (
                  <div key={label} className="bg-gray-50 border border-gray-200 rounded px-3 py-2">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="font-semibold text-gray-800 mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ── Section 2: Hydrograph ────────────────────────────────────── */}
            {show("hydrograph") && (
            <div className="report-section">
              <SectionHeader id="hydrograph" />
              <div className="report-chart">
                <Plot
                  data={[{
                    x: daily.map((d) => d.date),
                    y: daily.map((d) => d.value),
                    type: "scatter", mode: "lines",
                    line: { color: "#3b82f6", width: 0.8 },
                    name: "Daily discharge",
                    connectgaps: false,
                  }]}
                  layout={{
                    xaxis: { title: { text: "Date" } },
                    yaxis: { title: { text: "Discharge (m³/s)" } },
                    height: chartHeight,
                    margin: chartMargin,
                    showlegend: false,
                  }}
                  config={printConfig}
                  style={{ width: "100%" }}
                />
              </div>
            </div>
            )}

            {/* ── Section 3: Flow Duration Curve ──────────────────────────── */}
            {show("fdc") && fdc && fdc.x.length > 0 && (
              <div className="report-section">
                <SectionHeader id="fdc" />
                <div className="report-chart">
                  <Plot
                    data={[{
                      x: fdc.x, y: fdc.y,
                      type: "scatter", mode: "lines",
                      line: { color: "#2563eb", width: 1.5 },
                      name: "FDC",
                    }]}
                    layout={{
                      xaxis: { title: { text: "Exceedance Probability (%)" }, range: [0, 100] },
                      yaxis: { title: { text: "Discharge (m³/s)" }, type: "log" },
                      height: chartHeight,
                      margin: chartMargin,
                      showlegend: false,
                    }}
                    config={printConfig}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            )}

            {/* ── Section 4: Annual Regime ─────────────────────────────────── */}
            {show("regime") && regime && regime.x.length > 0 && (
              <div className="report-section">
                <SectionHeader id="regime" />
                <div className="report-chart">
                  <Plot
                    data={[
                      {
                        x: [...regime.x, ...regime.x.slice().reverse()],
                        y: [...regime.q10, ...regime.q90.slice().reverse()],
                        type: "scatter", mode: "lines", fill: "toself",
                        fillcolor: "rgba(59,130,246,0.12)",
                        line: { color: "transparent" },
                        name: "Q10–Q90",
                      },
                      {
                        x: regime.x, y: regime.mean,
                        type: "scatter", mode: "lines",
                        line: { color: "#2563eb", width: 1.5 },
                        name: "Mean",
                      },
                      {
                        x: regime.x, y: regime.median,
                        type: "scatter", mode: "lines",
                        line: { color: "#16a34a", width: 1.5, dash: "dash" as const },
                        name: "Median",
                      },
                    ]}
                    layout={{
                      xaxis: { title: { text: "Day of Year" } },
                      yaxis: { title: { text: "Discharge (m³/s)" } },
                      height: chartHeight + 20,
                      margin: { ...chartMargin, b: 60 },
                      legend: { orientation: "h", y: -0.3 },
                    }}
                    config={printConfig}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            )}

            {/* ── Section 5: Annual Peaks + Frequency Curve ────────────────── */}
            {show("peaks") && peaksSorted && peaksSorted.length >= 5 && (
              <div className="report-section">
                <SectionHeader id="peaks" />
                <div className="grid grid-cols-2 gap-4">
                  {/* Annual peaks bar chart */}
                  <div className="report-chart">
                    <Plot
                      data={[{
                        x: peaksSorted.map((p) => p.year),
                        y: peaksSorted.map((p) => p.value),
                        type: "bar",
                        marker: { color: "#93c5fd" },
                        name: "Annual peak",
                      }]}
                      layout={{
                        title: { text: "Annual Peaks", font: { size: 12 } },
                        xaxis: { title: { text: "Year" } },
                        yaxis: { title: { text: "Q (m³/s)" } },
                        height: chartHeight,
                        margin: { l: 60, r: 10, t: 35, b: 50 },
                        showlegend: false,
                      }}
                      config={printConfig}
                      style={{ width: "100%" }}
                    />
                  </div>

                  {/* Frequency curve */}
                  {ffaRes && !ffaRes.too_few_years && (
                    <div className="report-chart">
                      <Plot
                        data={[
                          {
                            x: ffaRes.plotting_positions.map((p) => p.return_period),
                            y: ffaRes.plotting_positions.map((p) => p.value),
                            type: "scatter", mode: "markers",
                            marker: { color: "#1f2937", size: 5 },
                            name: "Observed",
                          },
                          ...fittedDists.map((d) => ({
                            x: d.curve.map((c) => c.return_period),
                            y: d.curve.map((c) => c.value),
                            type: "scatter" as const, mode: "lines" as const,
                            line: {
                              color: DIST_COLORS[d.key] ?? "#999",
                              width: d.key === bestDist ? 2 : 1,
                              dash: (d.key === bestDist ? "solid" : "dot") as "solid" | "dot",
                            },
                            name: d.key.toUpperCase() + (d.key === bestDist ? " ★" : ""),
                          })),
                        ]}
                        layout={{
                          title: { text: "Frequency Curve", font: { size: 12 } },
                          xaxis: { title: { text: "Return Period (yr)" }, type: "log",
                            tickvals: [2, 5, 10, 50, 100, 500] },
                          yaxis: { title: { text: "Q (m³/s)" } },
                          height: chartHeight,
                          margin: { l: 60, r: 10, t: 35, b: 50 },
                          legend: { orientation: "h", y: -0.45, font: { size: 9 } },
                        }}
                        config={printConfig}
                        style={{ width: "100%" }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Section 6: Design Flood Quantile Table ───────────────────── */}
            {show("design") && ffaRes && !ffaRes.too_few_years && fittedDists.length > 0 && (
              <div className="report-section">
                <SectionHeader id="design" />
                <table className="w-full text-sm border border-gray-200 rounded">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2 text-left">Return Period (yr)</th>
                      <th className="px-3 py-2 text-left">AEP</th>
                      {fittedDists.map((d) => (
                        <th key={d.key} className="px-3 py-2 text-right"
                          style={{ color: DIST_COLORS[d.key] }}>
                          {d.key.toUpperCase()}{d.key === bestDist ? " ★" : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {REPORT_RETURN_PERIODS.map((T) => (
                      <tr key={T} className={T >= 100 ? "bg-blue-50" : ""}>
                        <td className="px-3 py-1.5 font-medium">{T}</td>
                        <td className="px-3 py-1.5 text-gray-500 text-xs">
                          {T >= 100 ? `${(100 / T).toFixed(1)}%` : `${(100 / T).toFixed(0)}%`}
                        </td>
                        {fittedDists.map((d) => {
                          const q = d.quantiles.find((q) => q.return_period === T);
                          return (
                            <td key={d.key} className="px-3 py-1.5 text-right font-mono">
                              {q ? fmtDischarge(q.value) : "—"}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 mt-1">
                  Values in m³/s. Fitted by L-moments. ★ = best fit by AIC.
                  {ffaRes.warnings?.length > 0 && ` ${ffaRes.warnings[0].message}`}
                </p>
              </div>
            )}

            {/* ── Section 7: Annual Statistics Table ──────────────────────── */}
            {show("annual") && annStats && annStats.length > 0 && (
              <div className="report-section">
                <SectionHeader id="annual" />
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-gray-200 rounded">
                    <thead className="bg-gray-50 text-gray-500 uppercase">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Year</th>
                        <th className="px-2 py-1.5 text-right">Days</th>
                        <th className="px-2 py-1.5 text-right">Mean (m³/s)</th>
                        <th className="px-2 py-1.5 text-right">Max (m³/s)</th>
                        <th className="px-2 py-1.5 text-left">Max Date</th>
                        <th className="px-2 py-1.5 text-right">Min (m³/s)</th>
                        <th className="px-2 py-1.5 text-right">Volume (Mm³)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {annStats.map((s) => (
                        <tr key={s.year}>
                          <td className="px-2 py-1 font-medium">{s.year}</td>
                          <td className="px-2 py-1 text-right text-gray-500">{s.n}</td>
                          <td className="px-2 py-1 text-right font-mono">{s.mean.toFixed(1)}</td>
                          <td className="px-2 py-1 text-right font-mono">{s.max.toFixed(0)}</td>
                          <td className="px-2 py-1 text-gray-500">{s.maxDate?.slice(0, 10) ?? "—"}</td>
                          <td className="px-2 py-1 text-right font-mono">{s.min.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right font-mono">
                            {s.volume != null ? s.volume.toFixed(0) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── Section 8: Trend Analysis ────────────────────────────────── */}
            {show("trend") && mkResult && peaksSorted && (
              <div className="report-section">
                <SectionHeader id="trend" />

                {/* MK summary paragraph */}
                <div className="bg-gray-50 border border-gray-200 rounded px-4 py-3 text-sm mb-4">
                  <p>
                    The Mann-Kendall trend test applied to {peaksSorted.length} annual peak discharge
                    values ({peaksSorted[0].year}–{peaksSorted[peaksSorted.length - 1].year}) yields{" "}
                    Kendall τ = {mkResult.tau.toFixed(3)} with p-value{" "}
                    {mkResult.pValue < 0.001 ? "< 0.001" : mkResult.pValue.toFixed(3)}.
                    Sen's slope = {(mkResult.senSlope >= 0 ? "+" : "") + mkResult.senSlope.toFixed(2)} m³/s/yr.
                  </p>
                  <p className="mt-1.5 font-medium">
                    {mkResult.significant
                      ? `⚠ A statistically significant ${mkResult.trend === "increasing" ? "increasing ↑" : "decreasing ↓"} trend is detected (α = 0.05). Non-stationarity may affect flood frequency analysis reliability.`
                      : `✅ No statistically significant trend detected (α = 0.05). The stationarity assumption for flood frequency analysis is supported.`}
                  </p>
                </div>

                {/* Trend chart */}
                <div className="report-chart">
                  <Plot
                    data={(() => {
                      const years  = peaksSorted.map((p) => p.year);
                      const x0 = years[0], x1 = years[years.length - 1];
                      const trendY = (t: number) => mkResult.senSlope * t + (senIntercept ?? 0);
                      return [
                        {
                          x: years, y: peaksSorted.map((p) => p.value),
                          type: "bar" as const, marker: { color: "#93c5fd" }, name: "Annual peak",
                        },
                        {
                          x: [x0, x1], y: [trendY(x0), trendY(x1)],
                          type: "scatter" as const, mode: "lines" as const,
                          line: { color: mkResult.significant ? "#dc2626" : "#6b7280", width: 2 },
                          name: `Sen's slope ${(mkResult.senSlope >= 0 ? "+" : "") + mkResult.senSlope.toFixed(2)} m³/s/yr`,
                        },
                      ];
                    })()}
                    layout={{
                      xaxis: { title: { text: "Year" } },
                      yaxis: { title: { text: "Peak Discharge (m³/s)" } },
                      height: chartHeight,
                      margin: chartMargin,
                      legend: { orientation: "h", y: -0.3 },
                    }}
                    config={printConfig}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            )}

            {/* ── Footer ───────────────────────────────────────────────────── */}
            <div className="border-t border-gray-300 pt-4 text-xs text-gray-400 space-y-1">
              <p>
                <strong className="text-gray-600">Data source:</strong> Water Survey of Canada (WSC)
                / Environment and Climate Change Canada (ECCC) — HYDAT database.
              </p>
              <p>
                <strong className="text-gray-600">Disclaimer:</strong> This report is generated
                automatically from publicly available hydrometric data. Results should be
                verified by a qualified professional hydrologist before use in engineering design
                or regulatory submissions.
              </p>
              <p>
                Generated {new Date().toISOString()} · Station {stationId}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
