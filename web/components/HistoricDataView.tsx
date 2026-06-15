"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import type { DailyResponse, DailyPoint } from "@/lib/types";
import { fmtDischarge, fmtLevel, fmtDate } from "@/lib/format";
import { strings } from "@/lib/strings";
import { Callout } from "./Callout";
import { computeLowFlow } from "@/lib/lowFlow";
import {
  computeStats, computeFdc, computeRegime, computeAnnualStats,
} from "@/lib/hydro";
import { computeBaseflow } from "@/lib/baseflow";
import type { BaseflowMethod, BaseflowResult } from "@/lib/baseflow";
import { MethodologyBox } from "./MethodologyBox";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => (
    <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
      Loading chart…
    </div>
  ),
});

type Variable = "discharge" | "level";
type Tab = "hydrograph" | "fdc" | "regime" | "annual" | "lowflow" | "stats";
const VALID_TABS: Tab[] = ["hydrograph", "fdc", "regime", "annual", "lowflow", "stats"];

const REGIME_MONTH_TICKS = {
  tickmode: "array" as const,
  tickvals: [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335],
  ticktext: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
};

const SYMBOL_META: Record<string, { label: string; color: string; marker: string }> = {
  E: { label: "Estimated (E)",    color: "#f97316", marker: "circle-open" },
  B: { label: "Ice-affected (B)", color: "#06b6d4", marker: "diamond"     },
  D: { label: "Dry (D)",          color: "#6b7280", marker: "x"           },
};

const LOW_N_VALUES = [1, 7, 30];
const LOW_PERIODS  = [2, 5, 10];

// ── Component ────────────────────────────────────────────────────────────────

export function HistoricDataView({ stationId }: { stationId: string }) {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const pathname     = usePathname();

  const [variable, setVariable] = useState<Variable>(() => {
    const v = searchParams.get("var");
    return v === "level" ? "level" : "discharge";
  });
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab") as Tab | null;
    return t && VALID_TABS.includes(t) ? t : "hydrograph";
  });

  const [data, setData]         = useState<DailyResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [regimeBands, setRegimeBands] = useState({
    minMax: false, q10q90: true, q25q75: false, median: true,
  });
  const [regimeYear, setRegimeYear] = useState<string>("");
  const [yearRange, setYearRange] = useState<[number, number] | null>(null);

  // ── Feature 16: Baseflow separation state ────────────────────────────────
  const [showBaseflow,   setShowBaseflow]   = useState(false);
  const [baseflowMethod, setBaseflowMethod] = useState<BaseflowMethod>("lyne-hollick");
  const [bfAlpha,        setBfAlpha]        = useState(0.925);
  const [bfPasses,       setBfPasses]       = useState(3);
  const [bfA,            setBfA]            = useState(0.98);
  const [bfBfiMax,       setBfBfiMax]       = useState(0.80);
  const [showBfAdv,      setShowBfAdv]      = useState(false);

  const toggleBand = (key: keyof typeof regimeBands) =>
    setRegimeBands((b) => ({ ...b, [key]: !b[key] }));

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetch_ = useCallback(async (v: Variable) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/stations/${stationId}/daily?variable=${v}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [stationId]);

  useEffect(() => { fetch_(variable); }, [variable, fetch_]);

  const dataYearRange = useMemo<[number, number] | null>(() => {
    if (!data?.series.length) return null;
    const years = data.series
      .map((d) => parseInt(d.date.slice(0, 4), 10))
      .filter((y) => !isNaN(y));
    if (!years.length) return null;
    return [Math.min(...years), Math.max(...years)];
  }, [data]);

  useEffect(() => { if (dataYearRange) setYearRange(dataYearRange); }, [dataYearRange]);

  // ── URL sync ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams();
    if (variable !== "discharge") params.set("var", variable);
    if (tab !== "hydrograph")    params.set("tab", tab);
    const qs = params.size ? `?${params.toString()}` : "";
    router.replace(`${pathname}${qs}`, { scroll: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variable, tab]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const fmt  = variable === "discharge" ? fmtDischarge : fmtLevel;
  const unit = variable === "discharge" ? "m³/s" : "m";

  const filteredSeries = useMemo<DailyPoint[]>(() => {
    if (!data?.series) return [];
    if (!yearRange)    return data.series;
    const [lo, hi] = yearRange;
    return data.series.filter((d) => {
      const y = parseInt(d.date.slice(0, 4), 10);
      return y >= lo && y <= hi;
    });
  }, [data, yearRange]);

  // ── Baseflow result (computed client-side) ────────────────────────────────
  const baseflowResult = useMemo<BaseflowResult | null>(() => {
    if (!showBaseflow || variable !== "discharge" || !filteredSeries.length) return null;
    return computeBaseflow(
      filteredSeries,
      baseflowMethod,
      baseflowMethod === "lyne-hollick"
        ? { method: baseflowMethod, alpha: bfAlpha, passes: bfPasses }
        : { method: baseflowMethod, a: bfA, bfiMax: bfBfiMax },
    );
  }, [showBaseflow, variable, filteredSeries, baseflowMethod, bfAlpha, bfPasses, bfA, bfBfiMax]);

  const annualStats = useMemo(
    () => computeAnnualStats(filteredSeries, variable),
    [filteredSeries, variable]
  );

  const lowFlowData = useMemo(() => {
    if (variable !== "discharge") return null;
    return computeLowFlow(filteredSeries, LOW_N_VALUES, LOW_PERIODS);
  }, [variable, filteredSeries]);

  const isFullRange =
    !dataYearRange || !yearRange ||
    (yearRange[0] === dataYearRange[0] && yearRange[1] === dataYearRange[1]);

  const downloadDailyCsv = () => {
    if (!data) return;
    const rows = ["date,value,symbol",
      ...filteredSeries.map((d) => `${d.date},${d.value ?? ""},${d.symbol ?? ""}`)];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stationId}_${variable}_daily.csv`;
    a.click();
  };

  const downloadAnnualCsv = () => {
    if (!annualStats.length) return;
    const header = variable === "discharge"
      ? "year,days,mean_m3s,max_m3s,max_date,min_m3s,min_date,volume_Mm3"
      : "year,days,mean_m,max_m,max_date,min_m,min_date";
    const rows = annualStats.map((r) =>
      [r.year, r.n, r.mean.toFixed(3), r.max.toFixed(3), r.maxDate,
       r.min.toFixed(3), r.minDate, r.volume != null ? r.volume.toFixed(2) : ""].join(",")
    );
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${stationId}_${variable}_annual.csv`;
    a.click();
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-400">
      {strings.daily.loading}
    </div>
  );
  if (error) return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Callout level="error">{error}</Callout>
    </div>
  );
  if (!data || filteredSeries.length === 0) return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Callout level="info">
        {!data || data.series.length === 0
          ? strings.daily.noData
          : "No data in the selected period. Adjust the year range."}
      </Callout>
    </div>
  );

  const series = filteredSeries;
  const stats  = computeStats(series);
  const fdc    = tab === "fdc"    ? computeFdc(series)    : { x: [], y: [] };
  const regime = tab === "regime" ? computeRegime(series) : null;
  const dates  = series.map((d) => d.date);
  const vals   = series.map((d) => d.value);

  const flagGroups = Object.entries(SYMBOL_META)
    .map(([sym, meta]) => ({
      ...meta,
      pts: series.filter((d) => d.symbol === sym && d.value !== null),
    }))
    .filter((g) => g.pts.length > 0);

  return (
    <div className="max-w-screen-xl mx-auto px-4 py-6 space-y-4">

      {/* ── Controls ── */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex rounded border border-gray-300 overflow-hidden text-sm">
          {(["discharge", "level"] as Variable[]).map((v) => (
            <button key={v} onClick={() => { setVariable(v); setYearRange(null); }}
              className={`px-4 py-1.5 ${variable === v
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"}`}>
              {v === "discharge" ? "Discharge (m³/s)" : "Water Level (m)"}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={logScale}
            onChange={(e) => setLogScale(e.target.checked)} />
          Log scale
        </label>

        {dataYearRange && yearRange && (
          <div className="flex items-center gap-2 text-sm text-gray-600 ml-2">
            <span className="font-medium text-gray-500">Period:</span>
            <input type="number" value={yearRange[0]}
              min={dataYearRange[0]} max={yearRange[1] - 1}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= dataYearRange[0] && v < yearRange[1])
                  setYearRange([v, yearRange[1]]);
              }}
              className="w-20 border border-gray-300 rounded px-2 py-1 text-xs text-center" />
            <span className="text-gray-400">–</span>
            <input type="number" value={yearRange[1]}
              min={yearRange[0] + 1} max={dataYearRange[1]}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v <= dataYearRange[1] && v > yearRange[0])
                  setYearRange([yearRange[0], v]);
              }}
              className="w-20 border border-gray-300 rounded px-2 py-1 text-xs text-center" />
            {!isFullRange && (
              <button onClick={() => setYearRange(dataYearRange)}
                className="text-xs text-blue-600 hover:underline">Full record</button>
            )}
            <span className="text-xs text-gray-400">
              ({series.length.toLocaleString()} days
              {!isFullRange ? ` of ${data.series.length.toLocaleString()}` : ""})
            </span>
          </div>
        )}

        <button onClick={downloadDailyCsv}
          className="ml-auto text-sm text-blue-600 hover:underline">
          {strings.daily.downloadCsv}
        </button>
        {/* ── Feature 15: Print Report link ── */}
        <a href={`/stations/${stationId}/report`} target="_blank" rel="noopener noreferrer"
          className="text-sm text-gray-500 hover:text-gray-700 print-hide">
          📄 Print Report
        </a>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex gap-0 border-b border-gray-200 overflow-x-auto">
        {(["hydrograph", "fdc", "regime", "annual", "lowflow", "stats"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t === "hydrograph" ? "Hydrograph"
             : t === "fdc"      ? "Flow-Duration"
             : t === "regime"   ? "Annual Regime"
             : t === "annual"   ? "Annual Stats"
             : t === "lowflow"  ? "Low Flow"
             :                    "Statistics"}
          </button>
        ))}
      </div>

      {/* ── Hydrograph (Feature 16: baseflow overlay) ── */}
      {tab === "hydrograph" && (
        <div className="space-y-3">
          {/* Baseflow controls — discharge only */}
          {variable === "discharge" && (
            <div className="flex flex-wrap gap-4 items-center bg-gray-50 border border-gray-200 rounded px-4 py-2 text-sm">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={showBaseflow}
                  onChange={(e) => setShowBaseflow(e.target.checked)} />
                <span className="font-medium text-gray-700">Show baseflow separation</span>
              </label>

              {showBaseflow && (
                <>
                  <select value={baseflowMethod}
                    onChange={(e) => setBaseflowMethod(e.target.value as BaseflowMethod)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs">
                    <option value="lyne-hollick">Lyne-Hollick (α = {bfAlpha})</option>
                    <option value="eckhardt">Eckhardt (a = {bfA}, BFImax = {bfBfiMax})</option>
                  </select>

                  {baseflowResult && (
                    <span className="text-xs font-mono text-gray-600 bg-white border border-gray-200 rounded px-2 py-1">
                      BFI = {baseflowResult.bfi.toFixed(3)}
                    </span>
                  )}

                  <button onClick={() => setShowBfAdv((v) => !v)}
                    className="text-xs text-blue-600 hover:underline">
                    {showBfAdv ? "Hide" : "Advanced"} parameters
                  </button>

                  {showBfAdv && (
                    <div className="flex flex-wrap gap-3 items-center text-xs w-full mt-1">
                      {baseflowMethod === "lyne-hollick" && (
                        <>
                          <label className="flex items-center gap-1">
                            α (0.8 – 0.999):
                            <input type="number" min={0.8} max={0.999} step={0.001}
                              value={bfAlpha}
                              onChange={(e) => setBfAlpha(Number(e.target.value))}
                              className="w-20 border border-gray-300 rounded px-1.5 py-0.5 ml-1 font-mono" />
                          </label>
                          <label className="flex items-center gap-1">
                            Passes:
                            <select value={bfPasses}
                              onChange={(e) => setBfPasses(Number(e.target.value))}
                              className="border border-gray-300 rounded px-1.5 py-0.5 ml-1">
                              <option value={1}>1 (forward only)</option>
                              <option value={3}>3 (fwd → bwd → fwd)</option>
                            </select>
                          </label>
                        </>
                      )}
                      {baseflowMethod === "eckhardt" && (
                        <>
                          <label className="flex items-center gap-1">
                            a (recession, 0.9 – 0.999):
                            <input type="number" min={0.9} max={0.999} step={0.001}
                              value={bfA}
                              onChange={(e) => setBfA(Number(e.target.value))}
                              className="w-20 border border-gray-300 rounded px-1.5 py-0.5 ml-1 font-mono" />
                          </label>
                          <label className="flex items-center gap-1">
                            BFImax (0.1 – 1.0):
                            <input type="number" min={0.1} max={1.0} step={0.01}
                              value={bfBfiMax}
                              onChange={(e) => setBfBfiMax(Number(e.target.value))}
                              className="w-20 border border-gray-300 rounded px-1.5 py-0.5 ml-1 font-mono" />
                          </label>
                        </>
                      )}
                      <span className="text-gray-400 italic">Changes apply instantly</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Hydrograph chart */}
          <div className="bg-white border border-gray-200 rounded p-2">
            <Plot
              data={(() => {
                if (!showBaseflow || !baseflowResult) {
                  // ── Standard single-line hydrograph ──
                  return [
                    {
                      x: dates, y: vals, type: "scatter", mode: "lines",
                      line: { color: "#3b82f6", width: 1 },
                      name: `${variable} (${unit})`,
                    },
                    ...flagGroups.map((g) => ({
                      x: g.pts.map((d) => d.date),
                      y: g.pts.map((d) => d.value),
                      type: "scatter" as const, mode: "markers" as const,
                      marker: { color: g.color, size: 6, symbol: g.marker as string },
                      name: g.label,
                    })),
                  ];
                }

                // ── Baseflow stacked area overlay ──
                // Trace order for fill: "tonexty" stacking:
                //   1. Baseflow (fill: "tozeroy") → green area from 0 to baseflow
                //   2. Total Q  (fill: "tonexty") → light-blue area from baseflow to total
                //   3. Total Q line (blue visible line on top)
                const bf = baseflowResult.baseflow;
                return [
                  // Green baseflow area (filled to zero)
                  {
                    x: dates, y: bf,
                    type: "scatter" as const, mode: "lines" as const,
                    fill: "tozeroy" as const,
                    fillcolor: "rgba(134,239,172,0.55)",
                    line: { color: "#16a34a", width: 1.5 },
                    name: `Baseflow (BFI = ${baseflowResult.bfi.toFixed(3)})`,
                  },
                  // Light-blue quickflow area (filled from baseflow to total Q)
                  {
                    x: dates, y: vals,
                    type: "scatter" as const, mode: "lines" as const,
                    fill: "tonexty" as const,
                    fillcolor: "rgba(147,197,253,0.50)",
                    line: { color: "transparent", width: 0 },
                    name: "Quickflow / Runoff",
                  },
                  // Blue total discharge line
                  {
                    x: dates, y: vals,
                    type: "scatter" as const, mode: "lines" as const,
                    line: { color: "#2563eb", width: 1.5 },
                    name: `Total discharge (${unit})`,
                    showlegend: false,
                  },
                ];
              })()}
              layout={{
                title: {
                  text: showBaseflow && baseflowResult
                    ? `${strings.daily.hydrograph} — BFI = ${baseflowResult.bfi.toFixed(3)}`
                    : strings.daily.hydrograph,
                },
                xaxis: { title: { text: "Date" } },
                yaxis: { title: { text: unit }, type: logScale ? "log" : "linear" },
                height: 420, margin: { l: 60, r: 20, t: 40, b: 50 },
                legend: { orientation: "h", y: -0.2 },
              }}
              config={{ responsive: true,
                toImageButtonOptions: { format: "png", filename: `${stationId}_hydrograph` } }}
              style={{ width: "100%" }}
            />
          </div>
        </div>
      )}

      {/* ── Flow-Duration Curve ── */}
      {tab === "fdc" && variable === "discharge" && (
        <div className="bg-white border border-gray-200 rounded p-2">
          <Plot
            data={[{
              x: fdc.x, y: fdc.y, type: "scatter", mode: "lines",
              line: { color: "#3b82f6", width: 2 }, name: "Discharge",
            }]}
            layout={{
              title: { text: strings.daily.fdc },
              xaxis: { title: { text: "% Time Exceeded" }, range: [0, 100] },
              yaxis: { title: { text: unit }, type: "log" },
              height: 420, margin: { l: 70, r: 20, t: 40, b: 50 },
            }}
            config={{ responsive: true,
              toImageButtonOptions: { format: "png", filename: `${stationId}_fdc` } }}
            style={{ width: "100%" }}
          />
        </div>
      )}
      {tab === "fdc" && variable === "level" && (
        <Callout level="info">Flow-Duration Curve is only available for discharge.</Callout>
      )}

      {/* ── Annual Regime ── */}
      {tab === "regime" && regime && (() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const traces: any[] = [];
        const lower = (y: number[], name: string) => ({
          x: regime.x, y, type: "scatter", mode: "lines",
          line: { color: "transparent", width: 0 },
          name, hoverinfo: "skip" as const, showlegend: false,
        });

        if (regimeBands.minMax) {
          traces.push(lower(regime.min, "Min"));
          traces.push({
            x: regime.x, y: regime.max, type: "scatter", mode: "lines",
            fill: "tonexty", fillcolor: "rgba(209,213,219,0.45)",
            line: { color: "transparent", width: 0 }, name: "Min – Max", hoverinfo: "skip",
          });
        }
        if (regimeBands.q10q90) {
          traces.push(lower(regime.q10, "Q10"));
          traces.push({
            x: regime.x, y: regime.q90, type: "scatter", mode: "lines",
            fill: "tonexty", fillcolor: "rgba(147,197,253,0.35)",
            line: { color: "transparent", width: 0 }, name: "Q10 – Q90", hoverinfo: "skip",
          });
        }
        if (regimeBands.q25q75) {
          traces.push(lower(regime.q25, "Q25"));
          traces.push({
            x: regime.x, y: regime.q75, type: "scatter", mode: "lines",
            fill: "tonexty", fillcolor: "rgba(59,130,246,0.25)",
            line: { color: "transparent", width: 0 }, name: "Q25 – Q75 (IQR)", hoverinfo: "skip",
          });
        }
        if (regimeBands.median) {
          traces.push({
            x: regime.x, y: regime.median, type: "scatter", mode: "lines",
            line: { color: "#f97316", width: 1.5, dash: "dash" }, name: "Median",
          });
        }
        traces.push({
          x: regime.x, y: regime.mean, type: "scatter", mode: "lines",
          line: { color: "#2563eb", width: 2 }, name: "Mean",
        });

        // Years available in the record (most recent first).
        const availYears = Array.from(
          new Set(series.filter((d) => d.value !== null).map((d) => d.date.slice(0, 4)))
        ).sort((a, b) => b.localeCompare(a));

        // Overlay a single selected year, mapped to day-of-year, in red.
        if (regimeYear) {
          const yearPts = series
            .filter((d) => d.value !== null && d.date.slice(0, 4) === regimeYear)
            .map((d) => {
              const date = new Date(d.date + "T00:00:00");
              const doy  = Math.floor(
                (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000
              );
              return { doy, value: d.value as number };
            })
            .filter((p) => p.doy >= 1 && p.doy <= 366)
            .sort((a, b) => a.doy - b.doy);
          traces.push({
            x: yearPts.map((p) => p.doy),
            y: yearPts.map((p) => p.value),
            type: "scatter", mode: "lines",
            line: { color: "#dc2626", width: 2 }, name: `${regimeYear}`,
          });
        }

        const bandDefs = [
          { key: "minMax"  as const, label: "Min – Max",       color: "rgba(209,213,219,0.8)" },
          { key: "q10q90"  as const, label: "Q10 – Q90",       color: "rgba(147,197,253,0.8)" },
          { key: "q25q75"  as const, label: "Q25 – Q75 (IQR)", color: "rgba(59,130,246,0.6)"  },
          { key: "median"  as const, label: "Median",           color: "#f97316"               },
        ];

        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-gray-50 border border-gray-200 rounded px-4 py-2 text-sm">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Show bands</span>
              {bandDefs.map(({ key, label, color }) => (
                <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={regimeBands[key]}
                    onChange={() => toggleBand(key)} className="rounded" />
                  <span className="inline-block w-3 h-3 rounded-sm border border-gray-300 shrink-0"
                    style={{ background: color }} />
                  <span className="text-gray-700">{label}</span>
                </label>
              ))}
              <label className="flex items-center gap-1.5 cursor-pointer select-none border-l border-gray-200 pl-5">
                <span className="inline-block w-3 h-3 rounded-sm bg-red-600 shrink-0" />
                <span className="text-gray-700">Overlay year</span>
                <select value={regimeYear} onChange={(e) => setRegimeYear(e.target.value)}
                  className="border border-gray-300 rounded px-2 py-0.5 text-xs">
                  <option value="">None</option>
                  {availYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </label>
              <span className="ml-auto text-xs text-gray-400 italic">Mean always shown</span>
            </div>
            <div className="bg-white border border-gray-200 rounded p-2">
              <Plot
                data={traces}
                layout={{
                  title: { text: strings.daily.regime },
                  xaxis: { title: { text: "" }, range: [1, 366], ...REGIME_MONTH_TICKS },
                  yaxis: { title: { text: unit }, type: logScale ? "log" : "linear" },
                  height: 440, margin: { l: 70, r: 20, t: 40, b: 50 },
                  legend: { orientation: "h", y: -0.15 },
                  hovermode: "x unified",
                }}
                config={{ responsive: true,
                  toImageButtonOptions: { format: "png", filename: `${stationId}_regime` } }}
                style={{ width: "100%" }}
              />
            </div>
          </div>
        );
      })()}

      {/* ── Annual Stats ── */}
      {tab === "annual" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-600">
              {annualStats.length} year{annualStats.length !== 1 ? "s" : ""} in selected period
            </p>
            <button onClick={downloadAnnualCsv}
              className="text-sm text-blue-600 hover:underline">
              Download CSV
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded p-2">
            <Plot
              data={[
                {
                  x: annualStats.map((r) => r.year),
                  y: annualStats.map((r) => r.mean),
                  type: "bar", marker: { color: "#93c5fd" },
                  name: `Annual mean (${unit})`,
                },
                {
                  x: annualStats.map((r) => r.year),
                  y: annualStats.map((r) => r.max),
                  type: "scatter", mode: "markers",
                  marker: { color: "#dc2626", size: 6, symbol: "triangle-up" },
                  name: "Annual max",
                },
                {
                  x: annualStats.map((r) => r.year),
                  y: annualStats.map((r) => r.min),
                  type: "scatter", mode: "markers",
                  marker: { color: "#2563eb", size: 5, symbol: "triangle-down" },
                  name: "Annual min",
                },
              ]}
              layout={{
                title: { text: `Annual Statistics — ${variable === "discharge" ? "Discharge" : "Water Level"}` },
                xaxis: { title: { text: "Year" } },
                yaxis: { title: { text: unit }, type: logScale ? "log" : "linear" },
                height: 360, margin: { l: 70, r: 20, t: 50, b: 50 },
                legend: { orientation: "h", y: -0.22 },
              }}
              config={{ responsive: true,
                toImageButtonOptions: { format: "png", filename: `${stationId}_annual_stats` } }}
              style={{ width: "100%" }}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-gray-200 rounded">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Year</th>
                  <th className="px-3 py-2 text-right">Days</th>
                  <th className="px-3 py-2 text-right">Mean ({unit})</th>
                  <th className="px-3 py-2 text-right">Max ({unit})</th>
                  <th className="px-3 py-2 text-left">Max Date</th>
                  <th className="px-3 py-2 text-right">Min ({unit})</th>
                  <th className="px-3 py-2 text-left">Min Date</th>
                  {variable === "discharge" && (
                    <th className="px-3 py-2 text-right">Volume (Mm³)</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...annualStats].reverse().map((r) => (
                  <tr key={r.year} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-medium">{r.year}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-gray-500">{r.n}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{fmt(r.mean)}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-red-700">{fmt(r.max)}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-500">
                      {r.maxDate ? fmtDate(r.maxDate) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-blue-700">{fmt(r.min)}</td>
                    <td className="px-3 py-1.5 text-xs text-gray-500">
                      {r.minDate ? fmtDate(r.minDate) : "—"}
                    </td>
                    {variable === "discharge" && (
                      <td className="px-3 py-1.5 text-right font-mono">
                        {r.volume != null ? r.volume.toFixed(1) : "—"}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-400 mt-1">
              Volume estimated as mean discharge × valid days × 86 400 s/day.
              Partial-record years may underestimate.
            </p>
          </div>
        </div>
      )}

      {/* ── Low Flow ── */}
      {tab === "lowflow" && variable !== "discharge" && (
        <Callout level="info">Low-flow analysis is only available for discharge.</Callout>
      )}
      {tab === "lowflow" && variable === "discharge" && lowFlowData && (() => {
        const { nValues, returnPeriods, windows, nqy } = lowFlowData;
        return (
          <div className="space-y-6">
            <Callout level="info">
              Low-flow statistics fitted using the Log-Normal distribution on annual n-day minimum
              flows (calendar year). Years with fewer than 200 valid observations are excluded.
            </Callout>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">nQy Statistics (m³/s)</h3>
              <div className="overflow-x-auto">
                <table className="text-sm border border-gray-200 rounded">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Window</th>
                      {returnPeriods.map((T) => (
                        <th key={T} className="px-4 py-2 text-right">{T}-yr low flow</th>
                      ))}
                      <th className="px-4 py-2 text-right text-gray-400">n years</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {nValues.map((n) => {
                      const win = windows.find((w) => w.n === n)!;
                      return (
                        <tr key={n} className={n === 7 ? "bg-blue-50 font-semibold" : ""}>
                          <td className="px-4 py-2">{n}-day{n === 7 ? " ★" : ""}</td>
                          {returnPeriods.map((T) => {
                            const q = nqy.find((x) => x.n === n && x.T === T);
                            return (
                              <td key={T} className="px-4 py-2 text-right font-mono">
                                {q?.value != null
                                  ? q.value < 0.001 ? "< 0.001" : fmtDischarge(q.value)
                                  : "—"}
                              </td>
                            );
                          })}
                          <td className="px-4 py-2 text-right font-mono text-gray-400 font-normal">
                            {win.fit?.nYears ?? "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-xs text-gray-400 mt-1">
                  ★ 7-day window is the Canadian regulatory standard (7Q10, 7Q2).
                  Log-Normal distribution. P(X ≤ xT) = 1/T.
                </p>
              </div>
            </div>

            {(() => {
              const win7   = windows.find((w) => w.n === 7);
              if (!win7 || win7.annualMinima.length < 3) return null;
              const q7_10 = nqy.find((x) => x.n === 7 && x.T === 10);
              const q7_2  = nqy.find((x) => x.n === 7 && x.T === 2);
              const xFirst = win7.annualMinima[0].year;
              const xLast  = win7.annualMinima[win7.annualMinima.length - 1].year;
              return (
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">
                    Annual 7-Day Minimum Discharge
                  </h3>
                  <div className="bg-white border border-gray-200 rounded p-2">
                    <Plot
                      data={[
                        {
                          x: win7.annualMinima.map((m) => m.year),
                          y: win7.annualMinima.map((m) => m.value),
                          type: "bar", marker: { color: "#06b6d4" },
                          name: "7-day annual min (m³/s)",
                        },
                        ...(q7_10?.value != null
                          ? [{ x: [xFirst, xLast], y: [q7_10.value, q7_10.value],
                              type: "scatter" as const, mode: "lines" as const,
                              line: { color: "#dc2626", width: 2, dash: "dash" as const },
                              name: "7Q10" }] : []),
                        ...(q7_2?.value != null
                          ? [{ x: [xFirst, xLast], y: [q7_2.value, q7_2.value],
                              type: "scatter" as const, mode: "lines" as const,
                              line: { color: "#f97316", width: 1.5, dash: "dot" as const },
                              name: "7Q2" }] : []),
                      ]}
                      layout={{
                        title: { text: "Annual 7-Day Minimum Discharge" },
                        xaxis: { title: { text: "Year" } },
                        yaxis: { title: { text: "m³/s" }, type: logScale ? "log" : "linear" },
                        height: 380, margin: { l: 70, r: 20, t: 50, b: 50 },
                        legend: { orientation: "h", y: -0.2 },
                      }}
                      config={{ responsive: true,
                        toImageButtonOptions: { format: "png", filename: `${stationId}_7day_min` } }}
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* ── Statistics summary ── */}
      {tab === "stats" && stats && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Statistic</th>
                <th className="px-4 py-2 text-right">Value ({unit})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {[
                ["Period", `${data.meta.start} → ${data.meta.end}`],
                isFullRange ? null : ["Selected period", `${yearRange![0]} – ${yearRange![1]}`],
                ["Days", stats.count.toLocaleString()],
                ["Mean", fmt(stats.mean)],
                ["Median (Q50)", fmt(stats.median)],
                ["Q5 (exceeded 5% of time)", fmt(stats.q5)],
                ["Q10", fmt(stats.q10)],
                ["Q90", fmt(stats.q90)],
                ["Q95 (exceeded 95% of time)", fmt(stats.q95)],
                ["Maximum", `${fmt(stats.max)} (${stats.maxDate ? fmtDate(stats.maxDate) : "—"})`],
                ["Minimum", `${fmt(stats.min)} (${stats.minDate ? fmtDate(stats.minDate) : "—"})`],
              ]
                .filter(Boolean)
                .map((row) => (
                  <tr key={row![0]}>
                    <td className="px-4 py-2 text-gray-600">{row![0]}</td>
                    <td className="px-4 py-2 text-right font-mono">{row![1]}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Methodology accordion ── */}
      <MethodologyBox id={tab} />
    </div>
  );
}
